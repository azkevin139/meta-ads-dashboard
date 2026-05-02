const reporting = require('./reportingService');
const canonicalLeads = require('./canonicalLeadService');
const creativeCoverage = require('./creativeCoverageService');

async function getTruthCheck(accountId, params = {}) {
  const range = reporting.resolveRange(params);
  const [report, canonical, coverage] = await Promise.all([
    reporting.getLeadReport(accountId, range),
    canonicalLeads.getCanonicalLeadHealth(accountId),
    creativeCoverage.getCoverage(accountId, range.since, range.until),
  ]);

  const summary = report.summary || {};
  return {
    account_id: Number(accountId),
    range,
    qualified_leads: Number(summary.qualified_leads) || 0,
    qualified_leads_stage: Number(summary.qualified_leads_stage) || 0,
    canonical_leads: canonical.canonical_leads,
    linked_visitors: canonical.linked_visitors,
    source_split: {
      meta: Number(summary.meta_leads) || 0,
      website: Number(summary.website_leads) || 0,
    },
    qualified_source_split: {
      meta: Number(summary.meta_qualified_leads) || 0,
      website: Number(summary.website_qualified_leads) || 0,
    },
    pipeline_counts: report.pipeline || [],
    creative_coverage_status: coverage.status,
    creative_coverage: coverage,
    canonical_health: canonical,
    caveats: [
      'qualified_leads is reply-qualified from visitors.qualified_at',
      'qualified_leads_stage is transitional stage-qualified comparison',
      'pipeline_counts are current pipeline states for leads acquired in the selected period',
      'source_split uses deduped lead acquisition source',
    ],
  };
}

module.exports = {
  getTruthCheck,
};
