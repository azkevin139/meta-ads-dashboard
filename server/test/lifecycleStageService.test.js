const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStage } = require('../services/lifecycleStageService');

test('normalizeStage maps common lifecycle states', () => {
  assert.equal(normalizeStage('Lead Captured'), 'new_lead');
  assert.equal(normalizeStage('Contacted - SMS Sent'), 'contacted');
  assert.equal(normalizeStage('Qualified'), 'qualified');
  assert.equal(normalizeStage('Appointment Booked'), 'booked');
  assert.equal(normalizeStage('Showed Up'), 'showed');
  assert.equal(normalizeStage('Closed Won'), 'closed_won');
  assert.equal(normalizeStage('Closed Lost'), 'closed_lost');
});

test('normalizeStage promotes revenue to closed_won', () => {
  assert.equal(normalizeStage('Qualified', { revenue: 1500 }), 'closed_won');
});
