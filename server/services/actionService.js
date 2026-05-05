const metaApi = require('./metaApi');
const { query, queryOne, queryAll } = require('../db');

const ENTITY_CONFIG = {
  campaign: { table: 'campaigns', idCol: 'meta_campaign_id' },
  adset: { table: 'adsets', idCol: 'meta_adset_id' },
  ad: { table: 'ads', idCol: 'meta_ad_id' },
};

function requireAccountId(accountId) {
  const parsed = parseInt(accountId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('accountId required');
  return parsed;
}

function entityConfig(entityType) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) throw new Error(`Unsupported entity type: ${entityType}`);
  return config;
}

async function getOwnedEntity(accountId, entityType, metaEntityId, fields = 'id, name, status') {
  const resolvedAccountId = requireAccountId(accountId);
  const { table, idCol } = entityConfig(entityType);
  const entity = await queryOne(
    `SELECT ${fields}, account_id FROM ${table} WHERE ${idCol} = $1 AND account_id = $2`,
    [metaEntityId, resolvedAccountId]
  );
  if (!entity) throw new Error(`${entityType} not found for account ${resolvedAccountId}: ${metaEntityId}`);
  return { entity, table, idCol, accountId: resolvedAccountId };
}

// ─── LOG EVERY ACTION ─────────────────────────────────────

async function logAction(accountId, entityType, entityId, entityName, action, details, source = 'manual', recommendationId = null) {
  return query(`
    INSERT INTO action_log (account_id, entity_type, entity_id, entity_name, action, details, source, recommendation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [accountId, entityType, entityId, entityName, action, JSON.stringify(details), source, recommendationId]);
}

// ─── PAUSE ────────────────────────────────────────────────

async function pauseEntity(accountId, entityType, metaEntityId, context = {}) {
  const { entity, table, idCol, accountId: resolvedAccountId } = await getOwnedEntity(accountId, entityType, metaEntityId);

  // Call Meta API
  const result = await metaApi.updateStatus(metaEntityId, 'PAUSED', context);

  // Update local DB
  await query(`UPDATE ${table} SET status = 'PAUSED', updated_at = NOW() WHERE ${idCol} = $1 AND account_id = $2`, [metaEntityId, resolvedAccountId]);

  // Log
  await logAction(resolvedAccountId, entityType, metaEntityId, entity.name, 'pause', {
    previous_status: entity.status,
    new_status: 'PAUSED',
  });

  return { success: true, entity: entity.name, action: 'paused' };
}

// ─── RESUME ───────────────────────────────────────────────

async function resumeEntity(accountId, entityType, metaEntityId, context = {}) {
  const { entity, table, idCol, accountId: resolvedAccountId } = await getOwnedEntity(accountId, entityType, metaEntityId);

  const result = await metaApi.updateStatus(metaEntityId, 'ACTIVE', context);

  await query(`UPDATE ${table} SET status = 'ACTIVE', updated_at = NOW() WHERE ${idCol} = $1 AND account_id = $2`, [metaEntityId, resolvedAccountId]);

  await logAction(resolvedAccountId, entityType, metaEntityId, entity.name, 'resume', {
    previous_status: entity.status,
    new_status: 'ACTIVE',
  });

  return { success: true, entity: entity.name, action: 'resumed' };
}

// ─── UPDATE BUDGET ────────────────────────────────────────

async function updateBudget(accountId, metaAdSetId, newBudget, context = {}) {
  const { entity: adset, accountId: resolvedAccountId } = await getOwnedEntity(accountId, 'adset', metaAdSetId, 'id, name, daily_budget');

  // Meta expects budget in cents
  const budgetCents = Math.round(newBudget * 100);
  const result = await metaApi.updateBudget(metaAdSetId, budgetCents, context);

  await query('UPDATE adsets SET daily_budget = $1, updated_at = NOW() WHERE meta_adset_id = $2 AND account_id = $3', [budgetCents, metaAdSetId, resolvedAccountId]);

  await logAction(resolvedAccountId, 'adset', metaAdSetId, adset.name, 'budget_change', {
    old_budget: adset.daily_budget,
    new_budget: budgetCents,
    new_budget_display: newBudget,
  });

  return { success: true, entity: adset.name, action: 'budget_updated', old: adset.daily_budget, new: budgetCents };
}

// ─── DUPLICATE ────────────────────────────────────────────

async function duplicateEntity(accountId, entityType, metaEntityId, context = {}) {
  const { entity, accountId: resolvedAccountId } = await getOwnedEntity(accountId, entityType, metaEntityId, 'id, name');

  const result = await metaApi.duplicateEntity(metaEntityId, entityType, context);

  await logAction(resolvedAccountId, entityType, metaEntityId, entity.name, 'duplicate', {
    source_id: metaEntityId,
    new_id: result.copied_campaign_id || result.copied_adset_id || result.copied_ad_id || 'unknown',
  });

  return { success: true, entity: entity.name, action: 'duplicated', result };
}

// ─── GET ACTION LOG ───────────────────────────────────────

async function getActionLog(accountId, limit = 50) {
  return queryAll(`
    SELECT * FROM action_log
    WHERE account_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [accountId, limit]);
}

module.exports = {
  pauseEntity,
  resumeEntity,
  updateBudget,
  duplicateEntity,
  getActionLog,
  logAction,
};
