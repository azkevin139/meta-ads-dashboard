const { test, expect } = require('@playwright/test');
const { E2E } = require('./fixtures');
const { login } = require('./helpers/auth');
const { mockCampaignApis } = require('./helpers/metaMocks');

test('campaigns page loads with action-first table and cross-scope write fails', async ({ page }) => {
  await mockCampaignApis(page);
  await login(page);

  await page.locator('.sidebar [data-page="campaigns"]').click();
  await expect(page.locator('#page-title')).toHaveText('Campaigns');
  await expect(page.getByText('E2E Lead Campaign')).toBeVisible();
  await expect(page.locator('.table-title', { hasText: 'Campaigns' })).toBeVisible();
  await expect(page.locator('#campaign-action-briefing')).toContainText(/campaign/i);

  const status = await page.evaluate(async ({ accountA }) => {
    const csrf = window.SessionState.getCsrfToken();
    const res = await fetch('/api/meta/entity/campaign/cmp_e2e_b/status', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ accountId: Number(accountA), status: 'PAUSED' }),
    });
    return res.status;
  }, { accountA: E2E.accountA });

  expect(status).toBe(403);
});
