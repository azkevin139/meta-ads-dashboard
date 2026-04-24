const { queryAll, queryOne } = require('../db');
const syncTruth = require('./syncTruthService');
const identityCollisions = require('./identityCollisionService');

const STALE_AFTER_HOURS = 24;

function isImportedClientId(clientId) {
  const value = String(clientId || '');
  return value.startsWith('ghl_') || value.startsWith('meta_lead_') || value.startsWith('lead_');
}

function ageHours(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 3600000);
}

function rowState(row) {
  if (!row) return 'unavailable';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'partial' || row.status === 'skipped') return 'partial';
  const age = ageHours(row.last_successful_at);
  if (age === null) return 'unavailable';
  if (age > STALE_AFTER_HOURS) return 'stale';
  return 'fresh';
}

function summarizeRows(rows) {
  if (!rows.length) return { state: 'unavailable', reasons: ['health_unavailable'], rows };
  const states = rows.map(rowState);
  if (states.includes('failed')) return { state: 'failed', reasons: reasonCodes(rows, 'failed'), rows };
  if (states.includes('partial')) return { state: 'partial', reasons: reasonCodes(rows, 'partial'), rows };
  if (states.includes('stale')) return { state: 'stale', reasons: ['warehouse_stale'], rows };
  if (states.includes('unavailable')) return { state: 'unavailable', reasons: ['health_unavailable'], rows };
  return { state: 'fresh', reasons: [], rows };
}

function reasonCodes(rows, status) {
  const reasons = rows
    .filter((row) => rowState(row) === status)
    .map((row) => row.partial_reason || `${row.source}_${row.dataset}_${status}`);
  return Array.from(new Set(reasons.length ? reasons : [`data_${status}`]));
}

async function getDataHealthPolicy(accountId, datasets = []) {
  const health = await syncTruth.getHealth(accountId);
  const rows = datasets
    .map(({ source, dataset }) => health.find((row) => row.source === source && row.dataset === dataset))
    .filter(Boolean);
  return summarizeRows(rows);
}

function actionDecisionFromHealth(policy, { blockOn = ['failed'], warnOn = ['partial', 'stale', 'unavailable'] } = {}) {
  if (blockOn.includes(policy.state)) {
    return { allowed: false, level: 'blocked', reasons: policy.reasons, health: policy };
  }
  if (warnOn.includes(policy.state)) {
    return { allowed: true, level: 'warn', reasons: policy.reasons, health: policy };
  }
  return { allowed: true, level: 'allowed', reasons: [], health: policy };
}

async function getIdentityCollisionHashes(accountId) {
  const resolved = await identityCollisions.getResolvedHashSets(accountId);
  const rows = await queryAll(`
    WITH collisions AS (
      SELECT 'email_hash' AS method, email_hash AS identity_hash
      FROM visitors
      WHERE account_id = $1 AND email_hash IS NOT NULL
      GROUP BY email_hash
      HAVING COUNT(DISTINCT client_id) > 1 OR COUNT(DISTINCT ghl_contact_id) > 1
      UNION ALL
      SELECT 'phone_hash' AS method, phone_hash AS identity_hash
      FROM visitors
      WHERE account_id = $1 AND phone_hash IS NOT NULL
      GROUP BY phone_hash
      HAVING COUNT(DISTINCT client_id) > 1 OR COUNT(DISTINCT ghl_contact_id) > 1
    )
    SELECT method, identity_hash FROM collisions
  `, [accountId]);

  return {
    email: new Set(rows
      .filter((row) => row.method === 'email_hash' && !resolved.email.has(row.identity_hash))
      .map((row) => row.identity_hash)),
    phone: new Set(rows
      .filter((row) => row.method === 'phone_hash' && !resolved.phone.has(row.identity_hash))
      .map((row) => row.identity_hash)),
  };
}

