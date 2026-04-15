const express = require('express');
const { sendError } = require('../errorResponse');
const tracking = require('../services/trackingService');

const router = express.Router();

router.post('/ghl', async (req, res) => {
  try {
    const visitor = await tracking.handleGhlWebhook(req.body || {});
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/meta-leads', async (req, res) => {
  try {
    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [body];
    const results = [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [entry];
      for (const change of changes) {
        const value = change.value || change;
        const visitor = await tracking.handleMetaLead({
          ...value,
          meta_lead_id: value.leadgen_id || value.meta_lead_id,
          campaign_id: value.campaign_id,
          adset_id: value.adset_id,
          ad_id: value.ad_id,
          raw: value,
        });
        results.push(visitor.client_id);
      }
    }
    res.json({ success: true, count: results.length });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/meta-leads', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (verifyToken && req.query['hub.verify_token'] !== verifyToken) {
    return res.status(403).send('Invalid verify token');
  }
  res.send(req.query['hub.challenge'] || 'ok');
});

module.exports = router;
