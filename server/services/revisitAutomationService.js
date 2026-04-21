const crypto = require('crypto');
const fetch = require('node-fetch');
const { URL } = require('url');
const { pool, query, queryOne } = require('../db');
const config = require('../config');
const trustPolicy = require('./trustPolicyService');

let timer = null;

function getSettings() {
  return config.revisitAutomation || {};
}

function getConfigSummary() {
  const settings = getSettings();
  return {
    enabled: Boolean(settings.enabled),
    webhook_configured: Boolean(clean(settings.webhookUrl)),
    signing_secret_configured: Boolean(clean(settings.webhookSigningSecret)),
    cooldown_hours: settings.cooldownHours,
    delay_seconds: settings.delaySeconds,
    interval_ms: settings.intervalMs,
    max_attempts: settings.maxAttempts,
    key_paths: Array.isArray(settings.keyPaths) ? settings.keyPaths : [],
  };
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function derivePagePath(pageUrl) {
  const url = clean(pageUrl);
  if (!url) return '/';
  try {
    return new URL(url).pathname || '/';
  } catch (_err) {
    if (url.startsWith('/')) return url;
    return '/';
  }
}

function matchesKeyPath(pagePath, keyPaths) {
  if (!Array.isArray(keyPaths) || !keyPaths.length) return false;
  return keyPaths.some((prefix) => pagePath === prefix || pagePath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || pagePath.startsWith(prefix));
}

function evaluateEligibility(visitor = {}, options = {}) {
  const settings = options.settings || getSettings();
  const pageUrl = clean(options.pageUrl || visitor.landing_page);
  const pagePath = derivePagePath(pageUrl);
  const reasons = [];

  if (!settings.enabled) reasons.push('disabled');
  if (!clean(settings.webhookUrl)) reasons.push('missing_webhook_url');
  if (!clean(visitor.ghl_contact_id)) reasons.push('missing_ghl_contact_id');
  if (visitor.normalized_stage === 'closed_won') reasons.push('closed_won');
  if (visitor.raw && typeof visitor.raw === 'object' && visitor.raw.opted_out === true) reasons.push('opted_out');
  if (!matchesKeyPath(pagePath, settings.keyPaths || [])) reasons.push('path_not_eligible');

  return {
    eligible: reasons.length === 0,
    ruleKey: 'known_contact_revisit',
    reasons,
    pageUrl,
    pagePath,
  };
}

async function hasRecentSend(accountId, ghlContactId, ruleKey, cooldownHours) {
  const row = await queryOne(`
    SELECT sent_at
    FROM known_contact_revisit_sends
    WHERE account_id = $1
      AND ghl_contact_id = $2
      AND rule_key = $3
      AND sent_at > NOW() - make_interval(hours => $4)
    ORDER BY sent_at DESC
    LIMIT 1
  `, [accountId, ghlContactId, ruleKey, cooldownHours]);
  return Boolean(row);
}

async function hasPendingJob(accountId, ghlContactId, ruleKey) {
  const row = await queryOne(`
    SELECT id
    FROM known_contact_revisit_jobs
    WHERE account_id = $1
      AND ghl_contact_id = $2
      AND rule_key = $3
      AND status IN ('pending', 'processing')
    ORDER BY created_at DESC
    LIMIT 1
  `, [accountId, ghlContactId, ruleKey]);
  return Boolean(row);
}

async function enqueueFromPageView(visitor = {}, input = {}) {
  const settings = getSettings();
  const eligibility = evaluateEligibility(visitor, {
    pageUrl: input.page_url,
    settings,
  });
  if (!eligibility.eligible) {
    return { queued: false, suppressed: true, reasons: eligibility.reasons };
  }

  const policy = await trustPolicy.assertRevisitAllowed(visitor);
  if (!policy.allowed) {
    return { queued: false, suppressed: true, reasons: policy.reasons || ['trust_policy_blocked'], policy };
  }

  if (await hasRecentSend(visitor.account_id, visitor.ghl_contact_id, eligibility.ruleKey, settings.cooldownHours)) {
    return { queued: false, suppressed: true, reasons: ['cooldown_active'] };
  }
  if (await hasPendingJob(visitor.account_id, visitor.ghl_contact_id, eligibility.ruleKey)) {
    return { queued: false, suppressed: true, reasons: ['pending_job_exists'] };
  }

  const row = await queryOne(`
    INSERT INTO known_contact_revisit_jobs (
      account_id, client_id, ghl_contact_id, rule_key, page_url, page_path, event_name, scheduled_for, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + make_interval(secs => $8),'pending')
    RETURNING *
  `, [
    visitor.account_id,
    visitor.client_id,
    visitor.ghl_contact_id,
    eligibility.ruleKey,
    eligibility.pageUrl,
    eligibility.pagePath,
    clean(input.event_name) || 'PageView',
    settings.delaySeconds,
  ]);

  return { queued: true, job: row };
}

function signPayload(raw) {
  const secret = getSettings().webhookSigningSecret;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function buildWebhookPayload(job, visitor) {
  return {
    event_id: `known_contact_revisit:${job.id}`,
    event: 'known_contact_revisited',
    account_id: job.account_id,
    client_id: job.client_id,
    ghl_contact_id: job.ghl_contact_id,
    normalized_stage: visitor.normalized_stage || null,
    page_url: job.page_url,
    page_path: job.page_path,
    rule_key: job.rule_key,
    scheduled_at: job.scheduled_for,
    sent_at: new Date().toISOString(),
  };
}

async function emitWebhook(payload) {
  const settings = getSettings();
  const sentAt = new Date().toISOString();
  const raw = JSON.stringify(payload);
  const signature = signPayload(raw);
  const headers = {
    'content-type': 'application/json',
    'x-adcommand-event': 'known_contact_revisited',
    'x-adcommand-event-id': payload.event_id,
    'x-adcommand-sent-at': sentAt,
  };
  if (signature) headers['x-adcommand-signature'] = signature;

  const response = await fetch(settings.webhookUrl, {
    method: 'POST',
    headers,
    body: raw,
  });
  const responseBody = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
}

async function markSent(job, payload, delivery) {
  const send = await queryOne(`
    INSERT INTO known_contact_revisit_sends (
      account_id, client_id, ghl_contact_id, rule_key, job_id, page_url,
      delivery_target, delivery_status, response_code, response_body, payload, sent_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    RETURNING *
  `, [
    job.account_id,
    job.client_id,
    job.ghl_contact_id,
    job.rule_key,
    job.id,
    job.page_url,
    clean(getSettings().webhookUrl),
    delivery.ok ? 'sent' : 'failed',
    delivery.status || null,
    clean(delivery.body),
    JSON.stringify(payload),
  ]);

  await query(`
    UPDATE known_contact_revisit_jobs
    SET status = 'sent',
        sent_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id]);
  return send;
}

async function markSuppressed(job, reason) {
  await query(`
    UPDATE known_contact_revisit_jobs
    SET status = 'suppressed',
        last_error = $2,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, reason]);
}

async function markFailed(job, errorMessage) {
  const settings = getSettings();
  const nextAttempts = Number(job.attempt_count || 0) + 1;
  const finalStatus = nextAttempts >= settings.maxAttempts ? 'failed' : 'pending';
  await query(`
    UPDATE known_contact_revisit_jobs
    SET status = $2,
        attempt_count = $3,
        last_error = $4,
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, finalStatus, nextAttempts, errorMessage]);
}

async function lockDueJobs(limit = 10) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(`
      SELECT *
      FROM known_contact_revisit_jobs
      WHERE status = 'pending'
        AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    `, [limit])).rows;

    for (const row of rows) {
      await client.query(`
        UPDATE known_contact_revisit_jobs
        SET status = 'processing',
            updated_at = NOW()
        WHERE id = $1
      `, [row.id]);
      row.status = 'processing';
    }
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processDueJobs({ limit = 10 } = {}) {
  const settings = getSettings();
  if (!settings.enabled) return { processed: 0, delivered: 0, suppressed: 0, failed: 0 };
  const jobs = await lockDueJobs(limit);
  const result = { processed: jobs.length, delivered: 0, suppressed: 0, failed: 0 };

  for (const job of jobs) {
    try {
      const visitor = await queryOne(`
        SELECT *
        FROM visitors
        WHERE client_id = $1
        ORDER BY last_seen_at DESC NULLS LAST
        LIMIT 1
      `, [job.client_id]);

      const eligibility = evaluateEligibility(visitor || {}, {
        pageUrl: job.page_url,
        settings,
      });
      if (!visitor || !eligibility.eligible) {
        await markSuppressed(job, eligibility.reasons.join(',') || 'visitor_missing');
        result.suppressed += 1;
        continue;
      }
      const policy = await trustPolicy.assertRevisitAllowed(visitor);
      if (!policy.allowed) {
        await markSuppressed(job, (policy.reasons || ['trust_policy_blocked']).join(','));
        result.suppressed += 1;
        continue;
      }
      if (await hasRecentSend(job.account_id, job.ghl_contact_id, job.rule_key, settings.cooldownHours)) {
        await markSuppressed(job, 'cooldown_active');
        result.suppressed += 1;
        continue;
      }

      const payload = buildWebhookPayload(job, visitor);
      const delivery = await emitWebhook(payload);
      if (!delivery.ok) throw new Error(`Webhook HTTP ${delivery.status}`);
      await markSent(job, payload, delivery);
      result.delivered += 1;
    } catch (err) {
      await markFailed(job, err.message);
      result.failed += 1;
    }
  }

  return result;
}

function startBackgroundProcessor({ intervalMs } = {}) {
  const settings = getSettings();
  if (timer || !settings.enabled) return;
  const every = intervalMs || settings.intervalMs;
  timer = setInterval(() => {
    processDueJobs({ limit: 10 }).catch((err) => {
      console.error('[revisit-automation] processor error:', err.message);
    });
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
}

async function listRecentActivity(accountId, { limit = 20 } = {}) {
  return query(`
    SELECT
      j.id,
      j.account_id,
      j.client_id,
      j.ghl_contact_id,
      j.rule_key,
      j.page_url,
      j.page_path,
      j.event_name,
      j.scheduled_for,
      j.status,
      j.attempt_count,
      j.last_error,
      j.sent_at,
      j.created_at,
      s.id AS send_id,
      s.delivery_target,
      s.delivery_status,
      s.response_code,
      s.sent_at AS delivery_sent_at
    FROM known_contact_revisit_jobs j
    LEFT JOIN known_contact_revisit_sends s ON s.job_id = j.id
    WHERE j.account_id = $1
    ORDER BY j.created_at DESC
    LIMIT $2
  `, [accountId, limit]).then((res) => res.rows || res);
}

module.exports = {
  derivePagePath,
  evaluateEligibility,
  enqueueFromPageView,
  processDueJobs,
  startBackgroundProcessor,
  getConfigSummary,
  listRecentActivity,
};
