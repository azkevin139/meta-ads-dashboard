const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../services/revisitAutomationService');

test('derivePagePath extracts a pathname', () => {
  assert.equal(service.derivePagePath('https://example.com/pricing?x=1'), '/pricing');
  assert.equal(service.derivePagePath('/pricing/visa'), '/pricing/visa');
});

test('evaluateEligibility rejects missing GHL contact and closed won contacts', () => {
  const settings = {
    enabled: true,
    webhookUrl: 'https://n8n.example.com/hook',
    keyPaths: ['/pricing'],
  };

  const missingContact = service.evaluateEligibility({
    normalized_stage: 'qualified',
    ghl_contact_id: null,
  }, {
    pageUrl: 'https://example.com/pricing',
    settings,
  });
  assert.equal(missingContact.eligible, false);
  assert.ok(missingContact.reasons.includes('missing_ghl_contact_id'));

  const closedWon = service.evaluateEligibility({
    normalized_stage: 'closed_won',
    ghl_contact_id: 'ghl_1',
  }, {
    pageUrl: 'https://example.com/pricing',
    settings,
  });
  assert.equal(closedWon.eligible, false);
  assert.ok(closedWon.reasons.includes('closed_won'));
});

test('evaluateEligibility accepts an eligible known contact revisit', () => {
  const result = service.evaluateEligibility({
    normalized_stage: 'qualified',
    ghl_contact_id: 'ghl_1',
    raw: {},
  }, {
    pageUrl: 'https://example.com/pricing',
    settings: {
      enabled: true,
      webhookUrl: 'https://n8n.example.com/hook',
      keyPaths: ['/pricing'],
    },
  });

  assert.equal(result.eligible, true);
  assert.equal(result.ruleKey, 'known_contact_revisit');
  assert.equal(result.pagePath, '/pricing');
});
