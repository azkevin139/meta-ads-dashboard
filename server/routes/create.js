const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaApi = require('../services/metaApi');
const metaUsage = require('../services/metaUsageService');
const { logAction } = require('../services/actionService');
const {
  badRequest,
  ensureArray,
  ensureEnum,
  ensureNonEmptyString,
  ensureObject,
  optionalNumber,
  optionalTrimmedString,
} = require('../validation');

const CAMPAIGN_OBJECTIVES = [
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_AWARENESS',
  'OUTCOME_APP_PROMOTION',
];

const CAMPAIGN_STATUSES = ['PAUSED', 'ACTIVE'];
const BUYING_TYPES = ['AUCTION', 'RESERVED'];
const SPECIAL_AD_CATEGORIES = ['CREDIT', 'EMPLOYMENT', 'HOUSING', 'SOCIAL_ISSUES_ELECTIONS_POLITICS'];

// Role guard
function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

router.use(adminOrOperator);

async function ensureSafeWrite(req, res) {
  const usage = await metaUsage.fetchLiveStatus(false, req.metaAccount);
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
    if (!(await ensureSafeWrite(req, res))) return;
    const body = ensureObject(req.body);
    const entityIds = ensureArray(body.entityIds, 'entityIds array required').map((id) => ensureNonEmptyString(id, 'entityIds must contain ids'));
    const entityType = ensureEnum(body.entityType, ['campaign', 'adset', 'ad'], 'entityType must be campaign, adset, or ad');
    const action = ensureEnum(body.action, ['pause', 'resume'], 'action must be pause or resume');

    const status = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    const results = [];

    for (const id of entityIds) {
      try {
        await metaApi.metaPost(`/${id}`, { status }, req.metaAccount);
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
    sendError(res, err);
  }
});

// ─── CREATE CAMPAIGN ──────────────────────────────────────

