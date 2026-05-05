const { expect } = require('@playwright/test');
const { E2E } = require('../fixtures');

async function login(page, {
  email = E2E.adminEmail,
  password = E2E.adminPassword,
} = {}) {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('#app-layout')).toBeVisible();
  await expect(page.locator('#account-switcher')).toBeVisible();
}

module.exports = { login };
