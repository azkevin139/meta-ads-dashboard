const crypto = require('crypto');
const fetch = require('node-fetch');
const { query, queryAll, queryOne } = require('../db');
const config = require('../config');
const metaApi = require('./metaApi');
const audiencePush = require('./audiencePushService');
const { logAction } = require('./actionService');

const SOURCE_TYPES = ['meta_engagement', 'meta_website', 'first_party_push'];

const DEFAULT_SEVEN_TOUCH_TEMPLATE = [
  { step_number: 1, name: 'Discovery Engagers', audience_source_type: 'meta_engagement' },
  { step_number: 2, name: 'Understanding Engagers', audience_source_type: 'meta_engagement' },
  { step_number: 3, name: 'Validation Engagers', audience_source_type: 'meta_engagement' },
  { step_number: 4, name: 'IG/Profile + Page Engagers', audience_source_type: 'meta_engagement' },
  { step_number: 5, name: 'Lead Form Openers', audience_source_type: 'meta_engagement' },
  { step_number: 6, name: 'GHL Website Visitors', audience_source_type: 'first_party_push', segment_key: 'all_visitors' },
  { step_number: 7, name: 'Non-Converters (All Previous)', audience_source_type: 'first_party_push', segment_key: 'non_converted_contacts' },
];

function nowIso() {
  return new Date().toISOString();
}

function signPayload(raw) {
  const secret = config.touchSequences.webhookSigningSecret;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function normalizeSequenceRow(row, steps = [], events = []) {
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    description: row.description,
    threshold_default: row.threshold_default,
    n8n_webhook_url: row.n8n_webhook_url,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps,
    events,
  };
}

function normalizeStepInput(step = {}, thresholdDefault = 3000) {
  const audienceSourceType = String(step.audience_source_type || '').trim();
  if (!SOURCE_TYPES.includes(audienceSourceType)) throw new Error(`Invalid audience_source_type: ${audienceSourceType}`);
  const normalized = {
    step_number: parseInt(step.step_number, 10),
    name: String(step.name || '').trim(),
    audience_source_type: audienceSourceType,
    source_audience_id: step.source_audience_id ? String(step.source_audience_id).trim() : null,
    segment_key: step.segment_key ? String(step.segment_key).trim() : null,
    target_adset_id: step.target_adset_id ? String(step.target_adset_id).trim() : null,
    pause_previous_adset: Boolean(step.pause_previous_adset),
    reduce_previous_budget_to: step.reduce_previous_budget_to === undefined || step.reduce_previous_budget_to === null || step.reduce_previous_budget_to === '' ? null : Number(step.reduce_previous_budget_to),
    threshold_count: step.threshold_count === undefined || step.threshold_count === null || step.threshold_count === '' ? thresholdDefault : parseInt(step.threshold_count, 10),
    enabled: step.enabled !== false,
  };
  if (!Number.isInteger(normalized.step_number) || normalized.step_number <= 0) throw new Error('step_number must be a positive integer');
  if (!normalized.name) throw new Error('step name required');
  if (normalized.audience_source_type === 'first_party_push' && !normalized.segment_key) throw new Error(`segment_key required for step ${normalized.step_number}`);
  if (normalized.audience_source_type !== 'first_party_push' && !normalized.source_audience_id) throw new Error(`source_audience_id required for step ${normalized.step_number}`);
  if (!Number.isInteger(normalized.threshold_count) || normalized.threshold_count <= 0) throw new Error('threshold_count must be a positive integer');
  if (normalized.reduce_previous_budget_to !== null && (!Number.isFinite(normalized.reduce_previous_budget_to) || normalized.reduce_previous_budget_to < 0)) {
    throw new Error('reduce_previous_budget_to must be a non-negative number');
  }
  return normalized;
}

async function listSequences(accountId) {
  const sequences = await queryAll(`
    SELECT * FROM touch_sequences WHERE account_id = $1 ORDER BY created_at DESC, id DESC
  `, [accountId]);
  if (!sequences.length) return [];
  const sequenceIds = sequences.map((row) => row.id);
  const steps = await queryAll(`
    SELECT * FROM touch_sequence_steps WHERE sequence_id = ANY($1::int[]) ORDER BY sequence_id, step_number ASC
  `, [sequenceIds]);
  const events = await queryAll(`
    SELECT * FROM touch_sequence_events WHERE sequence_id = ANY($1::int[]) ORDER BY created_at DESC LIMIT 50
  `, [sequenceIds]);
  return sequences.map((row) => normalizeSequenceRow(
    row,
    steps.filter((step) => step.sequence_id === row.id),
    events.filter((event) => event.sequence_id === row.id).slice(0, 10)
  ));
}

