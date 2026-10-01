import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious').map((item) => ({
    rule: item.id,
    targets: item.nodes.map((node) => ({ target: node.target.join(' '), summary: node.failureSummary })),
  }))).toEqual([]);
}

test('initial workspace has no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Activities' })).toBeVisible();
  await page.getByRole('button', { name: 'Noor Note home' }).focus();
  await expect(page.getByRole('tooltip')).toContainText('Noor Note home');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expectNoSeriousViolations(page);
});

test('note, graph, Canvas, and settings surfaces expose usable semantics', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Create your first note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
  await expectNoSeriousViolations(page);

  const actions = page.getByRole('button', { name: 'Note actions' });
  await actions.click();
  await expect(page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu', { name: 'Note actions' }).getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();

  await page.getByRole('navigation', { name: 'Activities' }).getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('main').getByText('Knowledge graph')).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole('navigation', { name: 'Activities' }).getByRole('button', { name: 'Canvas' }).click();
  await expect(page.getByRole('main').getByText('Noor Canvas')).toBeVisible();
  await page.getByRole('textbox', { name: 'Canvas name' }).fill('Research board');
  await page.getByRole('button', { name: 'Create Canvas' }).click();
  await expect(page.getByRole('region', { name: 'Noor Canvas board' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(/Cards and connectors \(1 card/u).click();
  const card = page.getByRole('button', { name: /text: Untitled/u });
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const coordinates = await card.locator('..').locator('span').first().textContent();
  await page.getByRole('button', { name: 'Move right' }).click();
  await expect(card.locator('..').locator('span').first()).not.toHaveText(coordinates ?? '');
  await expectNoSeriousViolations(page);

  await page.getByRole('navigation', { name: 'Activities' }).getByRole('button', { name: 'Bases' }).click();
  await page.getByRole('textbox', { name: 'New Base name' }).fill('Accessible Base');
  await page.getByRole('button', { name: 'Create Base' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  const titleHeader = page.getByRole('columnheader', { name: /Title/u });
  await expect(titleHeader).toHaveAttribute('aria-sort', 'none');
  await titleHeader.getByRole('button', { name: 'Title', exact: true }).click();
  await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('button', { name: 'Move Title column right' })).toBeEnabled();
  await expectNoSeriousViolations(page);
  await page.getByRole('combobox', { name: 'New view type' }).selectOption('list');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const views = page.getByRole('tablist', { name: 'Base views' });
  await expect(views.getByRole('tab', { selected: true })).toContainText('List');
  await views.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(views.getByRole('tab', { selected: true })).toContainText('Table');
  await expect(views.getByRole('tab', { selected: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Table' })).toBeVisible();
  if (process.env.NOOR_A11Y_SCREENSHOT === '1') await page.screenshot({ path: 'test-results/a11y-desktop.png' });

  await page.getByRole('complementary', { name: 'Activity bar' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('main')).toContainText('Settings');
  await expectNoSeriousViolations(page);
});

test('command dialog traps focus and restores it on Escape', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  const trigger = page.getByRole('navigation', { name: 'Activities' }).getByRole('button', { name: 'Open command palette' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Noor Note commands' });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  await expectNoSeriousViolations(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('small viewports and reduced motion retain reachable navigation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    const bottom = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole('button', { name: 'More navigation' })).toBeVisible();
    const targets = await bottom.getByRole('button').evaluateAll((buttons) => buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    expect(targets.every(({ width: targetWidth, height }) => targetWidth >= 44 && height >= 44)).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await expectNoSeriousViolations(page);
    if (width === 320) {
      await page.getByRole('button', { name: 'Create your first note' }).click();
      await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
      if (process.env.NOOR_A11Y_SCREENSHOT === '1') await page.screenshot({ path: 'test-results/a11y-mobile.png' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await expectNoSeriousViolations(page);
    }
  }
  expect(pageErrors).toEqual([]);
});

test('system dark theme keeps shell text contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  await expectNoSeriousViolations(page);
});
