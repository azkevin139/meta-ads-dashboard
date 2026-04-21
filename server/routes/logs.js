const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const actionService = require('../services/actionService');
const accountAccess = require('../services/accountAccessService');

// GET /api/logs?accountId=1&limit=50
router.get('/', async (req, res) => {
  try {
    const account = await accountAccess.resolveAuthorizedAccount(req, req.query.accountId, { allowAdminOverride: true });
    const accountId = account.id;
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await actionService.getActionLog(accountId, limit);
    res.json({ data: logs });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
