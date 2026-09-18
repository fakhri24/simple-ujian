import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Alur utuh essay yang diperiksa otomatis: guru menyusun kunci di editor,
 * siswa menjawab dengan bentuk lain yang senilai, lalu nilainya sudah terisi
 * di rekap tanpa koreksi manual.
 *
 * Test ini membuat ujiannya sendiri agar tidak mengubah ujian bersama yang
 * dipakai spec lain.
 */

const selectOptionProgrammatically = async (page, selector, val) => {
  await page.evaluate(({ sel, value }) => {
    const select = document.querySelector(sel);
    if (!select) {
      throw new Error(`Select element not found: ${sel}`);
    }
    let found = false;
    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      if (option.value === value || option.textContent.includes(value)) {
        select.selectedIndex = i;
        select.value = option.value;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`Option not found for value: ${value} in select: ${sel}`);
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, value: val });
};

/** Daftar ujian di dropdown baru terisi setelah renderExams() selesai. */
const waitForOption = async (page, selector, text) => {
  await page.waitForFunction(
    ({ sel, value }) => {
      const select = document.querySelector(sel);
      return Boolean(select) && [...select.options].some((opt) => opt.textContent.includes(value));
    },
    { sel: selector, value: text },
    { timeout: 30000 }
  );
};

const toDateTimeLocal = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const loginAs = async (page, email, password) => {
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
};

const openTab = async (page, tab) => {
  await expect(async () => {
    await page.click(`button.nav-item[data-tab="${tab}"]`);
    await expect(page.locator(`#${tab}`)).not.toHaveClass(/hidden-tab/);
  }).toPass();
};

