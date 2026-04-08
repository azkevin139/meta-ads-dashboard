const config = require('../config');
const metaApi = require('./metaApi');
const { logAction } = require('./actionService');

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPreviewFromCreative(creative = {}) {
  const storySpec = creative.object_story_spec || {};
  const linkData = storySpec.link_data || {};
  const videoData = storySpec.video_data || {};
  return {
    creative_id: creative.id || null,
    page_id: storySpec.page_id || null,
    instagram_actor_id: storySpec.instagram_actor_id || null,
    headline: linkData.name || videoData.title || creative.title || '',
    primary_text: linkData.message || videoData.message || creative.body || '',
    description: linkData.description || videoData.link_description || '',
    cta: linkData.call_to_action?.type || videoData.call_to_action?.type || creative.call_to_action_type || '',
    link_url: linkData.link || videoData.call_to_action?.value?.link || creative.link_url || '',
    display_link: linkData.caption || '',
    image_url: linkData.picture || videoData.image_url || creative.image_url || creative.thumbnail_url || '',
    video_id: videoData.video_id || creative.video_id || null,
    thumbnail_url: creative.thumbnail_url || linkData.picture || videoData.image_url || '',
    image_hash: linkData.image_hash || creative.image_hash || null,
    story_spec: storySpec,
  };
}

function normalizeAd(ad = {}) {
  const creative = ad.creative || {};
  const preview = buildPreviewFromCreative(creative);
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effective_status: ad.effective_status,
    configured_status: ad.configured_status || null,
    review_feedback: ad.ad_review_feedback || ad.review_feedback || null,
    creative_id: creative.id || null,
    creative_name: creative.name || null,
    preview,
    creative,
    source_ad: ad,
  };
}

async function getAdStudio(adId) {
  const ad = await metaApi.metaGet(`/${adId}`, {
    fields: [
      'id','name','status','effective_status','configured_status','ad_review_feedback',
      'creative{id,name,title,body,call_to_action_type,link_url,image_url,image_hash,thumbnail_url,object_story_spec,asset_feed_spec,video_id}'
    ].join(','),
  });
  const normalized = normalizeAd(ad);
  const previewData = await metaApi.metaGet(`/${adId}/previews`, { ad_format: 'DESKTOP_FEED_STANDARD' }).catch(() => ({ data: [] }));
  normalized.preview.rendered_html = safeArray(previewData.data)[0]?.body || null;
  return normalized;
}

async function getAdCreatives(limit = 25) {
  const data = await metaApi.metaGet(`/${config.meta.adAccountId}/adcreatives`, {
    fields: 'id,name,title,body,call_to_action_type,image_url,image_hash,thumbnail_url,link_url,object_story_spec,video_id',
    limit: String(limit),
  });
  return safeArray(data.data).map(c => ({
    id: c.id,
    name: c.name || c.title || c.id,
    preview: buildPreviewFromCreative(c),
  }));
}

async function getPageIdentities() {
  const pages = await metaApi.metaGet('/me/accounts', {
    fields: 'id,name,instagram_business_account{id,username}',
    limit: '50',
  });
  return safeArray(pages.data).map(p => ({
    id: p.id,
    name: p.name,
    instagram_business_account: p.instagram_business_account || null,
  }));
}

function validatePayload(payload = {}) {
  const errors = [];
  if (!payload.adId) errors.push('adId required');
  if (payload.mode !== 'existing_creative') {
    if (!payload.pageId) errors.push('pageId required');
    if (!payload.linkUrl) errors.push('destination URL required');
    if (!payload.headline && !payload.primaryText) errors.push('headline or primary text required');
  }
  if (payload.mode === 'existing_creative' && !payload.selectedCreativeId) errors.push('selectedCreativeId required');
  return {
    valid: errors.length === 0,
    errors,
    warning_reenter_review: true,
    warning_status_reset: payload.status && payload.status !== 'ACTIVE' ? null : 'Editing creatives may send the ad back into review.',
  };
}

async function uploadImageFromUrl(imageUrl) {
  const result = await metaApi.metaPost(`/${config.meta.adAccountId}/adimages`, { url: imageUrl });
  const images = result.images || {};
  const firstKey = Object.keys(images)[0];
  const imageData = images[firstKey] || {};
  return { hash: imageData.hash || null, url: imageData.url || imageUrl };
}

function buildCreativeSpec(input, uploadedImage) {
  const pageId = input.pageId;
  const instagramActorId = input.instagramActorId || undefined;
  const linkUrl = input.linkUrl;
  const cta = input.cta || 'LEARN_MORE';

  if (input.videoId) {
    const videoData = {
      video_id: input.videoId,
      title: input.headline || '',
      message: input.primaryText || '',
      link_description: input.description || '',
      call_to_action: { type: cta, value: { link: linkUrl } },
    };
    if (uploadedImage?.url) videoData.image_url = uploadedImage.url;
    return {
      object_story_spec: JSON.stringify({
        page_id: pageId,
        instagram_actor_id: instagramActorId,
        video_data: videoData,
      }),
    };
  }

  const linkData = {
    link: linkUrl,
    message: input.primaryText || '',
    name: input.headline || '',
    description: input.description || '',
    caption: input.displayLink || '',
    call_to_action: { type: cta, value: { link: linkUrl } },
  };
  if (input.imageHash || uploadedImage?.hash) linkData.image_hash = input.imageHash || uploadedImage.hash;
  else if (input.imageUrl || uploadedImage?.url) linkData.picture = input.imageUrl || uploadedImage.url;

  return {
    object_story_spec: JSON.stringify({
      page_id: pageId,
      instagram_actor_id: instagramActorId,
      link_data: linkData,
    }),
  };
}

async function updateAdStudio(input, performedBy = null) {
  const validation = validatePayload(input);
  if (!validation.valid) {
    const err = new Error(validation.errors.join(', '));
    err.validation = validation;
    throw err;
  }

  const before = await getAdStudio(input.adId);
  let newCreativeId = input.selectedCreativeId || null;
  let uploadedImage = null;

  if (input.mode !== 'existing_creative') {
    if (input.imageUrl && !input.imageHash) {
      uploadedImage = await uploadImageFromUrl(input.imageUrl);
    }
    const creativePayload = buildCreativeSpec(input, uploadedImage);
    const creativeResult = await metaApi.metaPost(`/${config.meta.adAccountId}/adcreatives`, creativePayload);
    newCreativeId = creativeResult.id;
  }

  await metaApi.metaPost(`/${input.adId}`, {
    name: input.name || before.name,
    status: input.status || before.status,
    creative: JSON.stringify({ creative_id: newCreativeId }),
  });

  const after = await getAdStudio(input.adId);
  await logAction(input.accountId || 1, 'ad', input.adId, after.name || before.name || input.adId, 'ad_studio_update', {
    previous_creative_id: before.creative_id,
    new_creative_id: newCreativeId,
    mode: input.mode || 'clone_transform',
    version_note: input.versionNote || null,
    before_preview: before.preview,
    after_preview: after.preview,
    validation,
    performed_by: performedBy,
  });

  return { success: true, before, after, new_creative_id: newCreativeId, uploaded_image: uploadedImage, validation };
}

module.exports = {
  getAdStudio,
  getAdCreatives,
  getPageIdentities,
  validatePayload,
  updateAdStudio,
  uploadImageFromUrl,
};
