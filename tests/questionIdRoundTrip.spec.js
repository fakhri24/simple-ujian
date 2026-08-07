import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Impor ulang soal ke ujian yang sudah punya hasil siswa pernah memutus tautan
 * ke jawaban: soal hasil impor mendapat ID Firestore baru, sementara
 * submissions.answersByQuestionId berkunci ID soal lama.
 *
 * Test ini menjaga jalur ekspor → impor tetap membawa ID soal yang sama.
 * Dialog konfirmasi penyimpanan sengaja dibatalkan, jadi test ini tidak
 * menulis apa pun — yang diperiksa adalah hitungan pada dialog, yang berasal
 * langsung dari ID yang berhasil dipertahankan.
 */
/**
 * Select di halaman admin dibungkus widget kustom (data-modern-select-decorated),
 * sehingga elemen native-nya tak terlihat oleh selectOption. Handler aplikasi
 * membaca `.value` saat tombol ditekan, jadi menyetelnya langsung sudah cukup.
 */
const selectExam = (page, selector, value) =>
  page.evaluate(
    ([sel, val]) => {
      const select = document.querySelector(sel);
      select.value = val;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [selector, value]
  );

test.describe('Ketahanan ID soal pada ekspor/impor Word', () => {
  test.beforeEach(() => {
    execSync('node scripts/clean-test-db.mjs');
  });

  test('ID soal bertahan sehingga impor menimpa soal lama, bukan membuat soal baru', async ({ page }) => {
    test.setTimeout(90000);

    const dialogMessages = [];
    page.on('dialog', async (dialog) => {
      dialogMessages.push(dialog.message());
      // Hanya konfirmasi penyimpanan yang dibatalkan, agar test ini tidak
      // menulis apa pun ke Firestore. Dialog lain (mis. konfirmasi pengosongan
      // editor) tetap disetujui supaya alurnya berjalan.
      if (dialog.message().includes('menimpa soal lama')) {
        await dialog.dismiss();
      } else {
        await dialog.accept();
      }
    });
    page.on('pageerror', (err) => console.log('BROWSER PAGE ERROR:', err.message));

    await page.goto('/');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/pages\/admin\.html/);
    await page.waitForLoadState('load');

    await expect(async () => {
      await page.click('button.nav-item[data-tab="tab-editor"]');
      await expect(page.locator('#tab-editor')).not.toHaveClass(/hidden-tab/);
    }).toPass();

    await page.waitForSelector('#editor-load-exam', { state: 'attached' });
    await page.waitForFunction(() => {
      const select = document.querySelector('#editor-load-exam');
      return select && [...select.options].some((o) => o.value);
    });

    // 1. Muat soal dari ujian yang sudah ada — soal-soal ini punya ID Firestore asli.
    const examId = await page.evaluate(() => {
      const select = document.querySelector('#editor-load-exam');
      return [...select.options].find((o) => o.value).value;
    });
    await selectExam(page, '#editor-load-exam', examId);
    await page.click('#editor-load-exam-btn');

    const feedback = page.locator('#admin-feedback');
    await expect(feedback).toContainText('Berhasil memuat');

    const questionCount = await page.locator('.mini-q-card').count();
    expect(questionCount).toBeGreaterThan(0);

    // 2. Ekspor ke Word. Tiap soal ikut membawa baris "ID: <questionId>".
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#editor-download-docx-btn'),
    ]);
    const exportedPath = await download.path();
    expect(exportedPath).toBeTruthy();

    // 3. Kosongkan editor, lalu impor kembali file hasil ekspor tadi.
    await page.click('#editor-clear-btn');
    await expect(page.locator('.mini-q-card')).toHaveCount(0);

    await page.setInputFiles('#editor-import-file', exportedPath);
    await page.click('#editor-import-file-btn');
    await expect(feedback).toContainText('Berhasil mengimpor');
    await expect(page.locator('.mini-q-card')).toHaveCount(questionCount);

    // 4. Dialog simpan melaporkan berapa soal yang menimpa soal lama. Kalau ID
    //    hilang di perjalanan, angka ini akan jatuh ke sisi "dibuat sebagai
    //    soal baru" dan jawaban siswa kehilangan tautannya.
    dialogMessages.length = 0;
    await selectExam(page, '#editor-save-target-exam', examId);
    await page.click('#editor-save-exam-btn');

    await expect.poll(() => dialogMessages.length).toBeGreaterThan(0);
    const confirmMsg = dialogMessages.find((m) => m.includes('menimpa soal lama'));
    expect(confirmMsg).toBeTruthy();
    expect(confirmMsg).toContain(`${questionCount} soal menimpa soal lama`);
    expect(confirmMsg).toContain('0 soal dibuat sebagai soal baru');
  });
});
