import { test, expect } from '@playwright/test';

/**
 * Layar siswa untuk essay berkunci angka: bantuan pecahan + pratinjau
 * "terbaca sebagai". Modul questionRenderer butuh DOM asli, jadi test ini
 * memuatnya lewat dev server pada halaman kosong (tanpa alur login).
 */
const mountRenderer = async (page, question, currentAnswer = '') => {
  await page.route('**/__renderer-harness', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><div id="root"></div></body></html>',
    })
  );
  await page.goto('/__renderer-harness');

  await page.evaluate(
    async ({ q, answer }) => {
      const { renderQuestion } = await import('/js/questionRenderer.js');
      window.__answers = [];
      renderQuestion({
        container: document.querySelector('#root'),
        question: q,
        currentAnswer: answer,
        onAnswerChange: (value) => window.__answers.push(value),
        readOnly: false,
      });
    },
    { q: question, answer: currentAnswer }
  );
};

const numericQuestion = {
  id: 'q_numeric',
  type: 'essay',
  content: '<p>Berapa hasil 3 dibagi 4?</p>',
  scoreWeight: 10,
  answerFormat: 'numeric',
};

test.describe('Essay berkunci angka — input siswa', () => {
  test('pratinjau "terbaca sebagai" mengikuti apa yang diketik', async ({ page }) => {
    await mountRenderer(page, numericQuestion);

    const readAs = page.locator('.essay-read-as');
    await expect(readAs).toHaveText('');

    await page.locator('#essay-answer').fill('0,75');
    await expect(readAs).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');

    // Bentuk lain yang senilai harus terbaca sama.
    await page.locator('#essay-answer').fill('75%');
    await expect(readAs).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');

    await page.locator('#essay-answer').fill('\\frac{3}{4}');
    await expect(readAs).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');

    // Bilangan bulat tidak perlu diulang dalam bentuk desimal.
    await page.locator('#essay-answer').fill('12');
    await expect(readAs).toHaveText('Terbaca sebagai: 12');

    // Setiap ketikan tetap tersimpan lewat onAnswerChange.
    expect(await page.evaluate(() => window.__answers.at(-1))).toBe('12');
  });

  test('tulisan yang tidak terbaca mesin diberi peringatan, bukan didiamkan', async ({ page }) => {
    await mountRenderer(page, numericQuestion);

    const readAs = page.locator('.essay-read-as');
    await page.locator('#essay-answer').fill('tiga per empat');
    await expect(readAs).toHaveText('Belum terbaca sebagai angka — periksa lagi penulisannya.');
    await expect(readAs).toHaveClass(/warn/);

    // Begitu diperbaiki, peringatannya hilang.
    await page.locator('#essay-answer').fill('3/4');
    await expect(readAs).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');
    await expect(readAs).not.toHaveClass(/warn/);
  });

  test('penulis pecahan menyisipkan di posisi kursor tanpa menghapus jawaban', async ({ page }) => {
    await mountRenderer(page, numericQuestion, 'x = ');

    await page.locator('.essay-frac-toggle').click();
    await expect(page.locator('.essay-frac-builder')).toBeVisible();

    // Kursor di akhir teks yang sudah ada.
    await page.evaluate(() => {
      const textarea = document.querySelector('#essay-answer');
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });

    await page.locator('.essay-frac-num').fill('3');
    await page.locator('.essay-frac-den').fill('4');
    await page.locator('.essay-frac-insert').click();

    await expect(page.locator('#essay-answer')).toHaveValue('x = 3/4');
    await expect(page.locator('.essay-read-as')).toHaveText('Terbaca sebagai: 3/4 (= 0,75)');
    expect(await page.evaluate(() => window.__answers.at(-1))).toBe('x = 3/4');

    // Kotak pecahan dikosongkan supaya siap dipakai lagi.
    await expect(page.locator('.essay-frac-num')).toHaveValue('');
    await expect(page.locator('.essay-frac-den')).toHaveValue('');
  });

  test('Enter di kotak penyebut langsung menyisipkan pecahan', async ({ page }) => {
    await mountRenderer(page, numericQuestion);

    await page.locator('.essay-frac-toggle').click();
    await page.locator('.essay-frac-num').fill('1');
    await page.locator('.essay-frac-den').fill('2');
    await page.locator('.essay-frac-den').press('Enter');

    await expect(page.locator('#essay-answer')).toHaveValue('1/2');
  });

  test('essay biasa tetap kotak teks polos tanpa bantuan angka', async ({ page }) => {
    await mountRenderer(page, {
      id: 'q_text',
      type: 'essay',
      content: '<p>Jelaskan pendapatmu.</p>',
      scoreWeight: 10,
    });

    await expect(page.locator('#essay-answer')).toBeVisible();
    await expect(page.locator('.essay-frac-toggle')).toHaveCount(0);
    await expect(page.locator('.essay-read-as')).toHaveCount(0);

    await page.locator('#essay-answer').fill('Menurut saya begitu.');
    expect(await page.evaluate(() => window.__answers.at(-1))).toBe('Menurut saya begitu.');
  });
});
