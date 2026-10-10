import { test, expect } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function expectActiveTab(page, active) {
  const inactive = active === 'merge' ? 'split' : 'merge';
  await expect(page.locator(`#tab-${active}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`#tab-${inactive}`)).toHaveAttribute('aria-selected', 'false');
  // Roving tabindex: only the active tab is in the tab sequence.
  await expect(page.locator(`#tab-${inactive}`)).toHaveAttribute('tabindex', '-1');
  await expect(page.locator(`#panel-${active}`)).toBeVisible();
  await expect(page.locator(`#panel-${inactive}`)).toBeHidden();
  await expect(page.locator(`#panel-${inactive}`)).toHaveAttribute('hidden');
}

test('Tabs folgen dem WAI-ARIA-Muster', async ({ page }) => {
  for (const name of ['merge', 'split']) {
    await expect(page.locator(`#tab-${name}`)).toHaveAttribute('role', 'tab');
    await expect(page.locator(`#panel-${name}`)).toHaveAttribute('role', 'tabpanel');
  }
  await expect(page.locator('#tab-merge')).toHaveAttribute('aria-controls', 'panel-merge');
  await expect(page.locator('#tab-split')).toHaveAttribute('aria-controls', 'panel-split');
  await expectActiveTab(page, 'merge');
});

test('Tabs lassen sich mit den Pfeiltasten bedienen', async ({ page }) => {
  await page.locator('#tab-merge').focus();

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-split')).toBeFocused();
  // Works for automatic and manual activation alike.
  await page.keyboard.press('Enter');
  await expectActiveTab(page, 'split');
  await expect(page.locator('#tab-split')).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tab-merge')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectActiveTab(page, 'merge');
});

test('Tabs wechseln per Mausklick', async ({ page }) => {
  await page.locator('#tab-split').click();
  await expectActiveTab(page, 'split');
  await page.locator('#tab-merge').click();
  await expectActiveTab(page, 'merge');
});
