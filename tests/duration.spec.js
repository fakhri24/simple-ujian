import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { formatDurationDisplay, isValidDuration } from '../js/examEngine.js';

test.describe('Format dan Validasi Durasi Ujian (Unit Test)', () => {
  test('formatDurationDisplay memformat bilangan bulat dan pecahan dengan koma Indonesia', () => {
    expect(formatDurationDisplay(30)).toBe('30 menit');
    expect(formatDurationDisplay(42.5)).toBe('42,5 menit');
    expect(formatDurationDisplay(1.5)).toBe('1,5 menit');
    expect(formatDurationDisplay(42.5, 'Menit')).toBe('42,5 Menit');
    expect(formatDurationDisplay(42.5, 'mnt')).toBe('42,5 mnt');
    expect(formatDurationDisplay(0)).toBe('0 menit');
    expect(formatDurationDisplay(null)).toBe('0 menit');
    expect(formatDurationDisplay(undefined)).toBe('0 menit');
  });

  test('isValidDuration memvalidasi kelipatan 0.5 menit dan batas minimal 1 menit', () => {
    // Valid cases
    expect(isValidDuration(1)).toBe(true);
    expect(isValidDuration(1.5)).toBe(true);
    expect(isValidDuration(2)).toBe(true);
    expect(isValidDuration(42.5)).toBe(true);
    expect(isValidDuration('42.5')).toBe(true);
    expect(isValidDuration('42,5')).toBe(true);
    expect(isValidDuration(60)).toBe(true);

    // Invalid cases: di bawah 1 menit
    expect(isValidDuration(0.5)).toBe(false);
    expect(isValidDuration(0)).toBe(false);
    expect(isValidDuration(-1)).toBe(false);

    // Invalid cases: bukan kelipatan 0.5
    expect(isValidDuration(42.3)).toBe(false);
    expect(isValidDuration(42.25)).toBe(false);
    expect(isValidDuration(1.1)).toBe(false);

    // Invalid cases: non-numeric
    expect(isValidDuration('abc')).toBe(false);
    expect(isValidDuration(NaN)).toBe(false);
  });

  test('createExamEngine menghitung detik dan sisa waktu untuk durasi pecahan (42.5 menit = 2550 detik)', async ({ page }) => {
    await page.goto('/pages/login.html');
    const result = await page.evaluate(async () => {
      const { createExamEngine } = await import('/js/examEngine.js');
      let tickValue = null;
      const exam = { id: 'exam_frac_test', durationMinutes: 42.5 };
      const engine = createExamEngine({
        exam,
        questions: [],
        userId: 'user_test_frac',
        onTimerTick: (seconds) => {
          tickValue = seconds;
        },
      });
      const remaining = engine.remainingSeconds;
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      engine.stop();
      engine.clearStorage();
      return { tickValue, remaining, formatted };
    });

    expect(result.tickValue).toBe(2550);
    expect(result.remaining).toBe(2550);
    expect(result.formatted).toBe('42:30');
  });
});

test.describe('Input Durasi Admin UI di Browser', () => {
  test.beforeEach(() => {
    execSync('node scripts/clean-test-db.mjs');
  });

  test('Alur lengkap: atribut step, normalisasi koma, validasi, dan tampilan durasi pecahan di UI', async ({ page }) => {
    test.setTimeout(90000);

    // 1. Login sebagai Admin
    await page.goto('/');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/pages\/admin\.html/);
    await page.waitForLoadState('load');

    // 2. Verifikasi atribut input durasi
    const durationInput = page.locator('#exam-duration');
    await expect(durationInput).toBeVisible();
    await expect(durationInput).toHaveAttribute('min', '1');
    await expect(durationInput).toHaveAttribute('step', '0.5');

    const editDurationInput = page.locator('#edit-exam-duration');
    await expect(editDurationInput).toHaveAttribute('min', '1');
    await expect(editDurationInput).toHaveAttribute('step', '0.5');

    // 3. Verifikasi mengetik koma (42,5) dinormalisasi menjadi 42.5
    await durationInput.fill('');
    await durationInput.focus();
    await page.keyboard.type('42,5');
    expect(await durationInput.inputValue()).toBe('42.5');

    // 4. Verifikasi paste teks koma (10,5) dinormalisasi menjadi 10.5
    await durationInput.fill('');
    await durationInput.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '10,5');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    });
    expect(await durationInput.inputValue()).toBe('10.5');

    // 5. Verifikasi validasi HTML5
    await durationInput.fill('42.5');
    expect(await durationInput.evaluate((el) => el.checkValidity())).toBe(true);

    await durationInput.fill('42');
    expect(await durationInput.evaluate((el) => el.checkValidity())).toBe(true);

    await durationInput.fill('42.3');
    expect(await durationInput.evaluate((el) => el.checkValidity())).toBe(false);

    await durationInput.fill('0.5');
    expect(await durationInput.evaluate((el) => el.checkValidity())).toBe(false);
  });
});
