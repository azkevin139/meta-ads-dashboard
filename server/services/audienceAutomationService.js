const fetch = require('node-fetch');
const { query, queryAll, queryOne } = require('../db');
const accountService = require('./accountService');
const audiencePush = require('./audiencePushService');
const trustPolicy = require('./trustPolicyService');

const SEGMENT_KEYS = Object.keys(audiencePush.SEGMENT_SQL);
const THRESHOLD_TYPES = ['eligible_count', 'matchable_count'];
const ACTION_TYPES = ['create_audience', 'refresh_audience', 'notify_n8n'];
const RUN_STATUSES = ['triggered', 'skipped', 'blocked', 'failed'];

function cleanText(value, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().slice(0, max) || null;
}

function badRequest(message) {
  const err = new Error(message);
  err.httpStatus = 400;
  return err;
}

function validateRuleInput(input = {}) {
  const segmentKey = cleanText(input.segment_key || input.segmentKey, 120);
  if (!SEGMENT_KEYS.includes(segmentKey)) throw badRequest(`Unsupported segment_key: ${segmentKey || 'missing'}`);

  const thresholdType = cleanText(input.threshold_type || input.thresholdType, 60) || 'matchable_count';
  if (!THRESHOLD_TYPES.includes(thresholdType)) throw badRequest(`Unsupported threshold_type: ${thresholdType}`);

  const actionType = cleanText(input.action_type || input.actionType, 60);
  if (!ACTION_TYPES.includes(actionType)) throw badRequest(`Unsupported action_type: ${actionType || 'missing'}`);

  const thresholdValue = parseInt(input.threshold_value ?? input.thresholdValue, 10);
  if (!Number.isInteger(thresholdValue) || thresholdValue <= 0) throw badRequest('threshold_value must be a positive integer');

  const cooldownMinutes = input.cooldown_minutes === undefined && input.cooldownMinutes === undefined
    ? 60
    : parseInt(input.cooldown_minutes ?? input.cooldownMinutes, 10);
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 1 || cooldownMinutes > 10080) {
    throw badRequest('cooldown_minutes must be between 1 and 10080');
  }

  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config : {};
  if (config.filters && Object.keys(config.filters).length) {
    throw badRequest('Rule filters are not supported in Phase 1');
  }
  if (actionType === 'notify_n8n' && !cleanText(config.webhook_url, 2000)) {
    throw badRequest('notify_n8n requires config.webhook_url');
  }

  return {
    segment_key: segmentKey,
    threshold_type: thresholdType,
    threshold_value: thresholdValue,
    action_type: actionType,
    cooldown_minutes: cooldownMinutes,
    enabled,
    config,
  };
}

async function getSegmentStats(accountId, segmentKey) {
  const data = await audiencePush.buildSegmentData(accountId, segmentKey);
  return {
    segment_key: segmentKey,
    eligible_count: data.totalRows || 0,
    matchable_count: data.matchableRows || 0,
    excluded_collision_rows: data.policy?.excluded_collision_rows || 0,
    high_confidence_rows: data.policy?.high_confidence_rows || 0,
    medium_confidence_rows: data.policy?.medium_confidence_rows || 0,
    low_confidence_rows: data.policy?.low_confidence_rows || 0,
  };
}

async function listAvailableSegments(accountId) {
  const pushes = accountId ? await audiencePush.listPushes(accountId) : [];
  const pushBySegment = Object.fromEntries(pushes.map((row) => [row.segment_key, row]));
  return SEGMENT_KEYS.map((segmentKey) => ({
    key: segmentKey,
    label: segmentKey.replace(/_/g, ' '),
    push: pushBySegment[segmentKey] || null,
  }));
}