async function hasIdentityCollision(accountId, visitor = {}) {
  if (!visitor.email_hash && !visitor.phone_hash) return false;
  const resolved = await identityCollisions.getResolvedHashSets(accountId);
  if (visitor.email_hash && resolved.email.has(visitor.email_hash)) return false;
  if (visitor.phone_hash && resolved.phone.has(visitor.phone_hash)) return false;
  const row = await queryOne(`
    WITH candidates AS (
      SELECT 'email_hash' AS method, email_hash AS identity_hash, client_id, ghl_contact_id
      FROM visitors
      WHERE account_id = $1 AND email_hash IS NOT NULL AND email_hash = $2
      UNION ALL
      SELECT 'phone_hash' AS method, phone_hash AS identity_hash, client_id, ghl_contact_id
      FROM visitors
      WHERE account_id = $1 AND phone_hash IS NOT NULL AND phone_hash = $3
    )
    SELECT 1
    FROM candidates
    GROUP BY method, identity_hash
    HAVING COUNT(DISTINCT client_id) > 1 OR COUNT(DISTINCT ghl_contact_id) > 1
    LIMIT 1
  `, [accountId, visitor.email_hash || null, visitor.phone_hash || null]);
  return Boolean(row);
}

async function assessVisitorIdentity(visitor = {}) {
  const reasons = [];
  if (!visitor || !visitor.client_id) return { confidence: 'anonymous', collision: false, reasons: ['visitor_missing'] };

  const hasKnownContact = Boolean(visitor.ghl_contact_id);
  const hasHash = Boolean(visitor.email_hash || visitor.phone_hash);
  const collision = await hasIdentityCollision(visitor.account_id, visitor);
  if (collision) reasons.push('identity_collision');

  if (hasKnownContact && !isImportedClientId(visitor.client_id) && !collision) {
    return { confidence: 'high', collision, reasons };
  }
  if ((hasKnownContact || hasHash) && !collision) {
    return { confidence: 'medium', collision, reasons: [...reasons, 'imported_or_hashed_identity'] };
  }
  if (hasKnownContact || hasHash) {
    return { confidence: 'low', collision, reasons };
  }
  return { confidence: 'anonymous', collision, reasons: ['anonymous_identity'] };
}

async function assertRevisitAllowed(visitor) {
  const identity = await assessVisitorIdentity(visitor);
  if (identity.confidence !== 'high') {
    return { allowed: false, level: 'blocked', reasons: identity.reasons.concat(`identity_${identity.confidence}`), identity };
  }
  const health = await getDataHealthPolicy(visitor.account_id, [
    { source: 'ghl', dataset: 'contacts' },
    { source: 'tracking', dataset: 'recovery' },
  ]);
  const decision = actionDecisionFromHealth(health, { blockOn: ['failed', 'partial'], warnOn: ['stale', 'unavailable'] });
  return { ...decision, identity };
}

async function assertAudiencePushAllowed(accountId) {
  const health = await getDataHealthPolicy(accountId, [
    { source: 'meta', dataset: 'leads' },
    { source: 'ghl', dataset: 'contacts' },
    { source: 'tracking', dataset: 'recovery' },
  ]);
  return actionDecisionFromHealth(health, { blockOn: ['failed'], warnOn: ['partial', 'stale', 'unavailable'] });
}

async function assertAudienceAutomationAllowed(accountId) {
  const health = await getDataHealthPolicy(accountId, [
    { source: 'meta', dataset: 'leads' },
    { source: 'ghl', dataset: 'contacts' },
    { source: 'tracking', dataset: 'recovery' },
  ]);
  const decision = actionDecisionFromHealth(health, { blockOn: ['failed', 'partial', 'stale', 'unavailable'], warnOn: [] });
  if (!decision.allowed) {
    return {
      ...decision,
      reason_code: decision.reasons[0] || `automation_${health.state}`,
    };
  }
  return {
    ...decision,
    reason_code: null,
  };
}

async function getAiRecommendationPolicy(accountId) {
  const health = await getDataHealthPolicy(accountId, [
    { source: 'meta', dataset: 'warehouse_insights' },
    { source: 'meta', dataset: 'entities' },
    { source: 'ghl', dataset: 'contacts' },
  ]);
  if (health.state === 'failed') return { action: 'suppress', confidenceMultiplier: 0, reasons: health.reasons, health };
  if (['partial', 'stale', 'unavailable'].includes(health.state)) {
    return { action: 'downgrade', confidenceMultiplier: 0.65, reasons: health.reasons, health };
  }
  return { action: 'allow', confidenceMultiplier: 1, reasons: [], health };
}

module.exports = {
  assessVisitorIdentity,
  assertAudienceAutomationAllowed,
  assertAudiencePushAllowed,
  assertRevisitAllowed,
  getAiRecommendationPolicy,
  getDataHealthPolicy,
  getIdentityCollisionHashes,
};
