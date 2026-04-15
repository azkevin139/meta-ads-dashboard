const express = require('express');
const router = express.Router();
const metaApi = require('../services/metaApi');
const config = require('../config');
const metaUsage = require('../services/metaUsageService');
const { logAction } = require('../services/actionService');

// Role guard
function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

router.use(adminOrOperator);

async function ensureSafeWrite(res) {
  const usage = await metaUsage.fetchLiveStatus();
  if (!usage.safe_to_write) {
    res.status(429).json({ error: `Meta API write pressure is too high right now. Wait ${usage.estimated_regain_seconds || 0}s before trying again.` });
    return false;
  }
  return true;
}

// ─── BULK ACTIONS ─────────────────────────────────────────

// POST /api/create/bulk-action
// Body: { entityIds: [...], entityType: 'campaign'|'adset'|'ad', action: 'pause'|'resume' }
router.post('/bulk-action', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(res))) return;
    const { entityIds, entityType, action } = req.body;
    if (!entityIds || !Array.isArray(entityIds) || entityIds.length === 0) {
      return res.status(400).json({ error: 'entityIds array required' });
    }
    if (!['pause', 'resume'].includes(action)) {
      return res.status(400).json({ error: 'action must be pause or resume' });
    }
    if (!['campaign', 'adset', 'ad'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType must be campaign, adset, or ad' });
    }

    const status = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    const results = [];

    for (const id of entityIds) {
      try {
        await metaApi.metaPost(`/${id}`, { status });
        await logAction(req.body.accountId || 1, entityType, id, id, action, {
          new_status: status,
          bulk: true,
          performed_by: req.user?.email || req.user?.name || null,
        });
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `${succeeded} ${entityType}(s) ${action}d${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATE CAMPAIGN ──────────────────────────────────────

// POST /api/create/campaign
router.post('/campaign', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(res))) return;
    const {
      name,
      objective,       // OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_APP_PROMOTION
      status,          // PAUSED or ACTIVE
      dailyBudget,     // in dollars (converted to cents)
      lifetimeBudget,  // in dollars
      specialAdCategories, // ['CREDIT', 'EMPLOYMENT', 'HOUSING', 'SOCIAL_ISSUES_ELECTIONS_POLITICS']
      buyingType,      // AUCTION (default)
    } = req.body;

    if (!name || !objective) {
      return res.status(400).json({ error: 'name and objective required' });
    }

    const payload = {
      name,
      objective,
      status: status || 'PAUSED',
      buying_type: buyingType || 'AUCTION',
      special_ad_categories: specialAdCategories || [],
    };

    // Budget at campaign level (CBO) — optional
    if (dailyBudget) payload.daily_budget = Math.round(dailyBudget * 100);
    if (lifetimeBudget) payload.lifetime_budget = Math.round(lifetimeBudget * 100);

    const result = await metaApi.metaPost(`/${config.meta.adAccountId}/campaigns`, payload);
    await logAction(req.body.accountId || 1, 'campaign', result.id, name, 'create', {
      payload,
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, campaign_id: result.id, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATE AD SET ────────────────────────────────────────

// POST /api/create/adset
router.post('/adset', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(res))) return;
    const {
      name,
      campaignId,
      status,
      dailyBudget,
      lifetimeBudget,
      bidStrategy,       // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
      bidAmount,         // for COST_CAP in cents
      optimizationGoal,  // OFFSITE_CONVERSIONS, LINK_CLICKS, IMPRESSIONS, REACH, LANDING_PAGE_VIEWS
      billingEvent,      // IMPRESSIONS, LINK_CLICKS
      // Pixel & conversion
      pixelId,
      customEventType,   // INITIATE_CHECKOUT, PURCHASE, LEAD, COMPLETE_REGISTRATION, ADD_TO_CART
      // Targeting
      ageMin,
      ageMax,
      genders,           // [] = all, [1] = male, [2] = female
      geoLocations,      // { countries: [], regions: [], cities: [] }
      excludedGeoLocations,
      locales,           // language locale IDs
      interests,         // [{ id, name }]
      customAudiences,   // [{ id }]
      excludedCustomAudiences,
      // Placements
      publisherPlatforms,    // ['facebook', 'instagram', 'messenger', 'audience_network']
      facebookPositions,     // ['feed', 'story', 'reels', 'right_hand_column', 'marketplace', etc.]
      instagramPositions,    // ['stream', 'story', 'reels', 'explore']
      devicePlatforms,       // ['mobile', 'desktop']
      // Schedule
      startTime,
      endTime,
    } = req.body;

    if (!name || !campaignId) {
      return res.status(400).json({ error: 'name and campaignId required' });
    }

    // Build targeting spec
    const targeting = {};
    if (ageMin) targeting.age_min = ageMin;
    if (ageMax) targeting.age_max = ageMax;
    if (genders && genders.length > 0) targeting.genders = genders;
    if (geoLocations) targeting.geo_locations = geoLocations;
    if (excludedGeoLocations) targeting.excluded_geo_locations = excludedGeoLocations;
    if (locales && locales.length > 0) targeting.locales = locales;
    if (interests && interests.length > 0) {
      targeting.flexible_spec = [{ interests }];
    }
    if (customAudiences && customAudiences.length > 0) {
      targeting.custom_audiences = customAudiences.map(id => ({ id }));
    }
    if (excludedCustomAudiences && excludedCustomAudiences.length > 0) {
      targeting.excluded_custom_audiences = excludedCustomAudiences.map(id => ({ id }));
    }
    // Placements
    if (publisherPlatforms && publisherPlatforms.length > 0) {
      targeting.publisher_platforms = publisherPlatforms;
    }
    if (facebookPositions && facebookPositions.length > 0) {
      targeting.facebook_positions = facebookPositions;
    }
    if (instagramPositions && instagramPositions.length > 0) {
      targeting.instagram_positions = instagramPositions;
    }
    if (devicePlatforms && devicePlatforms.length > 0) {
      targeting.device_platforms = devicePlatforms;
    }

    const payload = {
      name,
      campaign_id: campaignId,
      status: status || 'PAUSED',
      targeting: JSON.stringify(targeting),
      optimization_goal: optimizationGoal || 'OFFSITE_CONVERSIONS',
      billing_event: billingEvent || 'IMPRESSIONS',
    };

    if (dailyBudget) payload.daily_budget = Math.round(dailyBudget * 100);
    if (lifetimeBudget) payload.lifetime_budget = Math.round(lifetimeBudget * 100);
    if (bidStrategy) payload.bid_strategy = bidStrategy;
    if (bidAmount) payload.bid_amount = Math.round(bidAmount * 100);
    if (startTime) payload.start_time = startTime;
    if (endTime) payload.end_time = endTime;

    // Promoted object (pixel + event)
    if (pixelId) {
      payload.promoted_object = {
        pixel_id: pixelId,
        custom_event_type: customEventType || 'INITIATE_CHECKOUT',
      };
    }

    const result = await metaApi.metaPost(`/${config.meta.adAccountId}/adsets`, payload);
    await logAction(req.body.accountId || 1, 'adset', result.id, name, 'create', {
      payload,
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, adset_id: result.id, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CREATE AD ────────────────────────────────────────────

// POST /api/create/ad
router.post('/ad', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(res))) return;
    const {
      name,
      adsetId,
      status,
      // Creative fields
      pageId,
      imageHash,      // from uploaded image
      imageUrl,       // direct URL
      videoId,
      primaryText,
      headline,
      description,
      linkUrl,
      cta,            // SIGN_UP, LEARN_MORE, etc.
      // Or use existing creative
      creativeId,
    } = req.body;

    if (!name || !adsetId) {
      return res.status(400).json({ error: 'name and adsetId required' });
    }

    let creative_id = creativeId;

    // If no existing creative, create one
    if (!creative_id) {
      if (!pageId || !linkUrl) {
        return res.status(400).json({ error: 'pageId and linkUrl required to create creative' });
      }

      const linkData = {
        link: linkUrl,
        message: primaryText || '',
        name: headline || '',
        description: description || '',
      };

      if (imageHash) linkData.image_hash = imageHash;
      if (imageUrl) linkData.picture = imageUrl;

      if (cta) {
        linkData.call_to_action = { type: cta, value: { link: linkUrl } };
      }

      const creativePayload = {
        object_story_spec: JSON.stringify({
          page_id: pageId,
          link_data: linkData,
        }),
      };

      // If video, use video_data instead
      if (videoId) {
        creativePayload.object_story_spec = JSON.stringify({
          page_id: pageId,
          video_data: {
            video_id: videoId,
            title: headline || '',
            message: primaryText || '',
            link_description: description || '',
            call_to_action: cta ? { type: cta, value: { link: linkUrl } } : undefined,
            image_url: imageUrl || undefined,
          },
        });
      }

      const creativeResult = await metaApi.metaPost(`/${config.meta.adAccountId}/adcreatives`, creativePayload);
      creative_id = creativeResult.id;
    }

    // Create the ad
    const adPayload = {
      name,
      adset_id: adsetId,
      status: status || 'PAUSED',
      creative: JSON.stringify({ creative_id }),
    };

    const result = await metaApi.metaPost(`/${config.meta.adAccountId}/ads`, adPayload);
    await logAction(req.body.accountId || 1, 'ad', result.id, name, 'create', {
      adset_id: adsetId,
      creative_id,
      status: status || 'PAUSED',
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, ad_id: result.id, creative_id, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPER: Get pixels for this ad account ───────────────

router.get('/pixels', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(res))) return;
    const data = await metaApi.metaGet(`/${config.meta.adAccountId}/adspixels`, {
      fields: 'id,name,is_unavailable',
    });
    res.json({ data: data.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPER: Get pages for this account ───────────────────

router.get('/pages', async (req, res) => {
  try {
    const data = await metaApi.metaGet('/me/accounts', {
      fields: 'id,name,access_token',
      limit: '50',
    });
    res.json({ data: data.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPER: Upload image for creative ────────────────────

router.post('/upload-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    const result = await metaApi.metaPost(`/${config.meta.adAccountId}/adimages`, {
      url: imageUrl,
    });

    // Meta returns { images: { hash: { hash, url } } }
    const images = result.images || {};
    const firstKey = Object.keys(images)[0];
    const imageData = images[firstKey] || {};

    res.json({ success: true, hash: imageData.hash, url: imageData.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
