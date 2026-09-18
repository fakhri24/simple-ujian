import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// Helper to select an option programmatically since standard select elements are hidden/decorated in the UI
const selectOptionProgrammatically = async (page, selector, val) => {
  await page.evaluate(({ sel, value }) => {
    const select = document.querySelector(sel);
    if (!select) {
      throw new Error(`Select element not found: ${sel}`);
    }
    let found = false;
    if (typeof value === 'number') {
      if (value >= 0 && value < select.options.length) {
        select.selectedIndex = value;
        found = true;
      }
    } else {
      for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        if (
          option.value === value ||
          option.textContent.includes(value) ||
          option.text.includes(value)
        ) {
          select.selectedIndex = i;
          select.value = option.value;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      throw new Error(`Option not found for value/index: ${value} in select: ${sel}`);
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, value: val });
};

test.describe('CBT Passage / Wacana Flow', () => {
  test.beforeEach(() => {
    execSync('node scripts/clean-test-db.mjs');
  });

  test('CRUD passages, link question, and verify student layout', async ({ page, context }) => {
    test.setTimeout(90000);
    // Inject mock anti-cheat bypass and navigator.onLine mock (required by student exam lockdown)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        get() {
          return window.localStorage.getItem('mockOffline') === 'true' ? false : true;
        },
        configurable: true
      });
      window.SimpleUjianBrowser = { version: "PlaywrightMock" };
    });

    // Accept all dialogs automatically (e.g. window.confirm, window.alert)
    page.on('dialog', async dialog => {
      console.log('DIALOG OPENED:', dialog.type(), dialog.message());
      await dialog.accept();
    });

    // 1. Login as Admin
    await page.goto('/');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // Wait for Admin Dashboard to load
    await expect(page).toHaveURL(/\/pages\/admin\.html/);
    await page.waitForLoadState('load');

    // 2. Go to Editor Tab (retry click to avoid race condition before listener binds)
    await expect(async () => {
      await page.click('button.nav-item[data-tab="tab-editor"]');
      await expect(page.locator('#tab-editor')).not.toHaveClass(/hidden-tab/);
    }).toPass();

    // 3. Load Exam
    await page.waitForSelector('#editor-load-exam', { state: 'attached' });
    await page.waitForFunction(() => {
      const select = document.querySelector('#editor-load-exam');
      return select && select.options.length > 0;
    });
    
    // Select the "[Uji Sistem] E2E Automated Test" exam programmatically
    await selectOptionProgrammatically(page, '#editor-load-exam', '[Uji Sistem] E2E Automated Test');
    await page.click('#editor-load-exam-btn');

    // Verify workspace is visible
    await expect(page.locator('#editor-workspace')).not.toHaveClass(/hidden/);

    // 4. Select the first question to edit to show the editor form card
    const cards = page.locator('.mini-q-card');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();

    // Verify active form card is visible
    await expect(page.locator('#editor-active-form-card')).not.toHaveClass(/hidden/);

    // 5. Open Passage Modal
    await page.click('#edit-manage-passages-btn');
    await expect(page.locator('#manage-passages-modal')).not.toHaveClass(/hidden/);

    // 6. Add a new passage
    await page.fill('#passage-title', 'Wacana Uji Playwright');
    await page.evaluate(() => {
      window.passageQuill.clipboard.dangerouslyPasteHTML('<p>Ini wacana otomatis dari Playwright untuk menguji render split screen.</p>');
    });
    await page.click('#passage-save-btn');

    // Verify passage list has at least 1 item
    await expect(page.locator('#passages-count')).not.toHaveText('0');

    // Close the passages modal
    await page.click('#close-manage-passages-btn');
    await expect(page.locator('#manage-passages-modal')).toHaveClass(/hidden/);

    // 7. Select the passage in the question passage dropdown programmatically
    await selectOptionProgrammatically(page, '#edit-q-passage', 'Wacana Uji Playwright');

    // Click Save Question to List button to commit the question changes
    await page.click('#edit-save-btn');

    // Select the exam to save to in the bottom dropdown programmatically
    await selectOptionProgrammatically(page, '#editor-save-target-exam', '[Uji Sistem] E2E Automated Test');

    // Save/Apply to Exam (which will trigger window.confirm and then window.alert)
    await page.click('#editor-save-exam-btn');

    // Wait a brief timeout for saving process to finish and database to update
    await page.waitForTimeout(3000);

    // 7b. Save exam configurations in the settings form if needed (exam.passages is written during editorQuestions save)
    
    // 8. Logout admin
    await page.click('#logout-btn');
    await expect(page).toHaveURL(/.*\/index\.html|.*\/$/);

    // 9. Log in as Student
    await page.fill('input[type="email"]', 'siswa@example.com');
    await page.fill('input[type="password"]', 'Siswa123!');
    await page.click('button[type="submit"]');

    // Wait for student dashboard to load
    await expect(page).toHaveURL(/\/pages\/student\.html/);

    // Find "[Uji Sistem] E2E Automated Test" exam item, paginating if needed
    let examItem = page.locator('li', { hasText: '[Uji Sistem] E2E Automated Test' });
    let pageCount = 0;
    while (pageCount < 10) {
      if (await examItem.isVisible()) {
        break;
      }
      const nextBtn = page.locator('#next-page-btn');
      if (await nextBtn.isVisible() && !(await nextBtn.isDisabled())) {
        await nextBtn.click();
        await page.waitForTimeout(300); // short wait for page render
        examItem = page.locator('li', { hasText: '[Uji Sistem] E2E Automated Test' });
        pageCount++;
      } else {
        break;
      }
    }
    await expect(examItem).toBeVisible();

    // Click starting button
    const actionBtn = examItem.locator('.link-btn');
    await actionBtn.click();

    // Wait for exam page
    await expect(page).toHaveURL(/\/pages\/exam\.html/);

    // Dismiss fullscreen anti-cheat overlay
    const startFsBtn = page.locator('#start-fs-btn');
    await startFsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await startFsBtn.click();

    // Wait for exam to initialize and start button overlay to be hidden
    await expect(startFsBtn).toBeHidden({ timeout: 15000 });

    // Verify split screen layout is rendered
    const q1MapBtn = page.locator('#question-map button').first();
    if (await q1MapBtn.isVisible()) {
      await q1MapBtn.click();
      await page.waitForTimeout(500);
    }

    let foundSplit = false;
    for (let i = 0; i < 35; i++) {
      if (await page.locator('.split-question-container').isVisible()) {
        foundSplit = true;
        break;
      }
      const nextBtn = page.locator('#next-btn');
      if (await nextBtn.isVisible() && !(await nextBtn.isDisabled())) {
        await nextBtn.click();
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }
    expect(foundSplit).toBe(true);

    const passagePanel = page.locator('.passage-panel');
    await expect(passagePanel).toBeVisible();
    await expect(passagePanel.locator('.passage-header')).toHaveText('Wacana Uji Playwright');
    await expect(passagePanel.locator('.passage-body')).toContainText('Ini wacana otomatis dari Playwright');
  });
});
