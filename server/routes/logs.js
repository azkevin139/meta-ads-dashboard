const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const actionService = require('../services/actionService');

// GET /api/logs?accountId=1&limit=50
router.get('/', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await actionService.getActionLog(accountId, limit);
    res.json({ data: logs });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
