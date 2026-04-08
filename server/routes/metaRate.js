const express = require('express');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');

router.get('/rate-limit-status', async (req, res) => {
  try {
    const usage = await metaUsage.fetchLiveStatus();
    res.json({ ok: true, ...usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
