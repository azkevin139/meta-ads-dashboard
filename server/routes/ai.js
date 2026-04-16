const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const aiService = require('../services/aiService');
const { ensureEnum, ensureInteger, ensureObject } = require('../validation');

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
    const status = ensureEnum(req.query.status || 'pending', ['all', 'pending', 'approved', 'dismissed'], 'Invalid status');
    const recs = await aiService.getRecommendations(accountId, status);
    res.json({ data: recs });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/run?accountId=1 — trigger analysis manually
router.post('/run', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawAccountId = req.query.accountId || body.accountId || 1;
    const accountId = ensureInteger(rawAccountId, 'accountId must be a positive integer');
    const result = await aiService.runAnalysis(accountId, req.metaAccount);
    res.json({ data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/approve/:id
router.post('/approve/:id', async (req, res) => {
  try {
    const id = ensureInteger(req.params.id, 'id must be a positive integer');
    await aiService.updateRecommendation(id, 'approved');
    res.json({ success: true, id, status: 'approved' });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/ai/dismiss/:id
router.post('/dismiss/:id', async (req, res) => {
  try {
    const id = ensureInteger(req.params.id, 'id must be a positive integer');
    await aiService.updateRecommendation(id, 'dismissed');
    res.json({ success: true, id, status: 'dismissed' });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
