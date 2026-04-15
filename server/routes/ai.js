const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const aiService = require('../services/aiService');

// GET /api/ai/daily?accountId=1
router.get('/daily', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId, 10) || 1;
    const analysis = await aiService.getDailyAnalysis(accountId);
    res.json({ data: analysis });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/ai/recommendations?accountId=1&status=pending
router.get('/recommendations', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId, 10) || 1;
    const status = req.query.status || 'pending';
    const recs = await aiService.getRecommendations(accountId, status);
    res.json({ data: recs });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/run?accountId=1 — trigger analysis manually
router.post('/run', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId || req.body.accountId, 10) || 1;
    const result = await aiService.runAnalysis(accountId, req.metaAccount);
    res.json({ data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/approve/:id
router.post('/approve/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await aiService.updateRecommendation(id, 'approved');
    res.json({ success: true, id, status: 'approved' });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/dismiss/:id
router.post('/dismiss/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await aiService.updateRecommendation(id, 'dismissed');
    res.json({ success: true, id, status: 'dismissed' });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
