import { expect, test } from '@playwright/test';

test('settings categories expose scoped controls and persist editor defaults', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('complementary', { name: 'Activity bar' }).getByRole('button', { name: 'Settings' }).click();
  const categories = page.getByRole('navigation', { name: 'Settings categories' });
  await expect(categories.getByRole('button')).toHaveCount(23);
  await categories.getByRole('button', { name: 'Editor', exact: true }).click();
  const spellcheck = page.getByRole('checkbox', { name: 'Spellcheck' });
  await expect(spellcheck).toBeChecked();
  await spellcheck.uncheck();
  await categories.getByRole('button', { name: 'Files & Links' }).click();
  await expect(page.getByRole('combobox', { name: 'Sort files by' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('complementary', { name: 'Activity bar' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Spellcheck' })).not.toBeChecked();
});
