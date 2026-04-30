const express = require('express');
const { sendError } = require('../errorResponse');
const accountAccess = require('../services/accountAccessService');
const reporting = require('../services/reportingService');
const accountService = require('../services/accountService');
const reportLinks = require('../services/reportLinkService');
const securityAudit = require('../services/securityAuditService');
const { queryOne } = require('../db');
const { ensureArray, ensureInteger, ensureObject, optionalTrimmedString } = require('../validation');

const router = express.Router();

async function resolveReportAccount(req) {
  const requested = req.query.accountId || req.metaAccount?.id || null;
  if (req.user?.role === 'admin') {
    if (requested) {
      return accountAccess.resolveAuthorizedAccount(req, requested, { allowAdminOverride: true });
    }
    return req.metaAccount;
  }

  const accountId = parseInt(requested, 10);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    const err = new Error('No report account selected');
    err.httpStatus = 403;
    throw err;
  }
  const access = await queryOne(`
    SELECT 1
    FROM user_account_access
    WHERE user_id = $1 AND account_id = $2
    LIMIT 1
  `, [req.user.id, accountId]);
  if (!access) {
    const err = new Error('Report access denied');
    err.httpStatus = 403;
    throw err;
  }
  const account = await accountService.getAccountById(accountId);
  if (!account) {
    const err = new Error('Report account not found');
    err.httpStatus = 404;
    throw err;
  }
  return account;
}

router.get('/lead-summary', async (req, res) => {
  try {
    const account = await resolveReportAccount(req);
    const data = await reporting.getLeadReport(account.id, {
      preset: optionalTrimmedString(req.query.preset, 30),
      since: optionalTrimmedString(req.query.since, 20),
      until: optionalTrimmedString(req.query.until, 20),
    });
    res.json({
      account: {
        id: account.id,
        name: account.label || account.name,
        meta_account_id: account.meta_account_id,
        currency: account.currency,
      },
      data,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/links', async (req, res) => {
  try {
    const account = await resolveReportAccount(req);
    if (!['admin', 'operator'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Operator or admin access required' });
    }
    res.json({ data: await reportLinks.listLinks(account.id) });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/links', async (req, res) => {
  try {
    if (!['admin', 'operator'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Operator or admin access required' });
    }
    const body = ensureObject(req.body);
    const account = await resolveReportAccount(req);
    const link = await reportLinks.createLink(account.id, {
      name: optionalTrimmedString(body.name, 200),
      presetRestrictions: body.presetRestrictions === undefined ? [] : ensureArray(body.presetRestrictions, 'presetRestrictions must be an array'),
      expiresAt: optionalTrimmedString(body.expiresAt, 80),
      createdByUserId: req.user?.id || null,
    });
    await securityAudit.fromRequest(req, {
      action: 'report_link.created',
      target_type: 'report_link',
      target_id: String(link.id),
      account_id: account.id,
      after_json: { id: link.id, name: link.name, expires_at: link.expires_at },
    });
    res.json({ success: true, data: link });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/links/:id/revoke', async (req, res) => {
  try {
    if (!['admin', 'operator'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Operator or admin access required' });
    }
    const account = await resolveReportAccount(req);
    const linkId = ensureInteger(req.params.id, 'Invalid report link id');
    const link = await reportLinks.revokeLink(account.id, linkId, req.user?.id || null);
    await securityAudit.fromRequest(req, {
      action: 'report_link.revoked',
      target_type: 'report_link',
      target_id: String(link.id),
      account_id: account.id,
    });
    res.json({ success: true, data: link });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
