const { test, expect } = require('@playwright/test');
const { E2E } = require('./fixtures');
const { login } = require('./helpers/auth');

test('account switch updates the active account context', async ({ page }) => {
  await login(page);

  await expect(page.locator('#account-switcher')).toHaveValue(E2E.accountA);
  await page.locator('#account-switcher').selectOption(E2E.accountB);

  await expect(page.locator('#account-switcher')).toHaveValue(E2E.accountB);
  await expect(page.locator('.toast')).toContainText('Switched to E2E Secondary Account');
});
