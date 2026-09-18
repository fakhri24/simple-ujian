import { test, expect } from '@playwright/test';

test.describe('Peringatan Jam Perangkat (Clock Skew Warning)', () => {
  test('checkClockSyncStatus mendeteksi selisih jam normal vs melenceng', async ({ page }) => {
    await page.goto('/pages/login.html');
    const results = await page.evaluate(async () => {
      const { setServerOffsetMs, checkClockSyncStatus } = await import('/js/timeSync.js');

      // 1. Jam akurat (offset 0)
      setServerOffsetMs(0);
      const res0 = checkClockSyncStatus(5);

      // 2. Selisih kecil (2 menit, di bawah threshold 5 menit)
      setServerOffsetMs(2 * 60 * 1000);
      const res2min = checkClockSyncStatus(5);

      // 3. Jam perangkat lambat 8 menit (offset positif: server lebih maju)
      setServerOffsetMs(8 * 60 * 1000);
      const resSlow = checkClockSyncStatus(5);

      // 4. Jam perangkat cepat 12 menit (offset negatif: server lebih lambat)
      setServerOffsetMs(-12 * 60 * 1000);
      const resFast = checkClockSyncStatus(5);

      return { res0, res2min, resSlow, resFast };
    });

    expect(results.res0.isDesynced).toBe(false);
    expect(results.res0.direction).toBe('synced');

    expect(results.res2min.isDesynced).toBe(false);
    expect(results.res2min.diffMinutes).toBe(2);

    expect(results.resSlow.isDesynced).toBe(true);
    expect(results.resSlow.direction).toBe('behind');
    expect(results.resSlow.diffMinutes).toBe(8);

    expect(results.resFast.isDesynced).toBe(true);
    expect(results.resFast.direction).toBe('ahead');
    expect(results.resFast.diffMinutes).toBe(12);
  });

  test('renderClockWarningBanner merender banner, mendukung dismiss, dan menghormati sessionStorage', async ({ page }) => {
    await page.goto('/pages/login.html');

    // 1. Uji kondisi normal: tidak merender banner
    const normalRender = await page.evaluate(async () => {
      const { setServerOffsetMs, renderClockWarningBanner } = await import('/js/timeSync.js');
      sessionStorage.clear();
      setServerOffsetMs(0);
      const container = document.createElement('div');
      container.id = 'test-container';
      document.body.appendChild(container);
      const banner = renderClockWarningBanner(container, 5);
      return { bannerPresent: !!banner, elExists: !!document.getElementById('clock-warning-banner') };
    });
    expect(normalRender.bannerPresent).toBe(false);
    expect(normalRender.elExists).toBe(false);

    // 2. Uji jam terlambat 8 menit: merender banner peringatan kuning
    const desyncedRender = await page.evaluate(async () => {
      const { setServerOffsetMs, renderClockWarningBanner } = await import('/js/timeSync.js');
      setServerOffsetMs(8 * 60 * 1000);
      const container = document.getElementById('test-container');
      const banner = renderClockWarningBanner(container, 5);
      const bannerEl = document.getElementById('clock-warning-banner');
      const text = bannerEl ? bannerEl.textContent : '';
      return {
        bannerPresent: !!banner,
        text,
        hasDismissBtn: !!bannerEl?.querySelector('.clock-warning-dismiss')
      };
    });
    expect(desyncedRender.bannerPresent).toBe(true);
    expect(desyncedRender.text).toContain('Perhatian Jam Perangkat:');
    expect(desyncedRender.text).toContain('lebih lambat sekitar 8 menit');
    expect(desyncedRender.hasDismissBtn).toBe(true);

    // 3. Klik tombol dismiss (✕)
    const dismissResult = await page.evaluate(async () => {
      const dismissBtn = document.querySelector('.clock-warning-dismiss');
      dismissBtn.click();
      const bannerStillExists = !!document.getElementById('clock-warning-banner');
      const sessionFlag = sessionStorage.getItem('simpleUjian:dismissClockWarning');
      return { bannerStillExists, sessionFlag };
    });
    expect(dismissResult.bannerStillExists).toBe(false);
    expect(dismissResult.sessionFlag).toBe('true');

    // 4. Setelah di-dismiss, pemanggilan ulang tidak merender banner lagi di sesi yang sama
    const reRenderDismissed = await page.evaluate(async () => {
      const { renderClockWarningBanner } = await import('/js/timeSync.js');
      const container = document.getElementById('test-container');
      const banner = renderClockWarningBanner(container, 5);
      return { bannerPresent: !!banner };
    });
    expect(reRenderDismissed.bannerPresent).toBe(false);

    // 5. Uji jam terlalu cepat 15 menit pada sesi baru
    const fastClockRender = await page.evaluate(async () => {
      const { setServerOffsetMs, renderClockWarningBanner } = await import('/js/timeSync.js');
      sessionStorage.clear();
      setServerOffsetMs(-15 * 60 * 1000);
      const container = document.getElementById('test-container');
      renderClockWarningBanner(container, 5);
      const bannerEl = document.getElementById('clock-warning-banner');
      return { text: bannerEl ? bannerEl.textContent : '' };
    });
    expect(fastClockRender.text).toContain('lebih cepat sekitar 15 menit');
  });
});
