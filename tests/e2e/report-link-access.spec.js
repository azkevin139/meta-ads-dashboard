const { test, expect } = require('@playwright/test');
const { E2E } = require('./fixtures');

test('signed report link works and revoked or expired links fail cleanly', async ({ page, request }) => {
  const valid = await request.get(`/api/public/reports/${E2E.validReportToken}/lead-summary?preset=7d`);
  expect(valid.ok()).toBeTruthy();
  const validBody = await valid.json();
  expect(validBody.account.name).toBe('E2E Primary Account');

  const revoked = await request.get(`/api/public/reports/${E2E.revokedReportToken}/lead-summary?preset=7d`);
  expect(revoked.status()).toBe(403);

  const expired = await request.get(`/api/public/reports/${E2E.expiredReportToken}/lead-summary?preset=7d`);
  expect(expired.status()).toBe(403);

  await page.goto(`/report/${E2E.revokedReportToken}`);
  await expect(page.getByText('Report unavailable')).toBeVisible();
  await expect(page.getByText('no longer valid')).toBeVisible();
});
