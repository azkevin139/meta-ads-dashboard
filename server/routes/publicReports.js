const express = require('express');
const { sendError } = require('../errorResponse');
const reporting = require('../services/reportingService');
const reportLinks = require('../services/reportLinkService');
const reportLinkThrottle = require('../services/reportLinkThrottle');
const { optionalTrimmedString } = require('../validation');

const router = express.Router();

function setPublicReportHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

router.get('/:token/lead-summary', async (req, res) => {
  setPublicReportHeaders(res);
  if (reportLinkThrottle.isBlocked(req.ip)) {
    res.status(429).json({ error: 'Too many invalid report attempts. Try again later.' });
    return;
  }
  if (!reportLinks.isValidTokenFormat(req.params.token)) {
    reportLinkThrottle.noteFailure(req.ip);
    res.status(401).json({ error: 'Invalid report link' });
    return;
  }
  let link;
  try {
    link = await reportLinks.resolveToken(req.params.token);
  } catch (err) {
    reportLinkThrottle.noteFailure(req.ip);
    sendError(res, err);
    return;
  }
  try {
    const params = {
      preset: optionalTrimmedString(req.query.preset, 30),
      since: optionalTrimmedString(req.query.since, 20),
      until: optionalTrimmedString(req.query.until, 20),
    };
    reportLinks.enforcePresetRestriction(link, params);
    const data = await reporting.getLeadReport(link.account_id, params);
    await reportLinks.recordView(link, req, {
      preset: data.range?.preset || params.preset || null,
      since: data.range?.since || params.since || null,
      until: data.range?.until || params.until || null,
    }).catch((err) => console.warn('[reportLinks] view audit failed:', err.message));
    res.json({
      account: {
        id: link.account_id,
        name: link.account_label || link.account_name,
        meta_account_id: link.meta_account_id,
        currency: link.currency,
      },
      data,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:token/viewer-timezone', async (req, res) => {
  setPublicReportHeaders(res);
  if (reportLinkThrottle.isBlocked(req.ip)) {
    res.status(429).json({ error: 'Too many invalid report attempts. Try again later.' });
    return;
  }
  if (!reportLinks.isValidTokenFormat(req.params.token)) {
    reportLinkThrottle.noteFailure(req.ip);
    res.status(401).json({ error: 'Invalid report link' });
    return;
  }
  try {
    await reportLinks.resolveToken(req.params.token);
    const timezone = optionalTrimmedString(
      req.headers['x-vercel-ip-timezone']
      || req.headers['cf-timezone']
      || req.headers['x-timezone'],
      80,
    );
    res.json({
      timezone: timezone || null,
      source: timezone ? 'ip' : 'unavailable',
    });
  } catch (err) {
    reportLinkThrottle.noteFailure(req.ip);
    sendError(res, err);
  }
});

module.exports = router;
