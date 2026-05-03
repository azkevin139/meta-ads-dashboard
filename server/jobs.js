const metaLeadSync = require('./services/metaLeadSyncService');
const tokenHealth = require('./services/tokenHealthService');
const ghlSync = require('./services/ghlService');
const audiencePush = require('./services/audiencePushService');
const audienceAutomation = require('./services/audienceAutomationService');
const warehouseSync = require('./services/warehouseSyncService');
const touchSequences = require('./services/touchSequenceService');
const revisitAutomation = require('./services/revisitAutomationService');
const accountService = require('./services/accountService');
const jobRuns = require('./services/jobRunService');
const config = require('./config');

function sum(rows, field) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
}

function errorCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.error).length;
}

function statusFromErrors(rows) {
  return errorCount(rows) > 0 ? 'partial' : 'success';
}

async function runTouchSequenceMonitor() {
  const accounts = await accountService.listAccounts();
  const results = [];
  for (const account of accounts) {
    if (!account.is_active) continue;
    try {
      const fullAccount = await accountService.getAccountById(account.id);
      const rows = await touchSequences.runMonitorForAccount(fullAccount);
      results.push({ account_id: account.id, sequences: Array.isArray(rows) ? rows.length : 0 });
    } catch (err) {
      results.push({ account_id: account.id, error: err.message });
    }
  }
  return results;
}

async function runRevisitAutomation() {
  const settings = revisitAutomation.getConfigSummary();
  if (!settings.enabled) return { skipped: true, reason: 'disabled' };
  return revisitAutomation.processDueJobs({ limit: 10 });
}

