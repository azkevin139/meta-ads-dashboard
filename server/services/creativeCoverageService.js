const { queryOne } = require('../db');

const REPORTING_TIMEZONE = 'Asia/Dubai';

function pct(numerator, denominator) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  if (!d) return n > 0 ? 100 : 0;
  return Number(((n / d) * 100).toFixed(2));
}

function statusFor(row) {
  const adLevelPct = pct(row.ad_level_ads, row.ads_total);
  const metadataPct = pct(row.ads_with_metadata, row.ad_level_ads);
  const leadPct = pct(row.attributed_leads, row.total_leads);
  const qualifiedPct = pct(row.attributed_qualified_leads, row.qualified_leads);

  if (Number(row.ad_level_ads) <= 0) return 'unavailable';
  if (Number(row.total_leads) > 0 && leadPct < 20) return 'partial';
  if (Number(row.qualified_leads) > 0 && qualifiedPct < 20) return 'partial';
  if (Number(row.ad_level_ads) > 0 && metadataPct < 60) return 'partial';
  if (adLevelPct < 20) return 'partial';
  return 'available';
}

function reasonFor(row, status) {
  if (status === 'available') return null;
  if (Number(row.ad_level_ads) <= 0) return 'ad_level_insights_missing';
  if (Number(row.total_leads) > 0 && pct(row.attributed_leads, row.total_leads) < 20) return 'lead_ad_attribution_coverage_low';
  if (Number(row.qualified_leads) > 0 && pct(row.attributed_qualified_leads, row.qualified_leads) < 20) return 'qualified_lead_ad_attribution_coverage_low';
  if (Number(row.ad_level_ads) > 0 && pct(row.ads_with_metadata, row.ad_level_ads) < 60) return 'ad_metadata_coverage_low';
  return 'ad_level_coverage_partial';
}

async function getCoverage(accountId, since, until, { timezone = REPORTING_TIMEZONE } = {}) {
  const row = await queryOne(`
    WITH ad_inventory AS (
      SELECT COUNT(*)::int AS ads_total
      FROM ads
      WHERE account_id = $1
    ),
    ad_level AS (
      SELECT
        COUNT(DISTINCT ads.meta_ad_id)::int AS ad_level_ads,
        COUNT(DISTINCT ads.meta_ad_id) FILTER (
          WHERE NULLIF(ads.name, '') IS NOT NULL
            OR NULLIF(ads.creative_meta->>'image_url', '') IS NOT NULL
            OR NULLIF(ads.creative_meta->>'thumbnail_url', '') IS NOT NULL
        )::int AS ads_with_metadata
      FROM daily_insights di
      JOIN ads ON ads.id = di.ad_id
      WHERE di.account_id = $1
        AND di.level = 'ad'
        AND di.date BETWEEN $2::date AND $3::date
    ),
    lead_rows AS (
      SELECT
        COALESCE(clink.canonical_lead_id::text, COALESCE(
          NULLIF(v.ghl_contact_id, ''),
          NULLIF(v.phone_hash, ''),
          NULLIF(v.email_hash, ''),
          NULLIF(v.meta_lead_id, ''),
          v.client_id
        )) AS dedupe_key,
        v.ad_id,
        v.qualified_at,
        COALESCE(
          NULLIF(v.raw->'ghl'->>'dateAdded', '')::timestamptz,
          NULLIF(v.raw->'ghl'->>'createdAt', '')::timestamptz,
          NULLIF(v.raw->'metadata'->>'created_time', '')::timestamptz,
          v.resolved_at,
          v.first_seen_at
        ) AS lead_time
      FROM visitors v
      LEFT JOIN canonical_lead_links clink
        ON clink.account_id = v.account_id
        AND clink.source_type = 'visitor'
        AND clink.source_id = v.client_id
      WHERE v.account_id = $1
        AND (
          v.meta_lead_id IS NOT NULL
          OR v.ghl_contact_id IS NOT NULL
          OR v.email_hash IS NOT NULL
          OR v.phone_hash IS NOT NULL
        )
    ),
    scoped AS (
      SELECT DISTINCT ON (dedupe_key) *
      FROM lead_rows
      WHERE (lead_time AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY dedupe_key, lead_time ASC
    )
    SELECT
      COALESCE((SELECT ads_total FROM ad_inventory), 0)::int AS ads_total,
      COALESCE((SELECT ad_level_ads FROM ad_level), 0)::int AS ad_level_ads,
      COALESCE((SELECT ads_with_metadata FROM ad_level), 0)::int AS ads_with_metadata,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE ad_id IS NOT NULL)::int AS attributed_leads,
      COUNT(*) FILTER (WHERE qualified_at IS NOT NULL)::int AS qualified_leads,
      COUNT(*) FILTER (WHERE qualified_at IS NOT NULL AND ad_id IS NOT NULL)::int AS attributed_qualified_leads
    FROM scoped
  `, [accountId, since, until, timezone]);

  const data = {
    ads_total: Number(row?.ads_total) || 0,
    ad_level_ads: Number(row?.ad_level_ads) || 0,
    ads_with_metadata: Number(row?.ads_with_metadata) || 0,
    total_leads: Number(row?.total_leads) || 0,
    attributed_leads: Number(row?.attributed_leads) || 0,
    qualified_leads: Number(row?.qualified_leads) || 0,
    attributed_qualified_leads: Number(row?.attributed_qualified_leads) || 0,
  };
  const status = statusFor(data);
  const reasonCode = reasonFor(data, status);

  return {
    status,
    ready: status === 'available' || status === 'partial',
    reason_code: reasonCode,
    ad_level_insights_pct: pct(data.ad_level_ads, data.ads_total),
    ads_metadata_pct: pct(data.ads_with_metadata, data.ad_level_ads),
    lead_ad_attribution_pct: pct(data.attributed_leads, data.total_leads),
    qualified_lead_ad_attribution_pct: pct(data.attributed_qualified_leads, data.qualified_leads),
    missing_counts: {
      missing_ad_id: Math.max(0, data.total_leads - data.attributed_leads),
      missing_qualified_ad_id: Math.max(0, data.qualified_leads - data.attributed_qualified_leads),
      missing_ad_metadata: Math.max(0, data.ad_level_ads - data.ads_with_metadata),
    },
    ...data,
  };
}

module.exports = {
  getCoverage,
};
