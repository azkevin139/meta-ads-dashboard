const express = require('express');
const router = express.Router();
const metaApi = require('../services/metaApi');
const creativeService = require('../services/metaCreativeService');
const config = require('../config');

function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

router.get('/accounts', async (req, res) => {
  try {
    const accounts = await metaApi.getAdAccounts();
    res.json({ data: accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/campaigns', async (req, res) => {
  try {
    const accountId = req.query.accountId || config.meta.adAccountId;
    const campaigns = await metaApi.getCampaigns(accountId);
    res.json({ data: campaigns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/adsets', async (req, res) => {
  try {
    const { campaignId } = req.query;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    const adsets = await metaApi.getAdSets(campaignId);
    res.json({ data: adsets });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/ads', async (req, res) => {
  try {
    const { adSetId } = req.query;
    if (!adSetId) return res.status(400).json({ error: 'adSetId required' });
    const ads = await metaApi.getAds(adSetId);
    res.json({ data: ads });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/insights', async (req, res) => {
  try {
    const { entityId, datePreset, level, since, until } = req.query;
    if (!entityId) return res.status(400).json({ error: 'entityId required' });
    const insights = (since && until)
      ? await metaApi.getInsightsRange(entityId, since, until, level || 'campaign')
      : await metaApi.getInsights(entityId, { date_preset: datePreset || 'yesterday', level: level || 'campaign' });
    res.json({ data: insights });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/creative-thumbnail', async (req, res) => {
  try {
    const { adId } = req.query;
    if (!adId) return res.status(400).json({ error: 'adId required' });
    const data = await metaApi.metaGet(`/${adId}`, { fields: 'creative{thumbnail_url,image_url,image_hash,object_story_spec,asset_feed_spec},preview_shareable_link' });
    const creative = data.creative || {};
    const storySpec = creative.object_story_spec || {};
    const linkData = storySpec.link_data || {};
    const videoData = storySpec.video_data || {};
    const imageUrl = linkData.image_hash ? null : linkData.picture || videoData.image_url || creative.image_url || creative.thumbnail_url || null;
    res.json({ thumbnail_url: creative.thumbnail_url || null, image_url: imageUrl, preview_url: data.preview_shareable_link || null });
  } catch (err) {
    res.json({ thumbnail_url: null, image_url: null, preview_url: null });
  }
});
router.get('/live', async (req, res) => {
  try {
    const level = req.query.level || 'campaign';
    const since = req.query.since;
    const until = req.query.until;
    const datePreset = req.query.preset || null;
    const params = { level, fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type' };
    if (since && until) params.time_range = JSON.stringify({ since, until });
    else if (datePreset) params.date_preset = datePreset;
    else params.date_preset = 'today';
    const data = await metaApi.getInsights(config.meta.adAccountId, params);
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/today', async (req, res) => {
  try {
    const level = req.query.level || 'campaign';
    const data = await metaApi.getInsights(config.meta.adAccountId, {
      date_preset: 'today', level,
      fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
    });
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ad-detail', async (req, res) => {
  try {
    const { adId } = req.query;
    if (!adId) return res.status(400).json({ error: 'adId required' });
    const studio = await creativeService.getAdStudio(adId);
    res.json(studio);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ad-creatives', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '25', 10);
    const data = await creativeService.getAdCreatives(limit);
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/page-identities', async (req, res) => {
  try {
    const data = await creativeService.getPageIdentities();
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ad-validate', adminOrOperator, async (req, res) => {
  try {
    const validation = creativeService.validatePayload(req.body || {});
    res.json({ success: validation.valid, validation });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ad-studio-update', adminOrOperator, async (req, res) => {
  try {
    const result = await creativeService.updateAdStudio(req.body, req.user?.email || req.user?.name || null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, validation: err.validation || null });
  }
});

router.post('/update-ad', adminOrOperator, async (req, res) => {
  try {
    const result = await creativeService.updateAdStudio({
      mode: 'clone_transform',
      adId: req.body.adId,
      name: req.body.name,
      status: req.body.status,
      pageId: req.body.pageId,
      instagramActorId: req.body.instagramActorId,
      headline: req.body.headline,
      primaryText: req.body.primaryText,
      description: req.body.description,
      cta: req.body.cta,
      linkUrl: req.body.linkUrl,
      displayLink: req.body.displayLink,
      imageUrl: req.body.imageUrl,
      imageHash: req.body.imageHash,
      videoId: req.body.videoId,
      accountId: req.body.accountId || 1,
      versionNote: req.body.versionNote || null,
    }, req.user?.email || req.user?.name || null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, validation: err.validation || null });
  }
});

router.get('/adset-detail', async (req, res) => {
  try {
    const { adsetId } = req.query;
    if (!adsetId) return res.status(400).json({ error: 'adsetId required' });
    const data = await metaApi.metaGet(`/${adsetId}`, {
      fields: 'id,name,status,targeting,promoted_object,bid_strategy,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time',
    });
    const targeting = data.targeting || {};
    res.json({
      id: data.id, name: data.name, status: data.status, bid_strategy: data.bid_strategy, optimization_goal: data.optimization_goal, daily_budget: data.daily_budget,
      age_min: targeting.age_min || null, age_max: targeting.age_max || null, genders: targeting.genders || [], geo_locations: targeting.geo_locations || {},
      interests: (targeting.flexible_spec || []).flatMap(s => (s.interests || []).map(i => i.name)),
      custom_audiences: (targeting.custom_audiences || []).map(a => ({ id: a.id, name: a.name })),
      excluded_custom_audiences: (targeting.excluded_custom_audiences || []).map(a => ({ id: a.id, name: a.name })), locales: targeting.locales || [],
      publisher_platforms: targeting.publisher_platforms || ['automatic'], facebook_positions: targeting.facebook_positions || [], instagram_positions: targeting.instagram_positions || [], messenger_positions: targeting.messenger_positions || [], audience_network_positions: targeting.audience_network_positions || [], device_platforms: targeting.device_platforms || [], targeting_raw: targeting,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/update-adset', adminOrOperator, async (req, res) => {
  try {
    const { adsetId, ageMin, ageMax, genders, dailyBudget, bidStrategy, status } = req.body;
    if (!adsetId) return res.status(400).json({ error: 'adsetId required' });
    const current = await metaApi.metaGet(`/${adsetId}`, { fields: 'targeting' });
    const currentTargeting = current.targeting || {};
    const update = {};
    const newTargeting = { ...currentTargeting };
    if (ageMin !== undefined) newTargeting.age_min = ageMin;
    if (ageMax !== undefined) newTargeting.age_max = ageMax;
    if (genders !== undefined) { if (genders.length === 0) delete newTargeting.genders; else newTargeting.genders = genders; }
    update.targeting = JSON.stringify(newTargeting);
    if (dailyBudget !== undefined) update.daily_budget = dailyBudget;
    if (bidStrategy) update.bid_strategy = bidStrategy;
    if (status) update.status = status;
    const result = await metaApi.metaPost(`/${adsetId}`, update);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
