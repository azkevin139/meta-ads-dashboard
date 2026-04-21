const metaLeadSync = require('./services/metaLeadSyncService');
const tokenHealth = require('./services/tokenHealthService');
const ghlSync = require('./services/ghlService');
const audiencePush = require('./services/audiencePushService');
const warehouseSync = require('./services/warehouseSyncService');
const touchSequences = require('./services/touchSequenceService');
const revisitAutomation = require('./services/revisitAutomationService');

const JOB_DEFINITIONS = [
  {
    name: 'lead-sync',
    disabledEnv: 'DISABLE_LEAD_SYNC',
    start: () => metaLeadSync.startBackgroundSync({ intervalMs: 15 * 60 * 1000 }),
  },
  {
    name: 'token-check',
    disabledEnv: 'DISABLE_TOKEN_CHECK',
    start: () => tokenHealth.startBackgroundCheck({ intervalMs: 24 * 3600 * 1000 }),
  },
  {
    name: 'ghl-sync',
    disabledEnv: 'DISABLE_GHL_SYNC',
    start: () => ghlSync.startBackgroundSync({ intervalMs: 6 * 3600 * 1000 }),
  },
  {
    name: 'audience-refresh',
    disabledEnv: 'DISABLE_AUDIENCE_REFRESH',
    start: () => audiencePush.startBackgroundRefresh({ intervalMs: 60 * 60 * 1000 }),
  },
  {
    name: 'warehouse-sync',
    disabledEnv: 'DISABLE_WAREHOUSE_SYNC',
    start: () => warehouseSync.startBackgroundSync({ intervalMs: 6 * 60 * 60 * 1000 }),
  },
  {
    name: 'touch-sequence-monitor',
    disabledEnv: 'DISABLE_TOUCH_SEQUENCE_MONITOR',
    start: () => touchSequences.startBackgroundMonitor(),
  },
  {
    name: 'revisit-automation',
    disabledEnv: 'DISABLE_REVISIT_AUTOMATION',
    start: () => revisitAutomation.startBackgroundProcessor(),
  },
];

function startBackgroundJobs() {
  const started = [];
  for (const job of JOB_DEFINITIONS) {
    if (process.env[job.disabledEnv] === 'true') continue;
    job.start();
    started.push(job.name);
  }
  return started;
}

module.exports = { JOB_DEFINITIONS, startBackgroundJobs };
