const { pool } = require('./db');
const config = require('./config');
const { startBackgroundJobs } = require('./jobs');

if (config.usingLegacySecrets) {
  console.warn('[bootstrap] Legacy secret fallback is still enabled. Rotate stored sessions/tokens and remove LEGACY_* secrets when ready.');
}

const startedJobs = startBackgroundJobs();
console.log(`[worker] Background jobs started: ${startedJobs.join(', ') || 'none'}`);

process.on('SIGTERM', async () => {
  console.log('[worker] Shutting down...');
  await pool.end();
  process.exit(0);
});