async function saveSequence(accountId, input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const description = input.description ? String(input.description).trim() : null;
  const thresholdDefault = input.threshold_default === undefined || input.threshold_default === null || input.threshold_default === ''
    ? 3000
    : parseInt(input.threshold_default, 10);
  if (!Number.isInteger(thresholdDefault) || thresholdDefault <= 0) throw new Error('threshold_default must be a positive integer');
  const webhookUrl = input.n8n_webhook_url ? String(input.n8n_webhook_url).trim() : null;
  const enabled = input.enabled !== false;
  const stepsInput = Array.isArray(input.steps) ? input.steps : [];
  if (!stepsInput.length) throw new Error('steps required');
  const steps = stepsInput.map((step) => normalizeStepInput(step, thresholdDefault));

  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    let sequenceRow;
    if (input.id) {
      sequenceRow = (await client.query(`
        UPDATE touch_sequences
        SET name = $2,
            description = $3,
            threshold_default = $4,
            n8n_webhook_url = $5,
            enabled = $6,
            updated_at = NOW()
        WHERE id = $1 AND account_id = $7
        RETURNING *
      `, [input.id, name, description, thresholdDefault, webhookUrl, enabled, accountId])).rows[0];
      if (!sequenceRow) throw new Error('Sequence not found');
      await client.query('DELETE FROM touch_sequence_steps WHERE sequence_id = $1', [sequenceRow.id]);
    } else {
      sequenceRow = (await client.query(`
        INSERT INTO touch_sequences (account_id, name, description, threshold_default, n8n_webhook_url, enabled)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [accountId, name, description, thresholdDefault, webhookUrl, enabled])).rows[0];
    }

    for (const step of steps) {
      await client.query(`
        INSERT INTO touch_sequence_steps (
          sequence_id, step_number, name, audience_source_type, source_audience_id, segment_key,
          target_adset_id, pause_previous_adset, reduce_previous_budget_to, threshold_count, enabled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        sequenceRow.id,
        step.step_number,
        step.name,
        step.audience_source_type,
        step.source_audience_id,
        step.segment_key,
        step.target_adset_id,
        step.pause_previous_adset,
        step.reduce_previous_budget_to,
        step.threshold_count,
        step.enabled,
      ]);
    }

    await client.query('COMMIT');
    return (await listSequences(accountId)).find((row) => row.id === sequenceRow.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteSequence(accountId, sequenceId) {
  await query('DELETE FROM touch_sequences WHERE id = $1 AND account_id = $2', [sequenceId, accountId]);
  return { success: true };
}

async function logEvent(accountId, sequenceId, stepId, eventType, payload) {
  await query(`
    INSERT INTO touch_sequence_events (account_id, sequence_id, step_id, event_type, payload)
    VALUES ($1, $2, $3, $4, $5)
  `, [accountId, sequenceId, stepId || null, eventType, JSON.stringify(payload || {})]);
}

async function fetchMetaAudience(account, audienceId) {
  const data = await metaApi.metaGet(`/${audienceId}`, {
    fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,updated_time',
  }, account);
  const lower = Number(data.approximate_count_lower_bound) || 0;
  const upper = Number(data.approximate_count_upper_bound) || lower;
  return {
    audience_id: data.id || audienceId,
    audience_name: data.name || audienceId,
    size: lower || upper || 0,
    lower_bound: lower,
    upper_bound: upper,
    meta: data,
  };
}

async function fetchFirstPartySegment(account, step, pushMap) {
  const data = await audiencePush.buildSegmentData(account.id, step.segment_key);
  const push = pushMap[step.segment_key] || null;
  return {
    audience_id: push?.meta_audience_id || null,
    audience_name: push?.segment_name || step.name,
    size: data.totalRows || 0,
    lower_bound: data.totalRows || 0,
    upper_bound: data.totalRows || 0,
    meta: {
      total_rows: data.totalRows || 0,
      push_id: push?.id || null,
      meta_audience_id: push?.meta_audience_id || null,
      auto_refresh: push?.auto_refresh || false,
    },
  };
}

async function emitSequenceWebhook(sequence, payload) {
  if (!sequence.n8n_webhook_url) return { delivered: false, skipped: true, reason: 'No webhook configured' };
  const sentAt = nowIso();
  const raw = JSON.stringify(payload);
  const signature = signPayload(raw);
  const headers = {
    'content-type': 'application/json',
    'x-adcommand-event': 'touch-threshold-crossed',
    'x-adcommand-event-id': payload.event_id,
    'x-adcommand-sent-at': sentAt,
  };
  if (signature) headers['x-adcommand-signature'] = signature;
  const response = await fetch(sequence.n8n_webhook_url, {
    method: 'POST',
    headers,
    body: raw,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n webhook ${response.status}: ${text.substring(0, 200)}`);
  }
  return { delivered: true };
}

async function executeStepTransition(account, sequence, currentStep, nextStep) {
  if (!nextStep || !nextStep.target_adset_id) {
    return { skipped: true, reason: 'No next step target ad set configured' };
  }

  const result = {
    activated_adset_id: nextStep.target_adset_id,
    paused_previous: false,
    reduced_previous_budget: null,
  };

  await metaApi.updateStatus(nextStep.target_adset_id, 'ACTIVE', account);
  await logAction(account.id, 'adset', nextStep.target_adset_id, nextStep.name, 'touch_sequence_activate', {
    sequence_id: sequence.id,
    sequence_name: sequence.name,
    step_id: nextStep.id,
    step_number: nextStep.step_number,
  });

  if (currentStep?.target_adset_id && nextStep.pause_previous_adset) {
    await metaApi.updateStatus(currentStep.target_adset_id, 'PAUSED', account);
    await logAction(account.id, 'adset', currentStep.target_adset_id, currentStep.name, 'touch_sequence_pause_previous', {
      sequence_id: sequence.id,
      sequence_name: sequence.name,
      previous_step_id: currentStep.id,
      previous_step_number: currentStep.step_number,
      triggered_by_step_id: nextStep.id,
      triggered_by_step_number: nextStep.step_number,
    });
    result.paused_previous = true;
  } else if (currentStep?.target_adset_id && nextStep.reduce_previous_budget_to !== null && nextStep.reduce_previous_budget_to !== undefined) {
    await metaApi.updateBudget(currentStep.target_adset_id, Math.round(Number(nextStep.reduce_previous_budget_to) * 100), account);
    await logAction(account.id, 'adset', currentStep.target_adset_id, currentStep.name, 'touch_sequence_reduce_previous_budget', {
      sequence_id: sequence.id,
      sequence_name: sequence.name,
      previous_step_id: currentStep.id,
      previous_step_number: currentStep.step_number,
      triggered_by_step_id: nextStep.id,
      triggered_by_step_number: nextStep.step_number,
      new_budget: nextStep.reduce_previous_budget_to,
    });
    result.reduced_previous_budget = nextStep.reduce_previous_budget_to;
  }

  return result;
}

async function refreshSequenceStatus(account, sequence, { pushMap } = {}) {
  const steps = sequence.steps || [];
  const results = [];
  for (const step of steps) {
    if (!step.enabled || !sequence.enabled) {
      await query(`
        UPDATE touch_sequence_steps
        SET status = 'disabled', last_checked_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [step.id]);
      results.push({ ...step, status: 'disabled', current_size: step.last_size || 0 });
      continue;
    }

    try {
      const current = step.audience_source_type === 'first_party_push'
        ? await fetchFirstPartySegment(account, step, pushMap || {})
        : await fetchMetaAudience(account, step.source_audience_id);

      let status = current.size >= step.threshold_count ? 'ready' : 'waiting';
      let triggerResult = null;
      const nextStep = steps.find((candidate) => candidate.enabled && candidate.step_number === step.step_number + 1) || null;

      if (current.size >= step.threshold_count && !step.last_triggered_at) {
        const payload = {
          event_id: `touch_threshold:${account.id}:${sequence.id}:${step.id}`,
          event: 'touch_threshold_crossed',
          account_id: account.id,
          sequence_id: sequence.id,
          sequence_name: sequence.name,
          step_id: step.id,
          step_number: step.step_number,
          step_name: step.name,
          audience_source_type: step.audience_source_type,
          source_audience_id: current.audience_id || step.source_audience_id || null,
          current_size: current.size,
          threshold_count: step.threshold_count,
          current_step_target_adset_id: step.target_adset_id || null,
          next_step_id: nextStep?.id || null,
          next_step_number: nextStep?.step_number || null,
          next_step_name: nextStep?.name || null,
          target_adset_id: nextStep?.target_adset_id || null,
          pause_previous_adset: nextStep?.pause_previous_adset || false,
          reduce_previous_budget_to: nextStep?.reduce_previous_budget_to ?? null,
          triggered_at: nowIso(),
        };
        const execution = await executeStepTransition(account, sequence, step, nextStep).catch((err) => ({ error: err.message }));
        triggerResult = await emitSequenceWebhook(sequence, payload).catch((err) => ({ delivered: false, error: err.message }));
        await logEvent(account.id, sequence.id, step.id, 'threshold_crossed', { ...payload, execution, webhook: triggerResult });
        await query(`
          UPDATE touch_sequence_steps
          SET status = 'triggered',
              last_size = $2,
              last_checked_at = NOW(),
              last_triggered_at = NOW(),
              last_triggered_count = $3,
              last_error = $4,
              updated_at = NOW()
          WHERE id = $1
        `, [step.id, current.size, current.size, execution?.error || triggerResult?.error || null]);
        status = 'triggered';
      } else {
        await query(`
          UPDATE touch_sequence_steps
          SET status = $2,
              last_size = $3,
              last_checked_at = NOW(),
              last_error = NULL,
              updated_at = NOW()
          WHERE id = $1
        `, [step.id, status, current.size]);
      }

      results.push({
        ...step,
        status,
        current_size: current.size,
        lower_bound: current.lower_bound,
        upper_bound: current.upper_bound,
        source_audience_id: current.audience_id || step.source_audience_id,
        source_audience_name: current.audience_name || step.name,
        meta: current.meta,
        triggered: triggerResult,
        next_step_id: nextStep?.id || null,
        next_step_number: nextStep?.step_number || null,
        next_step_name: nextStep?.name || null,
      });
    } catch (err) {
      await query(`
        UPDATE touch_sequence_steps
        SET status = 'error',
            last_checked_at = NOW(),
            last_error = $2,
            updated_at = NOW()
        WHERE id = $1
      `, [step.id, err.message]);
      await logEvent(account.id, sequence.id, step.id, 'monitor_error', { error: err.message });
      results.push({ ...step, status: 'error', current_size: step.last_size || 0, last_error: err.message });
    }
  }
  return { ...sequence, steps: results };
}

async function runMonitorForAccount(account) {
  const sequences = await listSequences(account.id);
  if (!sequences.length) return [];
  const pushes = await audiencePush.listPushes(account.id);
  const pushMap = Object.fromEntries(pushes.map((row) => [row.segment_key, row]));
  const results = [];
  for (const sequence of sequences) {
    results.push(await refreshSequenceStatus(account, sequence, { pushMap }));
  }
  return results;
}

async function runMonitorForSequence(account, sequenceId) {
  const sequences = await listSequences(account.id);
  const sequence = sequences.find((row) => row.id === sequenceId);
  if (!sequence) throw new Error('Sequence not found');
  const pushes = await audiencePush.listPushes(account.id);
  const pushMap = Object.fromEntries(pushes.map((row) => [row.segment_key, row]));
  return refreshSequenceStatus(account, sequence, { pushMap });
}

function startBackgroundMonitor({ intervalMs = config.touchSequences.monitorIntervalMs } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const accountService = require('./accountService');
      const accounts = await accountService.listAccounts();
      for (const account of accounts) {
        if (!account.is_active) continue;
        try {
          const fullAccount = await accountService.getAccountById(account.id);
          await runMonitorForAccount(fullAccount);
        } catch (err) {
          console.error(`[touchSequence] account ${account.id} monitor failed: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[touchSequence] background monitor failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 15 * 60 * 1000).unref?.();
  return timer;
}

module.exports = {
  SOURCE_TYPES,
  DEFAULT_SEVEN_TOUCH_TEMPLATE,
  listSequences,
  saveSequence,
  deleteSequence,
  runMonitorForAccount,
  runMonitorForSequence,
  startBackgroundMonitor,
};
