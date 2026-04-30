const express = require('express');
const { sendError } = require('../errorResponse');
const reporting = require('../services/reportingService');
const reportLinks = require('../services/reportLinkService');
const { optionalTrimmedString } = require('../validation');

const router = express.Router();

function setPublicReportHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

router.get('/:token/lead-summary', async (req, res) => {
  try {
    setPublicReportHeaders(res);
    const link = await reportLinks.resolveToken(req.params.token);
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
    setPublicReportHeaders(res);
    sendError(res, err);
  }
});

module.exports = router;