const JOB_DEFINITIONS = [
  {
    name: 'lead-sync',
    disabledEnv: 'DISABLE_LEAD_SYNC',
    intervalMs: 15 * 60 * 1000,
    initialDelayMs: 30 * 1000,
    run: () => metaLeadSync.syncAllAccounts(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      imported: sum(results, 'imported'),
      scanned: sum(results, 'scanned'),
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.imported > 0) console.log(`[leadSync] imported ${summary.imported} leads across ${summary.accounts} account(s)`);
    },
  },
  {
    name: 'token-check',
    disabledEnv: 'DISABLE_TOKEN_CHECK',
    intervalMs: 24 * 3600 * 1000,
    initialDelayMs: 2 * 60 * 1000,
    run: () => tokenHealth.checkAllAccounts(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      expiring_soon: (Array.isArray(results) ? results : []).filter((row) => row.expires_at && tokenHealth.daysUntil(row.expires_at) <= 14).length,
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.expiring_soon > 0) console.warn(`[tokenHealth] ${summary.expiring_soon} Meta token(s) expiring within 14 days`);
    },
  },
  {
    name: 'ghl-sync',
    disabledEnv: 'DISABLE_GHL_SYNC',
    intervalMs: 6 * 3600 * 1000,
    initialDelayMs: 5 * 60 * 1000,
    run: () => ghlSync.syncAllConfigured(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      imported: sum(results, 'imported'),
      matched: sum(results, 'matched'),
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.imported > 0) console.log(`[ghlSync] imported ${summary.imported} contact(s) across ${summary.accounts} account(s)`);
    },
  },
  {
    name: 'ghl-fast-sync',
    disabledEnv: 'DISABLE_GHL_FAST_SYNC',
    intervalMs: 15 * 60 * 1000,
    initialDelayMs: 90 * 1000,
    run: () => ghlSync.syncFastConfigured(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      imported: sum(results, 'imported'),
      matched: sum(results, 'matched'),
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.imported > 0) console.log(`[ghlSyncFast] imported ${summary.imported} contact(s) across ${summary.accounts} fast-sync account(s)`);
    },
  },
  {
    name: 'audience-refresh',
    disabledEnv: 'DISABLE_AUDIENCE_REFRESH',
    intervalMs: 60 * 60 * 1000,
    initialDelayMs: 10 * 60 * 1000,
    run: () => audiencePush.refreshDue(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      pushes: Array.isArray(results) ? results.length : 0,
      uploaded: sum(results, 'uploaded'),
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.uploaded > 0) console.log(`[audiencePush] refreshed ${summary.pushes} segment(s), uploaded ${summary.uploaded} identifiers`);
    },
  },
  {
    name: 'audience-automation',
    disabledEnv: 'DISABLE_AUDIENCE_AUTOMATION',
    intervalMs: 15 * 60 * 1000,
    initialDelayMs: 60 * 1000,
    run: () => audienceAutomation.evaluateFastSyncAccounts(),
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      triggered: sum(results, 'triggered'),
      errors: errorCount(results),
    }),
    log: (summary) => {
      if (summary.triggered > 0) console.log(`[audienceAutomation] triggered ${summary.triggered} rule(s) across ${summary.accounts} account(s)`);
    },
  },
  {
    name: 'warehouse-sync',
    disabledEnv: 'DISABLE_WAREHOUSE_SYNC',
    intervalMs: 6 * 60 * 60 * 1000,
    initialDelayMs: 20 * 60 * 1000,
    run: () => warehouseSync.syncAll({ days: 3 }),
    summarize: (results) => {
      const insights = (Array.isArray(results) ? results : []).reduce((total, row) => {
        const inserted = row?.insights?.inserted || {};
        return total + Object.values(inserted).reduce((a, b) => a + (Number(b) || 0), 0);
      }, 0);
      return {
        status: statusFromErrors(results),
        accounts: Array.isArray(results) ? results.length : 0,
        campaigns: sum(results, 'campaigns'),
        insights,
        errors: errorCount(results),
      };
    },
    log: (summary) => {
      if (summary.campaigns > 0 || summary.insights > 0) {
        console.log(`[warehouse] synced ${summary.campaigns} campaigns and ${summary.insights} insight rows across ${summary.accounts} account(s)`);
      }
    },
  },
  {
    name: 'touch-sequence-monitor',
    disabledEnv: 'DISABLE_TOUCH_SEQUENCE_MONITOR',
    intervalMs: config.touchSequences.monitorIntervalMs,
    initialDelayMs: 15 * 60 * 1000,
    run: runTouchSequenceMonitor,
    summarize: (results) => ({
      status: statusFromErrors(results),
      accounts: Array.isArray(results) ? results.length : 0,
      sequences: sum(results, 'sequences'),
      errors: errorCount(results),
    }),
  },
  {
    name: 'revisit-automation',
    disabledEnv: 'DISABLE_REVISIT_AUTOMATION',
    intervalMs: revisitAutomation.getConfigSummary().interval_ms || 30000,
    initialDelayMs: revisitAutomation.getConfigSummary().interval_ms || 30000,
    run: runRevisitAutomation,
    summarize: (result) => {
      if (result?.skipped) return { status: 'skipped', reason: result.reason };
      return {
        status: result?.failed > 0 ? 'partial' : 'success',
        processed: Number(result?.processed) || 0,
        delivered: Number(result?.delivered) || 0,
        failed: Number(result?.failed) || 0,
      };
    },
  },
];

function scheduleJob(job) {
  let running = false;
  const run = async () => {
    if (running) {
      await jobRuns.recordRun({
        jobName: job.name,
        summary: { reason: 'previous_run_still_running' },
      }, async () => ({ skipped: true }), {
        summarize: () => ({ status: 'skipped', reason: 'previous_run_still_running' }),
      }).catch((err) => console.error(`[${job.name}] skipped-run heartbeat failed: ${err.message}`));
      return;
    }
    running = true;
    try {
      const result = await jobRuns.recordRun({ jobName: job.name }, job.run, { summarize: job.summarize });
      const summary = job.summarize ? job.summarize(result) : {};
      job.log?.(summary);
    } catch (err) {
      console.error(`[${job.name}] background run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, job.intervalMs);
  timer.unref?.();
  setTimeout(run, job.initialDelayMs).unref?.();
  return timer;
}

function startBackgroundJobs() {
  const started = [];
  for (const job of JOB_DEFINITIONS) {
    if (process.env[job.disabledEnv] === 'true') continue;
    scheduleJob(job);
    started.push(job.name);
  }
  return started;
}

module.exports = { JOB_DEFINITIONS, startBackgroundJobs, scheduleJob };
