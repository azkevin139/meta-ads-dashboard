const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('config requires DATABASE_URL and AUTH_SECRET in production', () => {
  const result = spawnSync(process.execPath, ['-e', "require('/root/meta-ads-dashboard/server/config')"], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: '',
      AUTH_SECRET: '',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL must be set in production/);
});
