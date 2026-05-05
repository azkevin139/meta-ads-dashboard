const { execFileSync } = require('node:child_process');

module.exports = async function globalSetup() {
  if (process.env.PLAYWRIGHT_SKIP_SEED === 'true') return;
  execFileSync('node', ['scripts/seedE2eDb.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'test',
    },
  });
};
