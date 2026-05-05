const { test, expect } = require('@playwright/test');
const { E2E } = require('./fixtures');
const { login } = require('./helpers/auth');

test('login rejects invalid credentials visibly and accepts valid admin credentials', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('Email').fill(E2E.adminEmail);
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('#login-error')).toContainText('Invalid email or password');

  await login(page);
  await expect(page.locator('#page-title')).toBeVisible();
  await expect(page.locator('#user-info')).toContainText('E2E Admin');
});
