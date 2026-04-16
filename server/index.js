const config = require('./config');
const { pool } = require('./db');
const { createApp } = require('./app');
const { startBackgroundJobs } = require('./jobs');

const app = createApp(config);

if (process.env.RUN_BACKGROUND_JOBS_IN_WEB === 'true') {
  startBackgroundJobs();
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   Meta Ads Dashboard — V2               ║
  ║   Port: ${String(config.port).padEnd(35)}║
  ║   Env: ${config.nodeEnv.padEnd(36)}║
  ║   Jobs in web: ${String(process.env.RUN_BACKGROUND_JOBS_IN_WEB === 'true').padEnd(25)}║
  ╚══════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});