async function listRules(accountId) {
  const rows = await queryAll(`
    SELECT *
    FROM audience_automation_rules
    WHERE account_id = $1
    ORDER BY enabled DESC, created_at DESC, id DESC
  `, [accountId]);
  if (!rows.length) return [];

  const latestRuns = await queryAll(`
    SELECT DISTINCT ON (rule_id) *
    FROM audience_rule_runs
    WHERE account_id = $1
    ORDER BY rule_id, created_at DESC
  `, [accountId]);
  const runByRule = Object.fromEntries(latestRuns.map((row) => [String(row.rule_id), row]));
  const pushes = await audiencePush.listPushes(accountId);
  const pushBySegment = Object.fromEntries(pushes.map((row) => [row.segment_key, row]));

  const hydrated = [];
  for (const row of rows) {
    const stats = await getSegmentStats(accountId, row.segment_key);
    const gate = await trustPolicy.assertAudienceAutomationAllowed(accountId);
    const thresholdMetric = row.threshold_type === 'eligible_count' ? stats.eligible_count : stats.matchable_count;
    let currentStatus = thresholdMetric >= row.threshold_value ? 'ready' : 'waiting';
    let currentReason = null;
    if (!row.enabled) {
      currentStatus = 'disabled';
      currentReason = 'rule_disabled';
    } else if (!gate.allowed) {
      currentStatus = 'blocked';
      currentReason = gate.reason_code || gate.reasons?.[0] || 'health_blocked';
    }

    hydrated.push({
      ...row,
      stats,
      threshold_metric_value: thresholdMetric,
      current_status: currentStatus,
      current_reason: currentReason,
      latest_run: runByRule[String(row.id)] || null,
      audience_push: pushBySegment[row.segment_key] || null,
    });
  }
  return hydrated;
}

async function getRule(ruleId, accountId) {
  return queryOne(`
    SELECT *
    FROM audience_automation_rules
    WHERE id = $1
      AND account_id = $2
  `, [ruleId, accountId]);
}

async function saveRule(accountId, input = {}) {
  const validated = validateRuleInput(input);
  const id = input.id ? parseInt(input.id, 10) : null;
  let row;
  if (id) {
    row = await queryOne(`
      UPDATE audience_automation_rules
      SET segment_key = $3,
          threshold_type = $4,
          threshold_value = $5,
          action_type = $6,
          cooldown_minutes = $7,
          enabled = $8,
          config = $9::jsonb,
          updated_at = NOW()
      WHERE id = $1
        AND account_id = $2
      RETURNING *
    `, [id, accountId, validated.segment_key, validated.threshold_type, validated.threshold_value, validated.action_type, validated.cooldown_minutes, validated.enabled, JSON.stringify(validated.config)]);
  } else {
    row = await queryOne(`
      INSERT INTO audience_automation_rules (
        account_id, segment_key, threshold_type, threshold_value, action_type, cooldown_minutes, enabled, config
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING *
    `, [accountId, validated.segment_key, validated.threshold_type, validated.threshold_value, validated.action_type, validated.cooldown_minutes, validated.enabled, JSON.stringify(validated.config)]);
  }
  if (!row) throw new Error('Rule not found');
  return row;
}

async function deleteRule(ruleId, accountId) {
  await query(`
    DELETE FROM audience_automation_rules
    WHERE id = $1
      AND account_id = $2
  `, [ruleId, accountId]);
  return { success: true };
}

async function isOutsideCooldown(ruleId, cooldownMinutes) {
  const row = await queryOne(`
    SELECT created_at
    FROM audience_rule_runs
    WHERE rule_id = $1
      AND status = 'triggered'
    ORDER BY created_at DESC
    LIMIT 1
  `, [ruleId]);
  if (!row?.created_at) return true;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return ageMs >= (cooldownMinutes * 60 * 1000);
}

async function recordRun(rule, stats, status, reasonCode = null, payload = {}) {
  if (!RUN_STATUSES.includes(status)) throw new Error(`Unsupported run status: ${status}`);
  return queryOne(`
    INSERT INTO audience_rule_runs (
      rule_id, account_id, segment_key, status, eligible_count, matchable_count, reason_code, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING *
  `, [
    rule.id,
    rule.account_id,
    rule.segment_key,
    status,
    stats.eligible_count,
    stats.matchable_count,
    cleanText(reasonCode, 120),
    JSON.stringify(payload || {}),
  ]);
}

async function listRuns(accountId, { limit = 50 } = {}) {
  const capped = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
  return queryAll(`
    SELECT *
    FROM audience_rule_runs
    WHERE account_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [accountId, capped]);
}

async function notifyWebhook(rule, account, stats) {
  const url = cleanText(rule.config?.webhook_url, 2000);
  if (!url) throw new Error('notify_n8n rule is missing config.webhook_url');
  const body = {
    event: 'audience_threshold_reached',
    account_id: account.id,
    meta_account_id: account.meta_account_id,
    rule_id: rule.id,
    segment_key: rule.segment_key,
    threshold_type: rule.threshold_type,
    threshold_value: rule.threshold_value,
    stats,
    triggered_at: new Date().toISOString(),
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Audience automation webhook ${response.status}: ${text.substring(0, 200)}`);
  }
  return { delivered: true };
}

