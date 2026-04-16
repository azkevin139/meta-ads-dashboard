const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');
const metaCache = require('../services/metaCache');

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.get('/rate-limit-status', async (req, res) => {
  try {
    const accountId = req.metaAccount?.id || null;
    const [usage, budget] = await Promise.all([
      metaUsage.fetchLiveStatus(false, req.metaAccount).catch(err => ({ error: err.message })),
      Promise.resolve(metaCache.budgetStatus(accountId)),
    ]);
    res.json({
      ok: true,
      ...(usage.error ? { meta_probe_error: usage.error } : usage),
      cache_budget: budget,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/cache-stats', adminOnly, async (req, res) => {
  try {
    res.json(metaCache.stats());
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
