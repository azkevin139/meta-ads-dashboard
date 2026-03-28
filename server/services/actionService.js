const metaApi = require('./metaApi');
const { query, queryOne, queryAll } = require('../db');

// ─── LOG EVERY ACTION ─────────────────────────────────────

async function logAction(accountId, entityType, entityId, entityName, action, details, source = 'manual', recommendationId = null) {
  return query(`
    INSERT INTO action_log (account_id, entity_type, entity_id, entity_name, action, details, source, recommendation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [accountId, entityType, entityId, entityName, action, JSON.stringify(details), source, recommendationId]);
}

// ─── PAUSE ────────────────────────────────────────────────

async function pauseEntity(accountId, entityType, metaEntityId) {
  // Get entity name for logging
  const table = entityType === 'campaign' ? 'campaigns'
    : entityType === 'adset' ? 'adsets' : 'ads';
  const idCol = entityType === 'campaign' ? 'meta_campaign_id'
    : entityType === 'adset' ? 'meta_adset_id' : 'meta_ad_id';

  const entity = await queryOne(`SELECT id, name, status FROM ${table} WHERE ${idCol} = $1`, [metaEntityId]);
  if (!entity) throw new Error(`${entityType} not found: ${metaEntityId}`);

  // Call Meta API
  const result = await metaApi.updateStatus(metaEntityId, 'PAUSED');

  // Update local DB
  await query(`UPDATE ${table} SET status = 'PAUSED', updated_at = NOW() WHERE ${idCol} = $1`, [metaEntityId]);

  // Log
  await logAction(accountId, entityType, metaEntityId, entity.name, 'pause', {
    previous_status: entity.status,
    new_status: 'PAUSED',
  });

  return { success: true, entity: entity.name, action: 'paused' };
}

// ─── RESUME ───────────────────────────────────────────────

async function resumeEntity(accountId, entityType, metaEntityId) {
  const table = entityType === 'campaign' ? 'campaigns'
    : entityType === 'adset' ? 'adsets' : 'ads';
  const idCol = entityType === 'campaign' ? 'meta_campaign_id'
    : entityType === 'adset' ? 'meta_adset_id' : 'meta_ad_id';

  const entity = await queryOne(`SELECT id, name, status FROM ${table} WHERE ${idCol} = $1`, [metaEntityId]);
  if (!entity) throw new Error(`${entityType} not found: ${metaEntityId}`);

  const result = await metaApi.updateStatus(metaEntityId, 'ACTIVE');

  await query(`UPDATE ${table} SET status = 'ACTIVE', updated_at = NOW() WHERE ${idCol} = $1`, [metaEntityId]);

  await logAction(accountId, entityType, metaEntityId, entity.name, 'resume', {
    previous_status: entity.status,
    new_status: 'ACTIVE',
  });

  return { success: true, entity: entity.name, action: 'resumed' };
}

// ─── UPDATE BUDGET ────────────────────────────────────────

async function updateBudget(accountId, metaAdSetId, newBudget) {
  const adset = await queryOne('SELECT id, name, daily_budget FROM adsets WHERE meta_adset_id = $1', [metaAdSetId]);
  if (!adset) throw new Error(`Ad set not found: ${metaAdSetId}`);

  // Meta expects budget in cents
  const budgetCents = Math.round(newBudget * 100);
  const result = await metaApi.updateBudget(metaAdSetId, budgetCents);

  await query('UPDATE adsets SET daily_budget = $1, updated_at = NOW() WHERE meta_adset_id = $2', [budgetCents, metaAdSetId]);

  await logAction(accountId, 'adset', metaAdSetId, adset.name, 'budget_change', {
    old_budget: adset.daily_budget,
    new_budget: budgetCents,
    new_budget_display: newBudget,
  });

  return { success: true, entity: adset.name, action: 'budget_updated', old: adset.daily_budget, new: budgetCents };
}

// ─── DUPLICATE ────────────────────────────────────────────

async function duplicateEntity(accountId, entityType, metaEntityId) {
  const table = entityType === 'campaign' ? 'campaigns'
    : entityType === 'adset' ? 'adsets' : 'ads';
  const idCol = entityType === 'campaign' ? 'meta_campaign_id'
    : entityType === 'adset' ? 'meta_adset_id' : 'meta_ad_id';

  const entity = await queryOne(`SELECT id, name FROM ${table} WHERE ${idCol} = $1`, [metaEntityId]);
  if (!entity) throw new Error(`${entityType} not found: ${metaEntityId}`);

  const result = await metaApi.duplicateEntity(metaEntityId, entityType);

  await logAction(accountId, entityType, metaEntityId, entity.name, 'duplicate', {
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
