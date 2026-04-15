const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const insights = require('../services/insightsService');

// GET /api/insights/overview?accountId=1&days=7
router.get('/overview', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId, 10) || 1;
    const days = parseInt(req.query.days, 10) || 7;

    const [overview, deltas, activeCampaigns] = await Promise.all([
      insights.getOverview(accountId, days),
      insights.getOverviewDeltas(accountId, days),
      insights.getActiveCampaignCount(accountId),
    ]);

    res.json({ overview, deltas, activeCampaigns });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/insights/campaigns?accountId=1&days=7
router.get('/campaigns', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId, 10) || 1;
    const days = parseInt(req.query.days, 10) || 7;
    const campaigns = await insights.getCampaignInsights(accountId, days);
    res.json({ data: campaigns });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/insights/campaign-trend?campaignId=1&days=7
router.get('/campaign-trend', async (req, res) => {
  try {
    const campaignId = parseInt(req.query.campaignId, 10);
    const days = parseInt(req.query.days, 10) || 7;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    const trend = await insights.getCampaignTrend(campaignId, days);
    res.json({ data: trend });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/insights/adsets?campaignId=1&days=7
router.get('/adsets', async (req, res) => {
  try {
    const campaignId = parseInt(req.query.campaignId, 10);
    const days = parseInt(req.query.days, 10) || 7;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    const adsets = await insights.getAdSetInsights(campaignId, days);
    res.json({ data: adsets });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/insights/ads?adsetId=1&days=7
router.get('/ads', async (req, res) => {
  try {
    const adsetId = parseInt(req.query.adsetId, 10);
    const days = parseInt(req.query.days, 10) || 7;
    if (!adsetId) return res.status(400).json({ error: 'adsetId required' });
    const ads = await insights.getAdInsights(adsetId, days);
    res.json({ data: ads });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/insights/trend?entityId=1&level=campaign&days=30
router.get('/trend', async (req, res) => {
  try {
    const entityId = parseInt(req.query.entityId, 10);
    const level = req.query.level || 'campaign';
    const days = parseInt(req.query.days, 10) || 30;
    if (!entityId) return res.status(400).json({ error: 'entityId required' });
    const trend = await insights.getTrend(entityId, level, days);
    res.json({ data: trend });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
