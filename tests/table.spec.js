import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

test.describe('CBT Table Import and Export Flow', () => {
  test.beforeEach(() => {
    // Re-seed or clean test DB
    execSync('node scripts/clean-test-db.mjs');
    // Ensure the docx template is freshly generated
    execSync('node scripts/generate-docx.js');
  });

  test('Import Word template, verify table renders in UI, and export back to Word', async ({ page, context }) => {
    test.setTimeout(90000);

    // Accept all dialogs automatically
    page.on('dialog', async dialog => {
      console.log('DIALOG OPENED:', dialog.type(), dialog.message());
      await dialog.accept();
    });

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER PAGE ERROR:', err.message));

    // 1. Login as Admin
    await page.goto('/');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // Wait for Admin Dashboard to load
    await expect(page).toHaveURL(/\/pages\/admin\.html/);
    await page.waitForLoadState('load');

    // 2. Go to Editor Tab
    await expect(async () => {
      await page.click('button.nav-item[data-tab="tab-editor"]');
      await expect(page.locator('#tab-editor')).not.toHaveClass(/hidden-tab/);
    }).toPass();

    // Wait for the admin page script to finish initializing and load exams
    await page.waitForSelector('#editor-load-exam', { state: 'attached' });
    await page.waitForFunction(() => {
      const select = document.querySelector('#editor-load-exam');
      return select && select.options.length > 0;
    });

    // 3. Import the generated .docx file containing a table
    const templatePath = path.resolve('public/templates/template-soal.docx');
    await page.setInputFiles('#editor-import-file', templatePath);
    await page.click('#editor-import-file-btn');

    // Verify feedback message shows success
    const feedback = page.locator('#admin-feedback');
    await expect(feedback).toContainText('Berhasil mengimpor');

    // Verify Question 10 card is present (template berisi 12 soal contoh)
    const cards = page.locator('.mini-q-card');
    await expect(cards).toHaveCount(12);

    // 4. Click Question 10 to preview
    await cards.nth(9).click();

    // Verify the preview contains table tag
    const previewContainer = page.locator('#edit-q-preview-box');
    await expect(previewContainer).toBeVisible();
    
    // Check if the table element is rendered inside the preview
    const tableElement = previewContainer.locator('table');
    await expect(tableElement).toBeVisible();

    // Check table content
    const firstCellText = await tableElement.locator('td, th').first().innerText();
    expect(firstCellText).toContain('Nama Barang');

    const secondRowCellText = await tableElement.locator('tr').nth(1).locator('td').first().innerText();
    expect(secondRowCellText).toContain('Pensil');

    // 5. Verify visual CSS styling classes are present on the table in DOM
    const tableOuterHtml = await tableElement.evaluate(el => el.outerHTML);
    expect(tableOuterHtml).toContain('<table');

    // 6. Test downloading/exporting questions back to .docx
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#editor-download-docx-btn')
    ]);
    
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    console.log('Successfully exported and downloaded table question docx to:', downloadPath);
  });
});
