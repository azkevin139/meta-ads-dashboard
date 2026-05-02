const { queryOne } = require('../db');
const accountService = require('./accountService');
const accountAccess = require('./accountAccessService');

function httpError(status, message, code) {
  const err = new Error(message);
  err.httpStatus = status;
  if (code) err.code = code;
  return err;
}

function forbidden(message = 'Meta account access denied') {
  return httpError(403, message, 'meta_scope_denied');
}

function notFound(message = 'Meta entity not found') {
  return httpError(404, message, 'meta_entity_not_found');
}

function normalizeMetaAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function isNumericId(value) {
  const raw = String(value || '').trim();
  return /^[1-9]\d*$/.test(raw);
}

async function resolveAccountByMetaAccountId(req, metaAccountId) {
  const normalized = normalizeMetaAccountId(metaAccountId);
  if (!normalized) throw forbidden('Invalid Meta account id');

  if (req.metaAccount?.meta_account_id === normalized) {
    return req.metaAccount;
  }

  const row = await queryOne('SELECT id FROM accounts WHERE meta_account_id = $1', [normalized]);
  if (!row?.id) throw forbidden('Meta account not configured');
  return accountAccess.resolveAuthorizedAccount(req, row.id, { allowAdminOverride: true });
}

async function resolveAuthorizedMetaAccount(req, requestedAccountId = null) {
  const requested = String(requestedAccountId || '').trim();
  if (!requested) {
    if (!req.metaAccount?.id && !req.metaAccount?.meta_account_id) throw forbidden('No active Meta account');
    return req.metaAccount;
  }

  if (requested.startsWith('act_')) {
    return resolveAccountByMetaAccountId(req, requested);
  }

  if (isNumericId(requested)) {
    if (Number(req.metaAccount?.id) === Number(requested)) {
      return req.metaAccount;
    }

    const activeMetaId = String(req.metaAccount?.meta_account_id || '').replace(/^act_/, '');
    if (activeMetaId && requested === activeMetaId) {
      return req.metaAccount;
    }

    const internalRow = await queryOne('SELECT id FROM accounts WHERE id = $1', [Number(requested)]);
    if (internalRow?.id) {
      return accountAccess.resolveAuthorizedAccount(req, internalRow.id, { allowAdminOverride: true });
    }

    const row = await queryOne('SELECT id FROM accounts WHERE meta_account_id = $1', [normalizeMetaAccountId(requested)]);
    if (row?.id) {
      return accountAccess.resolveAuthorizedAccount(req, row.id, { allowAdminOverride: true });
    }

    throw forbidden('Meta account not configured');
  }

  throw forbidden('Invalid Meta account id');
}

function entityLookup(level, id) {
  if (level === 'campaign') {
    return queryOne(
      'SELECT account_id, meta_campaign_id AS entity_id FROM campaigns WHERE meta_campaign_id = $1 LIMIT 1',
      [id]
    );
  }
  if (level === 'adset') {
    return queryOne(
      'SELECT account_id, campaign_id, meta_adset_id AS entity_id FROM adsets WHERE meta_adset_id = $1 LIMIT 1',
      [id]
    );
  }
  if (level === 'ad') {
    return queryOne(
      'SELECT account_id, campaign_id, adset_id, meta_ad_id AS entity_id FROM ads WHERE meta_ad_id = $1 LIMIT 1',
      [id]
    );
  }
  throw forbidden('Invalid Meta entity level');
}

async function resolveAuthorizedEntity(req, level, entityId, requestedAccountId = null) {
  const id = String(entityId || '').trim();
  if (!id) throw forbidden('Meta entity id required');

  const entity = await entityLookup(level, id);
  if (!entity?.account_id) {
    throw notFound('Meta entity not found in local warehouse. Sync Meta metadata before reading this entity.');
  }

  const account = requestedAccountId
    ? await resolveAuthorizedMetaAccount(req, requestedAccountId)
    : await accountAccess.resolveAuthorizedAccount(req, entity.account_id, { allowAdminOverride: true });

  if (Number(account.id) !== Number(entity.account_id)) {
    throw forbidden('Meta entity does not belong to the requested account');
  }

  const hydrated = account.access_token
    ? account
    : await accountService.getAccountById(account.id);

  return {
    account: hydrated || account,
    accountId: entity.account_id,
    metaAccountId: (hydrated || account).meta_account_id,
    level,
    entityId: id,
    entity,
    scopeValidated: true,
  };
}

async function resolveAuthorizedMetaScope(req, {
  requestedAccountId = null,
  requestedCampaignId = null,
  requestedAdsetId = null,
  requestedAdId = null,
} = {}) {
  if (requestedAdId) {
    return resolveAuthorizedEntity(req, 'ad', requestedAdId, requestedAccountId);
  }
  if (requestedAdsetId) {
    return resolveAuthorizedEntity(req, 'adset', requestedAdsetId, requestedAccountId);
  }
  if (requestedCampaignId) {
    return resolveAuthorizedEntity(req, 'campaign', requestedCampaignId, requestedAccountId);
  }

  const account = await resolveAuthorizedMetaAccount(req, requestedAccountId);
  return {
    account,
    accountId: account.id,
    metaAccountId: account.meta_account_id,
    scopeValidated: true,
  };
}

function entityRequestForLevel(level, entityId) {
  if (level === 'campaign') return { requestedCampaignId: entityId };
  if (level === 'adset') return { requestedAdsetId: entityId };
  if (level === 'ad') return { requestedAdId: entityId };
  return {};
}

module.exports = {
  resolveAuthorizedMetaAccount,
  resolveAuthorizedMetaScope,
  resolveAuthorizedEntity,
  entityRequestForLevel,
};
