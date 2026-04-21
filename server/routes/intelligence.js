const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const intelligence = require('../services/intelligenceService');
const tracking = require('../services/trackingService');
const trackingRecovery = require('../services/trackingRecoveryService');
const audiencePush = require('../services/audiencePushService');
const touchSequences = require('../services/touchSequenceService');
const revisitAutomation = require('../services/revisitAutomationService');
const accountAccess = require('../services/accountAccessService');
const securityAudit = require('../services/securityAuditService');
const syncTruth = require('../services/syncTruthService');
const identityCollisions = require('../services/identityCollisionService');
const { queryAll } = require('../db');
const {
  ensureArray,
  ensureBoolean,
  ensureInteger,
  ensureNonEmptyString,
  ensureObject,
  optionalInteger,
  optionalTrimmedString,
} = require('../validation');

function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    securityAudit.fromRequest(req, {
      action: 'operator.denied',
      target_type: 'intelligence_route',
      target_id: req.path,
      result: 'denied',
    });
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

router.get('/account-context', async (req, res) => {
  try {
    res.json(await intelligence.getAccountContext(req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/targets', async (req, res) => {
  try {
    res.json({ data: intelligence.readTargets(), defaults: intelligence.DEFAULT_TARGETS });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/targets', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const current = intelligence.readTargets();
    const next = {
      account: { ...current.account, ...(body.account || {}) },
      campaigns: { ...current.campaigns, ...(body.campaigns || {}) },
    };
    res.json({ data: intelligence.writeTargets(next) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/rules', async (req, res) => {
  try {
    res.json(await intelligence.getDecisionRules(req.query, req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/funnel', async (req, res) => {
  try {
    res.json({ data: await intelligence.getFunnel(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/first-party-funnel', async (req, res) => {
  try {
    res.json({ data: await intelligence.getFirstPartyFunnel(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/journey', async (req, res) => {
  try {
    res.json({ data: await intelligence.getJourney(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/contact', async (req, res) => {
  try {
    const detail = await intelligence.getContactDetail(req.query, req.metaAccount);
    if (!detail) return res.status(404).json({ error: 'Contact not found' });
    res.json({ data: detail });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/true-roas', async (req, res) => {
  try {
    res.json({ data: await intelligence.getTrueRoas(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-health', async (req, res) => {
  try {
    res.json({ data: await intelligence.getAudienceHealth(req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/data-health', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const runs = await syncTruth.getHealth(account.id);
    const warehouseCoverage = await queryAll(`
      SELECT
        account_id,
        level,
        MIN(date) AS coverage_start,
        MAX(date) AS coverage_end,
        COUNT(*)::int AS row_count,
        COUNT(DISTINCT date)::int AS day_count,
        MAX(date) AS latest_date
      FROM daily_insights
      WHERE account_id = $1
      GROUP BY account_id, level
      ORDER BY account_id, level
    `, [account.id]);
    const outageWindow = await trackingRecovery.getWindow(account.id, { includeRecovered: true });
    const outageReadiness = outageWindow
      ? {
          status: outageWindow.status === 'active' ? 'warning' : 'ready',
          reasons: outageWindow.status === 'active' ? ['active_tracking_outage_window'] : [],
          window_id: outageWindow.id,
          outage_start: outageWindow.outage_start,
          outage_end: outageWindow.outage_end,
          last_backfill_at: outageWindow.last_backfill_at,
        }
      : { status: 'ready', reasons: [] };
    res.json({
      account_id: account.id,
      data: runs,
      warehouse_coverage: warehouseCoverage,
      tracking_outage: {
        window: outageWindow,
        launch_readiness: outageReadiness,
      },
      reason_codes: [
        'tracker_not_installed',
        'tracker_underreporting',
        'meta_sync_partial',
        'meta_rate_limited',
        'lead_sync_ad_cap',
        'ghl_auth_failed',
        'ghl_stage_unmapped',
        'warehouse_stale',
        'true_zero_likely',
        'identity_low_confidence',
        'outage_window_applied',
        'no_token',
      ],
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-segments', async (req, res) => {
  try {
    res.json(await intelligence.getAudienceSegments(req.query, req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/lifecycle-summary', async (req, res) => {
  try {
    res.json({ data: await intelligence.getLifecycleSummary(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/identity-health', async (req, res) => {
  try {
    res.json({ data: await intelligence.getIdentityHealth(req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/identity-collisions', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const data = await identityCollisions.listCollisionGroups(account.id, {
      status: optionalTrimmedString(req.query.status, 30) || 'open',
      limit: optionalInteger(req.query.limit, 'limit must be a positive integer') || 50,
    });
    const metrics = await identityCollisions.getIntegrityMetrics(account.id);
    res.json({ data, metrics });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/identity-integrity', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    res.json({ data: await identityCollisions.getIntegrityMetrics(account.id) });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/identity-collisions/:id/resolve', adminOrOperator, async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.body?.accountId, { allowAdminOverride: true });
    const groupId = ensureInteger(req.params.id, 'id must be a positive integer');
    const body = ensureObject(req.body);
    const decision = ensureNonEmptyString(body.decision, 'decision required');
    const rationale = optionalTrimmedString(body.rationale, 1000);
    const result = await identityCollisions.resolveCollisionGroup(account.id, groupId, {
      decision,
      rationale,
      userId: req.user?.id,
    });
    await securityAudit.fromRequest(req, {
      action: 'identity_collision.resolved',
      target_type: 'identity_collision_group',
      target_id: String(groupId),
      account_id: account.id,
      before_json: { previous_status: result.resolution.previous_status },
      after_json: {
        decision,
        next_status: result.resolution.next_status,
        rationale,
      },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/breakdowns', async (req, res) => {
  try {
    res.json({ data: await intelligence.getBreakdowns(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-pushes', async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.json({ data: [] });
    const rows = await audiencePush.listPushes(accountId);
    res.json({ data: rows });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/touch-sequences', async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.json({ data: [], defaults: touchSequences.DEFAULT_SEVEN_TOUCH_TEMPLATE });
    const data = await touchSequences.listSequences(accountId);
    res.json({ data, defaults: touchSequences.DEFAULT_SEVEN_TOUCH_TEMPLATE });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences', adminOrOperator, async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    const body = ensureObject(req.body);
    const steps = ensureArray(body.steps, 'steps required');
    const result = await touchSequences.saveSequence(accountId, {
      id: body.id,
      name: ensureNonEmptyString(body.name, 'name required'),
      description: optionalTrimmedString(body.description, 1000),
      threshold_default: body.threshold_default,
      n8n_webhook_url: optionalTrimmedString(body.n8n_webhook_url, 2000),
      enabled: body.enabled,
      steps,
    });
    await securityAudit.fromRequest(req, {
      action: 'touch_sequence.saved',
      target_type: 'touch_sequence',
      target_id: String(result.id),
      account_id: accountId,
      after_json: { ...result, steps_count: steps.length },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/touch-sequences/:id', adminOrOperator, async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    const sequenceId = ensureInteger(req.params.id, 'id must be a positive integer');
    await touchSequences.deleteSequence(accountId, sequenceId);
    await securityAudit.fromRequest(req, {
      action: 'touch_sequence.deleted',
      target_type: 'touch_sequence',
      target_id: String(sequenceId),
      account_id: accountId,
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences/run-monitor', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const result = await touchSequences.runMonitorForAccount(account);
    await securityAudit.fromRequest(req, {
      action: 'touch_sequence.monitor_triggered',
      target_type: 'account',
      target_id: String(account.id),
      account_id: account.id,
      after_json: result,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences/:id/run-monitor', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const sequenceId = ensureInteger(req.params.id, 'id must be a positive integer');
    const result = await touchSequences.runMonitorForSequence(account, sequenceId);
    await securityAudit.fromRequest(req, {
      action: 'touch_sequence.monitor_triggered',
      target_type: 'touch_sequence',
      target_id: String(sequenceId),
      account_id: account.id,
      after_json: result,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/audience-push', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const body = ensureObject(req.body);
    const segmentKey = ensureNonEmptyString(body.segmentKey, 'segmentKey required');
    const segmentName = optionalTrimmedString(body.segmentName, 200);
    const result = await audiencePush.pushSegment(account, { segmentKey, segmentName });
    await securityAudit.fromRequest(req, {
      action: 'audience_push.triggered',
      target_type: 'audience_segment',
      target_id: segmentKey,
      account_id: account.id,
      after_json: result,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/audience-push/:id/auto-refresh', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    await audiencePush.setAutoRefresh(
      ensureInteger(req.params.id, 'id must be a positive integer'),
      ensureBoolean(body.enabled, 'enabled must be true or false'),
      optionalInteger(body.hours, 'hours must be a positive integer')
    );
    await securityAudit.fromRequest(req, {
      action: 'audience_push.auto_refresh_changed',
      target_type: 'audience_push',
      target_id: String(req.params.id),
      after_json: body,
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tracking-health', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const health = await tracking.getHealth(account.id);
    res.json(health);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tracking-recovery', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const summary = await trackingRecovery.getSummary(account.id);
    res.json(summary);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tracking-alerts', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const hours = req.query.hours ? ensureInteger(req.query.hours, 'hours must be a positive integer') : 24;
    const alerts = await trackingRecovery.getAlerts(account.id, { hours });
    res.json(alerts);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tracking-recovery', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const account = await accountAccess.resolveAuthorizedAccount(req, body.accountId, { allowAdminOverride: true });
    const saved = await trackingRecovery.saveWindow(account.id, {
      outage_start: ensureNonEmptyString(body.outage_start, 'outage_start required'),
      outage_end: ensureNonEmptyString(body.outage_end, 'outage_end required'),
      notes: optionalTrimmedString(body.notes, 1000),
    });
    await securityAudit.fromRequest(req, {
      action: 'tracking_recovery.window_saved',
      target_type: 'tracking_recovery',
      target_id: String(saved.id || account.id),
      account_id: account.id,
      after_json: saved,
    });
    res.json({ success: true, data: saved });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tracking-recovery/backfill', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const account = await accountAccess.resolveAuthorizedAccount(req, body.accountId, { allowAdminOverride: true });
    const window = await trackingRecovery.saveWindow(account.id, {
      outage_start: ensureNonEmptyString(body.outage_start, 'outage_start required'),
      outage_end: ensureNonEmptyString(body.outage_end, 'outage_end required'),
      notes: optionalTrimmedString(body.notes, 1000),
    });
    const result = await trackingRecovery.runBackfill(account.id, window);
    await securityAudit.fromRequest(req, {
      action: 'tracking_recovery.backfill_triggered',
      target_type: 'tracking_recovery',
      target_id: String(window.id || account.id),
      account_id: account.id,
      after_json: { window, result },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/creative-library', async (req, res) => {
  try {
    res.json({ data: await intelligence.getCreativeLibrary(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/revisit-automation', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const data = {
      config: revisitAutomation.getConfigSummary(),
      activity: [],
    };
    data.activity = await revisitAutomation.listRecentActivity(account.id, { limit: 20 });
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
