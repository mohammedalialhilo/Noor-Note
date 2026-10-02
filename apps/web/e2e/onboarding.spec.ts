import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('fresh browsers can create a local vault, skip the tour, and return without onboarding', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const welcome = page.getByRole('dialog', { name: 'Welcome to Noor Note' });
    await expect(welcome).toBeVisible();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => item.id)).toEqual([]);
    await expect(welcome.getByRole('button', { name: /Sign in/ })).toBeDisabled();
    await welcome.getByRole('textbox', { name: 'Name your local vault' }).fill('Research');
    await welcome.getByRole('button', { name: 'Create local vault' }).click();
    const tour = page.getByRole('dialog', { name: 'A quick tour of Noor Note' });
    await expect(tour).toBeVisible();
    await tour.getByRole('button', { name: 'Skip tutorial' }).click();
    await expect(page.getByRole('dialog', { name: 'A quick tour of Noor Note' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Welcome to Noor Note' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Vault file explorer' }).getByRole('combobox', { name: 'Active vault' }).locator('option:checked')).toHaveText('Research');
  } finally { await context.close(); }
});

test('import can be canceled, then reviewed and completed', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('dialog', { name: 'Welcome to Noor Note' }).getByRole('button', { name: /Import Markdown vault/ }).click();
    const importDialog = page.getByRole('dialog', { name: /Import/ });
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Cancel' }).click();
    const welcome = page.getByRole('dialog', { name: 'Welcome to Noor Note' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: /Import Markdown vault/ }).click();
    await importDialog.locator('input[type="file"]').first().setInputFiles({ name: 'Welcome.md', mimeType: 'text/markdown', buffer: Buffer.from('# Welcome\n\nImported.') });
    await expect(importDialog.getByLabel('Import preview')).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import 1 item' }).click();
    await expect(importDialog.getByRole('status').filter({ hasText: 'Imported 1 item' })).toBeVisible();
    await importDialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog', { name: 'A quick tour of Noor Note' })).toBeVisible();
  } finally { await context.close(); }
});

test('supported folder picker opens a read-only folder in Import Center', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => ({
        kind: 'directory', name: 'Source', values: async function* () {
          yield { kind: 'directory', name: 'Projects', values: async function* () {
            yield { kind: 'file', name: 'Folder.md', getFile: async () => new File(['# Folder'], 'Folder.md', { type: 'text/markdown' }) };
          } };
        },
      }) });
    });
    await page.goto('/');
    await page.getByRole('dialog', { name: 'Welcome to Noor Note' }).getByRole('button', { name: /Open filesystem folder/ }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import Center' });
    await expect(importDialog.getByLabel('Import preview')).toContainText('Projects/Folder.md');
    await expect(importDialog.getByLabel('Import preview')).toContainText('/Projects/Folder.md');
  } finally { await context.close(); }
});
