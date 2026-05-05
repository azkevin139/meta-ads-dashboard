const { test, expect } = require('@playwright/test');
const { E2E } = require('./fixtures');
const { login } = require('./helpers/auth');

test('internal client report page renders key summary widgets', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Reports' }).click();

  await expect(page.locator('#page-title')).toHaveText('Client Report');
  await expect(page.locator('.report-kpi').filter({ hasText: 'Total leads' })).toBeVisible();
  await expect(page.locator('.report-kpi').filter({ hasText: 'Qualified leads' })).toBeVisible();
  await expect(page.getByText('Meta Lead Form Funnel')).toBeVisible();
  await expect(page.getByText('Website Funnel')).toBeVisible();
  await expect(page.getByText('Data Freshness')).toBeVisible();
});

test('public report link loads the client shell and seeded report data', async ({ page }) => {
  await page.goto(`/report/${E2E.validReportToken}`);

  await expect(page.locator('#clientTitle')).toHaveText('E2E Primary Account');
  await expect(page.getByText('Performance overview')).toBeVisible();
  await expect(page.locator('.kpi-card').filter({ hasText: 'Total leads' })).toContainText('3');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Qualified leads' })).toContainText('2');
  await expect(page.getByText('Download PDF')).toBeVisible();
  await expect(page.getByText('Speak to Amin')).toBeVisible();
  await expect(page.getByText('Speak to Kevin')).toBeVisible();
});
