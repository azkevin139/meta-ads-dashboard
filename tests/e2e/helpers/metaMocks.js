async function mockCampaignApis(page) {
  await page.route('**/api/meta/live?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            campaign_id: 'cmp_e2e_a',
            campaign_name: 'E2E Lead Campaign',
            spend: '120.00',
            impressions: '10000',
            clicks: '400',
            ctr: '4.0',
            actions: [{ action_type: 'lead', value: '7' }, { action_type: 'link_click', value: '400' }],
            cost_per_action_type: [{ action_type: 'lead', value: '17.14' }],
          },
        ],
      }),
    });
  });

  await page.route('**/api/meta/campaigns', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'cmp_e2e_a',
            name: 'E2E Lead Campaign',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            desired_event: { event_type: 'LEAD', event_label: 'Lead' },
          },
        ],
      }),
    });
  });

  await page.route('**/api/meta/rate-limit-status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, safe_to_write: false, estimated_regain_seconds: 0, cache_budget: {} }),
    });
  });

  await page.route('**/api/intelligence/data-health**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [], warehouse_coverage: [], tracking_outage: { launch_readiness: { status: 'ready' } } }),
    });
  });
}

module.exports = { mockCampaignApis };