test.describe('Essay auto-grade: alur guru → siswa → rekap', () => {
  test.beforeEach(() => {
    execSync('node scripts/clean-test-db.mjs');
  });

  test('guru memasang kunci, siswa menjawab senilai, nilai terisi otomatis', async ({ page, context }) => {
    test.setTimeout(240000);

    const examTitle = `Uji Essay Otomatis ${Date.now()}`;

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        get() {
          return window.localStorage.getItem('mockOffline') === 'true' ? false : true;
        },
        configurable: true,
      });
      window.SimpleUjianBrowser = { version: 'PlaywrightMock' };
    });

    page.on('dialog', async (dialog) => {
      console.log('DIALOG OPENED:', dialog.type(), dialog.message());
      await dialog.accept();
    });

    // --- Guru: buat ujian baru -------------------------------------------
    await page.goto('/');
    await loginAs(page, 'admin@example.com', 'Admin123!');
    await expect(page).toHaveURL(/\/pages\/admin\.html/);
    await page.waitForLoadState('load');

    await page.fill('#exam-title', examTitle);
    await page.fill('#exam-duration', '30');
    // 0 = tanpa ambang submit dini, supaya siswa bisa langsung mengumpulkan.
    await page.fill('#exam-min-submit', '0');
    await page.fill('#exam-start-time', toDateTimeLocal(new Date(Date.now() - 60 * 60 * 1000)));
    await page.fill('#exam-latest-start-time', toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
    await page.click('#create-exam-form button[type="submit"]');
    await expect(page.locator('#admin-feedback')).toHaveText('Ujian berhasil dibuat.');

    // --- Guru: susun soal essay dengan kunci otomatis ---------------------
    await openTab(page, 'tab-editor');
    // Muat ujian yang baru dibuat (masih kosong) supaya ruang kerja editor terbuka.
    await waitForOption(page, '#editor-load-exam', examTitle);
    await selectOptionProgrammatically(page, '#editor-load-exam', examTitle);
    await page.click('#editor-load-exam-btn');
    await expect(page.locator('#editor-workspace')).not.toHaveClass(/hidden/);

    await page.click('#editor-add-q-btn');
    await expect(page.locator('#editor-active-form-card')).not.toHaveClass(/hidden/);

    await selectOptionProgrammatically(page, '#edit-q-type', 'essay');
    await page.evaluate(() => {
      window.editQuill.clipboard.dangerouslyPasteHTML(
        '<p>Sebuah pita 3 meter dibagi rata kepada 4 anak. Berapa meter bagian tiap anak?</p>'
      );
    });
    await page.fill('#edit-q-score', '10');

    await page.locator('.essay-auto-grade').check();
    await expect(page.locator('.essay-key-settings')).not.toHaveClass(/hidden/);
    await selectOptionProgrammatically(page, '.essay-key-mode', 'numeric');
    await page.locator('.essay-key-accepted').fill('3/4');

    // Penguji di panel guru: bentuk lain yang senilai harus dinyatakan benar.
    await page.locator('.essay-key-tester').fill('0,75');
    await expect(page.locator('.essay-key-tester-result')).toContainText('✅ Benar');

    await page.click('#edit-save-btn');

    await waitForOption(page, '#editor-save-target-exam', examTitle);
    await selectOptionProgrammatically(page, '#editor-save-target-exam', examTitle);
    await page.click('#editor-save-exam-btn');
    await expect(page.locator('#admin-feedback')).toContainText('Sukses menyimpan', { timeout: 30000 });

    await page.click('#logout-btn');
    await expect(page).toHaveURL(/.*\/index\.html|.*\/$/);

    // --- Siswa: kerjakan ujian --------------------------------------------
    await loginAs(page, 'siswa@example.com', 'Siswa123!');
    await expect(page).toHaveURL(/\/pages\/student\.html/);

    // Daftar ujian dirender setelah data selesai dimuat, jadi tunggu dulu
    // sebelum menyusuri halaman berikutnya.
    await expect(page.locator('#student-exam-list li').first()).toBeVisible();

    const examItem = page.locator('#student-exam-list li', { hasText: examTitle });
    for (let i = 0; i < 10 && (await examItem.count()) === 0; i += 1) {
      const nextBtn = page.locator('#next-page-btn');
      if (!(await nextBtn.isVisible()) || (await nextBtn.isDisabled())) {
        break;
      }
      await nextBtn.click();
      await page.waitForTimeout(300);
    }
    await expect(examItem).toBeVisible();
    await examItem.locator('.link-btn').click();
    await expect(page).toHaveURL(/\/pages\/exam\.html/);

    const startFsBtn = page.locator('#start-fs-btn');
    try {
      await startFsBtn.waitFor({ state: 'visible', timeout: 15000 });
      await startFsBtn.click();
      await expect(startFsBtn).toBeHidden({ timeout: 15000 });
    } catch (e) {
      console.log('Overlay fullscreen tidak muncul.');
    }

    // Soal berkunci angka: siswa dapat bantuan pecahan dan pratinjau bacaan.
    const answerBox = page.locator('#essay-answer');
    await expect(answerBox).toBeVisible();
    await expect(page.locator('.essay-frac-toggle')).toBeVisible();

    await answerBox.fill('setengah');
    await expect(page.locator('.essay-read-as')).toHaveText(
      'Belum terbaca sebagai angka — periksa lagi penulisannya.'
    );

    // Siswa menjawab dalam bentuk desimal, bukan pecahan seperti kuncinya.
    await answerBox.fill('0,75');
    await expect(page.locator('.essay-read-as')).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');

    const submitBtn = page.locator('#submit-btn');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const confirmModal = page.locator('#confirm-modal');
    await expect(confirmModal).toBeVisible();
    await page.click('#confirm-submit-btn');

    await expect(page).toHaveURL(/\/pages\/result\.html/, { timeout: 30000 });
    await expect(page.locator('#result-score')).toContainText('100', { timeout: 30000 });

    // --- Guru: rekap sudah terisi tanpa koreksi manual ---------------------
    // Halaman hasil tidak punya tombol keluar, jadi kembali dulu ke daftar ujian.
    await page.click('#result-back-btn');
    await expect(page).toHaveURL(/\/pages\/student\.html/);
    await page.click('#logout-btn');
    // Keluar dari sisi siswa mendarat di halaman penutup lockdown, bukan index.
    await expect(page).not.toHaveURL(/\/pages\/student\.html/);
    await page.goto('/');
    await loginAs(page, 'admin@example.com', 'Admin123!');
    await expect(page).toHaveURL(/\/pages\/admin\.html/);

    await openTab(page, 'tab-recap');
    await waitForOption(page, '#recap-filter-exam', examTitle);
    await selectOptionProgrammatically(page, '#recap-filter-exam', examTitle);

    const row = page.locator('#recap-list tr', { hasText: examTitle });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('100');
    // Tidak ada sisa koreksi: tombolnya "Detail", bukan "Koreksi".
    await expect(row.locator('.view-submission-btn')).toContainText('Detail');

    await row.locator('.view-submission-btn').click();
    const detail = page.locator('#detail-questions-container');
    await expect(detail).toBeVisible();
    // Jejak 🤖 menandai nilai datang dari mesin, bukan dari guru.
    await expect(detail).toContainText('🤖');
    await expect(detail).toContainText('Dinilai (10/10)');

    // Bersihkan ujian buatan test agar daftar ujian tidak menumpuk tiap run.
    await page.click('#close-submission-detail-btn');
    await expect(page.locator('#submission-detail-modal')).toHaveClass(/hidden/);
    await openTab(page, 'tab-exams');
    const examCard = page.locator('#exam-list li.exam-item', { hasText: examTitle });
    await expect(examCard).toBeVisible();
    await examCard.locator('.remove-exam-btn').click();
    await expect(page.locator('#admin-feedback')).toHaveText('Ujian berhasil dihapus.');
  });
});
