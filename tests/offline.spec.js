import { test, expect } from '@playwright/test';

test.describe('CBT Offline & Submit Edge Cases', () => {
  test('reconciliation and recovery flows for offline submissions', async ({ page, context }) => {
    let offlineMode = false;

    // Log console and errors from browser context
    page.on('console', msg => {
      console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', err => {
      console.error('PAGE ERROR:', err.message);
    });

    // 1. Intercept network calls to block Firebase APIs when mock offline is enabled
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (offlineMode && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    // 2. Inject initial mock offline navigator override and SEB mock
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        get() {
          return window.localStorage.getItem('mockOffline') === 'true' ? false : true;
        },
        configurable: true
      });
      // Bypass lockdown gate during E2E: Playwright "Desktop Chrome" pakai UA
      // Windows, jadi expectedLockdown()=SUB. Mock marker SUB agar konsisten
      // dengan platform (lihat js/lockdown.js). Marker SEB tak cocok di sini.
      window.SimpleUjianBrowser = { version: "PlaywrightMock" };
    });

    // 3. Log in as a student
    await page.goto('/');
    
    // Fill credentials and submit
    await page.fill('input[type="email"]', 'siswa@example.com');
    await page.fill('input[type="password"]', 'Siswa123!');
    await page.click('button[type="submit"]');

    // Wait for student dashboard to load
    await expect(page).toHaveURL(/\/pages\/student\.html/);
    await expect(page.locator('#student-welcome')).toContainText('Selamat datang');

    // Find "ASAT MTL X 2026" exam item
    const examItem = page.locator('li', { hasText: 'ASAT MTL X 2026' });
    await expect(examItem).toBeVisible();

    // Click starting button ("Mulai Ujian" or "Lanjutkan Ujian" or "Mulai Ulang Ujian")
    const actionBtn = examItem.locator('.link-btn');
    await actionBtn.click();

    // Wait for exam page to load
    await expect(page).toHaveURL(/\/pages\/exam\.html/);

    // Dismiss fullscreen anti-cheat overlay if it appears
    const startFsBtn = page.locator('#start-fs-btn');
    try {
      await startFsBtn.waitFor({ state: 'visible', timeout: 15000 });
      await startFsBtn.click();
    } catch (e) {
      console.log('Fullscreen overlay did not show or was auto-dismissed');
    }

    // Now inside the exam. Answer some questions.
    // Let's choose the first option in the current question
    const option = page.locator('.q-option').first();
    await expect(option).toBeVisible();
    await option.click();

    // Simulate connection loss (Go Offline)
    offlineMode = true;
    await page.evaluate(() => {
      window.localStorage.setItem('mockOffline', 'true');
      window.dispatchEvent(new Event('offline'));
    });

    // Verify browser reports offline
    const isOnlineInitially = await page.evaluate(() => navigator.onLine);
    expect(isOnlineInitially).toBe(false);

    // Click submit button in action bar
    const submitBtn = page.locator('#submit-btn');
    await submitBtn.click();

    // Confirm Modal should appear
    const confirmModal = page.locator('#confirm-modal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toHaveAttribute('aria-hidden', 'false');

    // Click confirm submit ("Ya, Kirim")
    const confirmSubmitBtn = page.locator('#confirm-submit-btn');
    await confirmSubmitBtn.click();

    // Confirm Modal hides, Submitting Overlay shows up
    await expect(confirmModal).toBeHidden();
    
    const submittingOverlay = page.locator('#submitting-overlay');
    const submittingStatus = page.locator('#submitting-status');
    const offlineWarning = page.locator('#offline-submit-warning');

    await expect(submittingOverlay).toBeVisible();
    await expect(submittingOverlay).toHaveAttribute('aria-hidden', 'false');
    await expect(submittingStatus).toContainText('Koneksi internet terputus');
    await expect(offlineWarning).toBeVisible();

    // Try to click around - verify submit overlay blocks clicks.
    // The overlay has high z-index, so standard buttons underneath shouldn't be clickable.
    const prevBtn = page.locator('#prev-btn');
    await expect(prevBtn).toBeDisabled();

    // Simulating page reload while still offline (closes browser and reopens)
    await page.reload();

    // On reload while offline and pending submit:
    // It should immediately lock back in the submitting overlay
    const submittingOverlayReloaded = page.locator('#submitting-overlay');
    const submittingStatusReloaded = page.locator('#submitting-status');
    const offlineWarningReloaded = page.locator('#offline-submit-warning');

    await expect(submittingOverlayReloaded).toBeVisible();
    await expect(submittingStatusReloaded).toContainText('Koneksi internet terputus');
    await expect(offlineWarningReloaded).toBeVisible();

    // Navigate to dashboard while still offline (simulate opening dashboard)
    await page.goto('/pages/student.html');
    
    // Ujian must show "Kirim Jawaban (Pending)" as time badge / button
    const pendingExamItem = page.locator('li', { hasText: 'ASAT MTL X 2026' });
    const pendingTimeBadge = pendingExamItem.locator('.badge-warning');
    const pendingActionBtn = pendingExamItem.locator('.link-btn');

    await expect(pendingTimeBadge).toContainText('Kirim Tertunda');
    await expect(pendingActionBtn).toContainText('Kirim Jawaban (Pending)');

    // Click the pending action button to go back to recovery exam page
    await pendingActionBtn.click();
    await expect(page).toHaveURL(/\/pages\/exam\.html/);

    // Page must immediately lock into submitting overlay again
    const submittingOverlayReturned = page.locator('#submitting-overlay');
    await expect(submittingOverlayReturned).toBeVisible();

    // Go Online
    offlineMode = false;
    await page.evaluate(() => {
      window.localStorage.removeItem('mockOffline');
      window.dispatchEvent(new Event('online'));
    });
    
    const isOnlineAfter = await page.evaluate(() => navigator.onLine);
    expect(isOnlineAfter).toBe(true);

    // Page should dynamically update status and successfully submit, then redirect to results page (or congrats modal and redirect to student dashboard)
    try {
      await page.waitForURL(/\/pages\/result\.html/, { timeout: 15000 });
    } catch (e) {
      // If not redirected to result.html, then congrats-modal must be visible
      const congratsModal = page.locator('#congrats-modal');
      await expect(congratsModal).toBeVisible({ timeout: 15000 });
      const congratsOkBtn = page.locator('#congrats-ok-btn');
      await congratsOkBtn.click();
      await expect(page).toHaveURL(/\/pages\/student\.html/);
    }
    
    // Local storage submitPending flag should be cleared
    const userId = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('simpleUjian:submitPending:')) {
          return key.split(':')[2];
        }
      }
      return null;
    });

    if (userId) {
      const pendingFlag = await page.evaluate((uid) => localStorage.getItem(`simpleUjian:submitPending:${uid}:FBmjZeEIhJOcXokiNEYS`), userId);
      expect(pendingFlag).toBeNull();
    }
  });
});
