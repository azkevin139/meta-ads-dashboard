const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('client report shell keeps client-safe branding and contact CTAs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/client-report.html'), 'utf8');
  assert.match(html, /Speak to Amin/);
  assert.match(html, /Speak to Kevin/);
  assert.match(html, /slack\.com\/app_redirect/);
  assert.doesNotMatch(html, /GoHighLevel|Go High Level|GHL/);
});