async function executeRule(rule, account, stats) {
  const segmentName = rule.config?.segment_name || rule.segment_key.replace(/_/g, ' ');
  if (rule.action_type === 'create_audience') {
    return audiencePush.ensureAudienceExistsAndRefresh(account, {
      segmentKey: rule.segment_key,
      segmentName,
    });
  }
  if (rule.action_type === 'refresh_audience') {
    return audiencePush.pushSegment(account, {
      segmentKey: rule.segment_key,
      segmentName,
    });
  }
  if (rule.action_type === 'notify_n8n') {
    return notifyWebhook(rule, account, stats);
  }
  throw new Error(`Unsupported action_type: ${rule.action_type}`);
}

async function evaluateRule(rule, account) {
  const stats = await getSegmentStats(rule.account_id, rule.segment_key);
  const thresholdMetric = rule.threshold_type === 'eligible_count' ? stats.eligible_count : stats.matchable_count;

  if (!rule.enabled) {
    return { run: await recordRun(rule, stats, 'skipped', 'rule_disabled'), stats };
  }
  if (!(await isOutsideCooldown(rule.id, rule.cooldown_minutes))) {
    return { run: await recordRun(rule, stats, 'skipped', 'cooldown_active'), stats };
  }
  if (thresholdMetric < rule.threshold_value) {
    return {
      run: await recordRun(rule, stats, 'skipped', 'threshold_not_met', {
        threshold_metric_value: thresholdMetric,
      }),
      stats,
    };
  }

  const gate = await trustPolicy.assertAudienceAutomationAllowed(rule.account_id);
  if (!gate.allowed) {
    return {
      run: await recordRun(rule, stats, 'blocked', gate.reason_code || gate.reasons?.[0] || 'health_blocked', {
        gate,
      }),
      stats,
    };
  }

  try {
    const result = await executeRule(rule, account, stats);
    return {
      run: await recordRun(rule, stats, 'triggered', null, {
        result,
        threshold_metric_value: thresholdMetric,
      }),
      stats,
      result,
    };
  } catch (err) {
    return {
      run: await recordRun(rule, stats, 'failed', 'execution_failed', {
        error: err.message,
      }),
      stats,
      error: err,
    };
  }
}

async function evaluateRulesForAccount(accountOrId) {
  const account = typeof accountOrId === 'object' ? accountOrId : await accountService.getAccountById(accountOrId);
  if (!account?.id) throw new Error('Account not found');
  const rules = await queryAll(`
    SELECT *
    FROM audience_automation_rules
    WHERE account_id = $1
      AND enabled = TRUE
    ORDER BY created_at ASC, id ASC
  `, [account.id]);
  const results = [];
  for (const rule of rules) {
    results.push(await evaluateRule(rule, account));
  }
  return {
    account_id: account.id,
    evaluated: rules.length,
    triggered: results.filter((row) => row.run?.status === 'triggered').length,
    blocked: results.filter((row) => row.run?.status === 'blocked').length,
    skipped: results.filter((row) => row.run?.status === 'skipped').length,
    failed: results.filter((row) => row.run?.status === 'failed').length,
    results,
  };
}

async function listFastSyncAccounts() {
  return queryAll(`
    SELECT *
    FROM accounts
    WHERE product_mode = 'lead_gen'
       OR fast_sync_enabled = TRUE
    ORDER BY id ASC
  `);
}

async function evaluateFastSyncAccounts() {
  const accounts = await listFastSyncAccounts();
  const results = [];
  for (const account of accounts) {
    try {
      results.push(await evaluateRulesForAccount(await accountService.getAccountById(account.id)));
    } catch (err) {
      results.push({ account_id: account.id, error: err.message });
    }
  }
  return results;
}

function startBackgroundEvaluator({ intervalMs = 15 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await evaluateFastSyncAccounts();
      const triggered = results.reduce((sum, row) => sum + (row.triggered || 0), 0);
      if (triggered > 0) {
        console.log(`[audienceAutomation] triggered ${triggered} rule(s) across ${results.length} account(s)`);
      }
    } catch (err) {
      console.error(`[audienceAutomation] background run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 60 * 1000).unref?.();
  return timer;
}

module.exports = {
  SEGMENT_KEYS,
  THRESHOLD_TYPES,
  ACTION_TYPES,
  getSegmentStats,
  listAvailableSegments,
  listRules,
  getRule,
  saveRule,
  deleteRule,
  listRuns,
  evaluateRule,
  evaluateRulesForAccount,
  evaluateFastSyncAccounts,
  startBackgroundEvaluator,
};
