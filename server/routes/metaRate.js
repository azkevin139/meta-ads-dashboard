const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');

router.get('/rate-limit-status', async (req, res) => {
  try {
    const usage = await metaUsage.fetchLiveStatus(false, req.metaAccount);
    res.json({ ok: true, ...usage });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