// POST /api/create/campaign
router.post('/campaign', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const body = ensureObject(req.body);
    const name = ensureNonEmptyString(body.name, 'name required');
    const objective = ensureEnum(body.objective, CAMPAIGN_OBJECTIVES, 'objective is invalid');
    const status = body.status === undefined ? undefined : ensureEnum(body.status, CAMPAIGN_STATUSES, 'status must be PAUSED or ACTIVE');
    const dailyBudget = optionalNumber(body.dailyBudget, 'dailyBudget must be numeric');
    const lifetimeBudget = optionalNumber(body.lifetimeBudget, 'lifetimeBudget must be numeric');
    const specialAdCategories = Array.isArray(body.specialAdCategories)
      ? body.specialAdCategories.map((value) => ensureEnum(value, SPECIAL_AD_CATEGORIES, 'specialAdCategories contains invalid value'))
      : [];
    const internalTags = Array.isArray(body.internalTags)
      ? body.internalTags.map((value) => ensureNonEmptyString(value, 'internalTags must contain strings'))
      : [];
    const buyingType = body.buyingType === undefined ? undefined : ensureEnum(body.buyingType, BUYING_TYPES, 'buyingType must be AUCTION or RESERVED');
    const startTime = optionalTrimmedString(body.startTime, 100);
    const stopTime = optionalTrimmedString(body.stopTime, 100);

    if (dailyBudget !== undefined && dailyBudget <= 0) throw badRequest('dailyBudget must be greater than 0');
    if (lifetimeBudget !== undefined && lifetimeBudget <= 0) throw badRequest('lifetimeBudget must be greater than 0');
    if (dailyBudget !== undefined && lifetimeBudget !== undefined) throw badRequest('Use dailyBudget or lifetimeBudget, not both');

    let parsedStartTime;
    let parsedStopTime;
    if (startTime) {
      parsedStartTime = new Date(startTime);
      if (Number.isNaN(parsedStartTime.getTime())) throw badRequest('startTime must be a valid date');
    }
    if (stopTime) {
      parsedStopTime = new Date(stopTime);
      if (Number.isNaN(parsedStopTime.getTime())) throw badRequest('stopTime must be a valid date');
    }
    if (parsedStartTime && parsedStopTime && parsedStopTime <= parsedStartTime) {
      throw badRequest('stopTime must be after startTime');
    }

    const payload = {
      name,
      objective,
      status: status || 'PAUSED',
      buying_type: buyingType || 'AUCTION',
      special_ad_categories: specialAdCategories || [],
    };

    // Budget at campaign level (CBO) — optional
    if (dailyBudget !== undefined) payload.daily_budget = Math.round(dailyBudget * 100);
    if (lifetimeBudget !== undefined) payload.lifetime_budget = Math.round(lifetimeBudget * 100);
    if (startTime) payload.start_time = parsedStartTime.toISOString();
    if (stopTime) payload.stop_time = parsedStopTime.toISOString();

    const result = await metaApi.metaPost(`/${metaApi.contextAccountId(req.metaAccount)}/campaigns`, payload, req.metaAccount);
    await logAction(req.metaAccount?.id || 1, 'campaign', result.id, name, 'create', {
      payload,
      internal_tags: internalTags,
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, campaign_id: result.id, result });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── CREATE AD SET ────────────────────────────────────────

// POST /api/create/adset
router.post('/adset', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const body = ensureObject(req.body);
    const name = ensureNonEmptyString(body.name, 'name required');
    const campaignId = ensureNonEmptyString(body.campaignId, 'campaignId required');
    const status = optionalTrimmedString(body.status, 50);
    const dailyBudget = optionalNumber(body.dailyBudget, 'dailyBudget must be numeric');
    const lifetimeBudget = optionalNumber(body.lifetimeBudget, 'lifetimeBudget must be numeric');
    const bidStrategy = optionalTrimmedString(body.bidStrategy, 100);
    const bidAmount = optionalNumber(body.bidAmount, 'bidAmount must be numeric');
    const optimizationGoal = optionalTrimmedString(body.optimizationGoal, 100);
    const billingEvent = optionalTrimmedString(body.billingEvent, 100);
    const pixelId = optionalTrimmedString(body.pixelId, 100);
    const customEventType = optionalTrimmedString(body.customEventType, 100);
    const ageMin = body.ageMin;
    const ageMax = body.ageMax;
    const genders = body.genders;
    const geoLocations = body.geoLocations;
    const excludedGeoLocations = body.excludedGeoLocations;
    const locales = body.locales;
    const interests = body.interests;
    const customAudiences = body.customAudiences;
    const excludedCustomAudiences = body.excludedCustomAudiences;
    const publisherPlatforms = body.publisherPlatforms;
    const facebookPositions = body.facebookPositions;
    const instagramPositions = body.instagramPositions;
    const devicePlatforms = body.devicePlatforms;
    const startTime = optionalTrimmedString(body.startTime, 100);
    const endTime = optionalTrimmedString(body.endTime, 100);

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

    const result = await metaApi.metaPost(`/${metaApi.contextAccountId(req.metaAccount)}/adsets`, payload, req.metaAccount);
    await logAction(req.body.accountId || 1, 'adset', result.id, name, 'create', {
      payload,
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, adset_id: result.id, result });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── CREATE AD ────────────────────────────────────────────

// POST /api/create/ad
router.post('/ad', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const body = ensureObject(req.body);
    const name = ensureNonEmptyString(body.name, 'name required');
    const adsetId = ensureNonEmptyString(body.adsetId, 'adsetId required');
    const status = optionalTrimmedString(body.status, 50);
    const pageId = optionalTrimmedString(body.pageId, 100);
    const imageHash = optionalTrimmedString(body.imageHash, 500);
    const imageUrl = optionalTrimmedString(body.imageUrl, 2000);
    const videoId = optionalTrimmedString(body.videoId, 100);
    const primaryText = optionalTrimmedString(body.primaryText, 5000);
    const headline = optionalTrimmedString(body.headline, 500);
    const description = optionalTrimmedString(body.description, 2000);
    const linkUrl = optionalTrimmedString(body.linkUrl, 2000);
    const cta = optionalTrimmedString(body.cta, 100);
    const creativeId = optionalTrimmedString(body.creativeId, 100);

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

      const creativeResult = await metaApi.metaPost(`/${metaApi.contextAccountId(req.metaAccount)}/adcreatives`, creativePayload, req.metaAccount);
      creative_id = creativeResult.id;
    }

    // Create the ad
    const adPayload = {
      name,
      adset_id: adsetId,
      status: status || 'PAUSED',
      creative: JSON.stringify({ creative_id }),
    };

    const result = await metaApi.metaPost(`/${metaApi.contextAccountId(req.metaAccount)}/ads`, adPayload, req.metaAccount);
    await logAction(req.body.accountId || 1, 'ad', result.id, name, 'create', {
      adset_id: adsetId,
      creative_id,
      status: status || 'PAUSED',
      performed_by: req.user?.email || req.user?.name || null,
    });
    res.json({ success: true, ad_id: result.id, creative_id, result });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── HELPER: Get pixels for this ad account ───────────────

router.get('/pixels', async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const data = await metaApi.metaGet(`/${metaApi.contextAccountId(req.metaAccount)}/adspixels`, {
      fields: 'id,name,is_unavailable',
    }, req.metaAccount);
    res.json({ data: data.data || [] });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── HELPER: Get pages for this account ───────────────────

router.get('/pages', async (req, res) => {
  try {
    const data = await metaApi.metaGet('/me/accounts', {
      fields: 'id,name,access_token',
      limit: '50',
    }, req.metaAccount);
    res.json({ data: data.data || [] });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── HELPER: Upload image for creative ────────────────────

router.post('/upload-image', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const imageUrl = ensureNonEmptyString(body.imageUrl, 'imageUrl required');

    const result = await metaApi.metaPost(`/${metaApi.contextAccountId(req.metaAccount)}/adimages`, {
      url: imageUrl,
    }, req.metaAccount);

    // Meta returns { images: { hash: { hash, url } } }
    const images = result.images || {};
    const firstKey = Object.keys(images)[0];
    const imageData = images[firstKey] || {};

    res.json({ success: true, hash: imageData.hash, url: imageData.url });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
