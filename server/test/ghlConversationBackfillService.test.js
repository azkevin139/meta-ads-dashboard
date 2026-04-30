const test = require('node:test');
const assert = require('node:assert/strict');

const backfill = require('../services/ghlConversationBackfillService');

test('isInboundMessage accepts common inbound direction values', () => {
  assert.equal(backfill.isInboundMessage({ direction: 'inbound' }), true);
  assert.equal(backfill.isInboundMessage({ messageDirection: 'incoming' }), true);
  assert.equal(backfill.isInboundMessage({ status: 'received' }), true);
});

test('isInboundMessage rejects outbound-only values', () => {
  assert.equal(backfill.isInboundMessage({ direction: 'outbound' }), false);
  assert.equal(backfill.isInboundMessage({ messageDirection: 'sent' }), false);
  assert.equal(backfill.isInboundMessage({ type: 'SMS' }), false);
});
