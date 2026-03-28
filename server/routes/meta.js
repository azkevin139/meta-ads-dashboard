const express = require('express');
const router = express.Router();
const metaApi = require('../services/metaApi');
const config = require('../config');

// Role guard for write operations
function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

// GET /api/meta/accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await metaApi.getAdAccounts();
    res.json({ data: accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/campaigns?accountId=act_XXX
router.get('/campaigns', async (req, res) => {
  try {
    const accountId = req.query.accountId || config.meta.adAccountId;
    const campaigns = await metaApi.getCampaigns(accountId);
    res.json({ data: campaigns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/adsets?campaignId=XXX
router.get('/adsets', async (req, res) => {
  try {
    const { campaignId } = req.query;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    const adsets = await metaApi.getAdSets(campaignId);
    res.json({ data: adsets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/ads?adSetId=XXX
router.get('/ads', async (req, res) => {
  try {
    const { adSetId } = req.query;
    if (!adSetId) return res.status(400).json({ error: 'adSetId required' });
    const ads = await metaApi.getAds(adSetId);
    res.json({ data: ads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/insights?entityId=XXX&datePreset=yesterday&level=campaign
router.get('/insights', async (req, res) => {
  try {
    const { entityId, datePreset, level, since, until } = req.query;
    if (!entityId) return res.status(400).json({ error: 'entityId required' });

    let insights;
    if (since && until) {
      insights = await metaApi.getInsightsRange(entityId, since, until, level || 'campaign');
    } else {
      insights = await metaApi.getInsights(entityId, {
        date_preset: datePreset || 'yesterday',
        level: level || 'campaign',
      });
    }
    res.json({ data: insights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/creative-thumbnail?adId=XXX
router.get('/creative-thumbnail', async (req, res) => {
  try {
    const { adId } = req.query;
    if (!adId) return res.status(400).json({ error: 'adId required' });
    
    // Fetch the ad with creative details and preview
    const data = await metaApi.metaGet(`/${adId}`, {
      fields: 'creative{thumbnail_url,image_url,image_hash,object_story_spec,asset_feed_spec},preview_shareable_link',
    });
    
    const creative = data.creative || {};
    const storySpec = creative.object_story_spec || {};
    const linkData = storySpec.link_data || {};
    const videoData = storySpec.video_data || {};
    
    // Try to get the best quality image
    const imageUrl = linkData.image_hash 
      ? null // hash needs separate lookup
      : linkData.picture || videoData.image_url || creative.image_url || creative.thumbnail_url || null;
    
    res.json({
      thumbnail_url: creative.thumbnail_url || null,
      image_url: imageUrl,
      preview_url: data.preview_shareable_link || null,
    });
  } catch (err) {
    res.json({ thumbnail_url: null, image_url: null, preview_url: null });
  }
});

// GET /api/meta/today?level=campaign — live today's data from Meta API
router.get('/today', async (req, res) => {
  try {
    const level = req.query.level || 'campaign';
    const data = await metaApi.getInsights(config.meta.adAccountId, {
      date_preset: 'today',
      level: level,
      fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
    });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/ad-detail?adId=XXX — full ad creative details
router.get('/ad-detail', async (req, res) => {
  try {
    const { adId } = req.query;
    if (!adId) return res.status(400).json({ error: 'adId required' });
    const data = await metaApi.metaGet(`/${adId}`, {
      fields: 'id,name,status,effective_status,creative{id,title,body,call_to_action_type,link_url,image_url,thumbnail_url,object_story_spec,asset_feed_spec}',
    });

    const creative = data.creative || {};
    const storySpec = creative.object_story_spec || {};
    const linkData = storySpec.link_data || {};
    const videoData = storySpec.video_data || {};

    res.json({
      id: data.id,
      name: data.name,
      status: data.status,
      creative_id: creative.id,
      headline: linkData.name || videoData.title || creative.title || '',
      primary_text: linkData.message || videoData.message || creative.body || '',
      description: linkData.description || '',
      cta: linkData.call_to_action?.type || videoData.call_to_action?.type || creative.call_to_action_type || '',
      link_url: linkData.link || videoData.call_to_action?.value?.link || creative.link_url || '',
      display_link: linkData.caption || '',
      image_url: linkData.picture || videoData.image_url || creative.image_url || '',
      thumbnail_url: creative.thumbnail_url || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meta/update-ad — edit ad creative text fields
router.post('/update-ad', adminOrOperator, async (req, res) => {
  try {
    const { adId, creativeId, headline, primaryText, description, cta, linkUrl } = req.body;
    if (!adId) return res.status(400).json({ error: 'adId required' });

    // To edit an ad's creative, we need to create a new creative with updated fields
    // and then update the ad to use the new creative
    const adData = await metaApi.metaGet(`/${adId}`, {
      fields: 'creative{object_story_spec,asset_feed_spec}',
    });
    const oldCreative = adData.creative || {};
    const oldStorySpec = oldCreative.object_story_spec || {};
    const oldLinkData = oldStorySpec.link_data || {};
    const pageId = oldStorySpec.page_id;

    if (!pageId) {
      return res.status(400).json({ error: 'Cannot determine page_id from existing creative' });
    }

    // Build updated link_data
    const newLinkData = { ...oldLinkData };
    if (headline !== undefined) newLinkData.name = headline;
    if (primaryText !== undefined) newLinkData.message = primaryText;
    if (description !== undefined) newLinkData.description = description;
    if (linkUrl !== undefined) newLinkData.link = linkUrl;
    if (cta !== undefined) {
      newLinkData.call_to_action = { type: cta, value: { link: newLinkData.link || oldLinkData.link } };
    }

    // Create new creative
    const newCreative = await metaApi.metaPost(`/${config.meta.adAccountId}/adcreatives`, {
      object_story_spec: {
        page_id: pageId,
        link_data: newLinkData,
      },
    });

    // Update ad to use new creative
    await metaApi.metaPost(`/${adId}`, {
      creative: { creative_id: newCreative.id },
    });

    res.json({ success: true, new_creative_id: newCreative.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/meta/adset-detail?adsetId=XXX — full ad set targeting + placement
router.get('/adset-detail', async (req, res) => {
  try {
    const { adsetId } = req.query;
    if (!adsetId) return res.status(400).json({ error: 'adsetId required' });
    const data = await metaApi.metaGet(`/${adsetId}`, {
      fields: 'id,name,status,targeting,promoted_object,bid_strategy,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time',
    });

    const targeting = data.targeting || {};

    res.json({
      id: data.id,
      name: data.name,
      status: data.status,
      bid_strategy: data.bid_strategy,
      optimization_goal: data.optimization_goal,
      daily_budget: data.daily_budget,
      // Targeting breakdown
      age_min: targeting.age_min || null,
      age_max: targeting.age_max || null,
      genders: targeting.genders || [],
      geo_locations: targeting.geo_locations || {},
      interests: (targeting.flexible_spec || []).flatMap(s => (s.interests || []).map(i => i.name)),
      custom_audiences: (targeting.custom_audiences || []).map(a => ({ id: a.id, name: a.name })),
      excluded_custom_audiences: (targeting.excluded_custom_audiences || []).map(a => ({ id: a.id, name: a.name })),
      locales: targeting.locales || [],
      // Placements
      publisher_platforms: targeting.publisher_platforms || ['automatic'],
      facebook_positions: targeting.facebook_positions || [],
      instagram_positions: targeting.instagram_positions || [],
      messenger_positions: targeting.messenger_positions || [],
      audience_network_positions: targeting.audience_network_positions || [],
      device_platforms: targeting.device_platforms || [],
      // Raw for debugging
      targeting_raw: targeting,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/meta/update-adset — edit ad set targeting, budget, status
router.post('/update-adset', adminOrOperator, async (req, res) => {
  try {
    const { adsetId, ageMin, ageMax, genders, dailyBudget, bidStrategy, status } = req.body;
    if (!adsetId) return res.status(400).json({ error: 'adsetId required' });

    // First get current targeting to merge
    const current = await metaApi.metaGet(`/${adsetId}`, { fields: 'targeting' });
    const currentTargeting = current.targeting || {};

    // Build update payload
    const update = {};

    // Update targeting (merge with existing)
    const newTargeting = { ...currentTargeting };
    if (ageMin !== undefined) newTargeting.age_min = ageMin;
    if (ageMax !== undefined) newTargeting.age_max = ageMax;
    if (genders !== undefined) {
      if (genders.length === 0) {
        delete newTargeting.genders;
      } else {
        newTargeting.genders = genders;
      }
    }
    update.targeting = JSON.stringify(newTargeting);

    if (dailyBudget !== undefined) update.daily_budget = dailyBudget;
    if (bidStrategy) update.bid_strategy = bidStrategy;
    if (status) update.status = status;

    const result = await metaApi.metaPost(`/${adsetId}`, update);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
