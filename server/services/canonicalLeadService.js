const { queryAll, queryOne } = require('../db');

const CONFIDENCE_RANK = {
  low: 1,
  medium: 2,
  high: 3,
};

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function confidenceFor(visitor = {}) {
  if (visitor.ghl_contact_id) return 'high';
  if (visitor.phone_hash || visitor.email_hash || visitor.meta_lead_id) return 'medium';
  return 'low';
}

function betterConfidence(a, b) {
  return (CONFIDENCE_RANK[a] || 0) >= (CONFIDENCE_RANK[b] || 0) ? a : b;
}

function leadSeenAt(visitor = {}) {
  return visitor.resolved_at || visitor.first_seen_at || visitor.last_seen_at || new Date().toISOString();
}

async function findExistingCanonicalLead(accountId, visitor = {}) {
  const lookups = [
    ['ghl_contact', visitor.ghl_contact_id, 'primary_ghl_contact_id'],
    ['phone_hash', visitor.phone_hash, 'primary_phone_hash'],
    ['email_hash', visitor.email_hash, 'primary_email_hash'],
    ['meta_lead_id', visitor.meta_lead_id, 'primary_meta_lead_id'],
  ];

  for (const [matchMethod, value, column] of lookups) {
    const cleanValue = clean(value);
    if (!cleanValue) continue;
    const row = await queryOne(
      `SELECT * FROM canonical_leads WHERE account_id = $1 AND ${column} = $2 LIMIT 1`,
      [accountId, cleanValue]
    );
    if (row) return { row, matchMethod };
  }

  return { row: null, matchMethod: 'visitor_fallback' };
}

async function createCanonicalLead(accountId, visitor = {}) {
  const seenAt = leadSeenAt(visitor);
  return queryOne(
    `
    INSERT INTO canonical_leads (
      account_id,
      primary_ghl_contact_id,
      primary_phone_hash,
      primary_email_hash,
      primary_meta_lead_id,
      first_seen_at,
      last_seen_at,
      identity_confidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)
    RETURNING *
    `,
    [
      accountId,
      clean(visitor.ghl_contact_id),
      clean(visitor.phone_hash),
      clean(visitor.email_hash),
      clean(visitor.meta_lead_id),
      seenAt,
      confidenceFor(visitor),
    ]
  );
}

async function updateCanonicalLead(existing, visitor = {}) {
  const confidence = betterConfidence(existing.identity_confidence, confidenceFor(visitor));
  const seenAt = leadSeenAt(visitor);
  return queryOne(
    `
    UPDATE canonical_leads
    SET
      primary_ghl_contact_id = COALESCE(primary_ghl_contact_id, CASE
        WHEN $2::text IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_leads other
          WHERE other.account_id = canonical_leads.account_id
            AND other.primary_ghl_contact_id = $2
            AND other.id <> canonical_leads.id
        ) THEN $2::text
        ELSE NULL
      END),
      primary_phone_hash = COALESCE(primary_phone_hash, CASE
        WHEN $3::text IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_leads other
          WHERE other.account_id = canonical_leads.account_id
            AND other.primary_phone_hash = $3
            AND other.id <> canonical_leads.id
        ) THEN $3::text
        ELSE NULL
      END),
      primary_email_hash = COALESCE(primary_email_hash, CASE
        WHEN $4::text IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_leads other
          WHERE other.account_id = canonical_leads.account_id
            AND other.primary_email_hash = $4
            AND other.id <> canonical_leads.id
        ) THEN $4::text
        ELSE NULL
      END),
      primary_meta_lead_id = COALESCE(primary_meta_lead_id, CASE
        WHEN $5::text IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_leads other
          WHERE other.account_id = canonical_leads.account_id
            AND other.primary_meta_lead_id = $5
            AND other.id <> canonical_leads.id
        ) THEN $5::text
        ELSE NULL
      END),
      first_seen_at = LEAST(COALESCE(first_seen_at, $6::timestamptz), $6::timestamptz),
      last_seen_at = GREATEST(COALESCE(last_seen_at, $6::timestamptz), $6::timestamptz),
      identity_confidence = $7,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [
      existing.id,
      clean(visitor.ghl_contact_id),
      clean(visitor.phone_hash),
      clean(visitor.email_hash),
      clean(visitor.meta_lead_id),
      seenAt,
      confidence,
    ]
  );
}

async function linkSourceToCanonicalLead(canonicalLeadId, accountId, sourceType, sourceId, matchMethod) {
  const source = clean(sourceId);
  if (!canonicalLeadId || !accountId || !sourceType || !source) return null;
  return queryOne(
    `
    INSERT INTO canonical_lead_links (
      canonical_lead_id, account_id, source_type, source_id, match_method
    ) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (account_id, source_type, source_id) DO UPDATE SET
      canonical_lead_id = EXCLUDED.canonical_lead_id,
      match_method = EXCLUDED.match_method
    RETURNING *
    `,
    [canonicalLeadId, accountId, sourceType, source, matchMethod]
  );
}

async function linkVisitorSources(canonicalLead, accountId, visitor = {}, matchMethod) {
  await linkSourceToCanonicalLead(canonicalLead.id, accountId, 'visitor', visitor.client_id, matchMethod);
  await linkSourceToCanonicalLead(canonicalLead.id, accountId, 'ghl_contact', visitor.ghl_contact_id, 'ghl_contact');
  await linkSourceToCanonicalLead(canonicalLead.id, accountId, 'meta_lead', visitor.meta_lead_id, 'meta_lead_id');
  return canonicalLead;
}

async function resolveCanonicalLeadForVisitor(visitor = {}) {
  const accountId = Number(visitor.account_id);
  if (!accountId) throw new Error('account_id required');
  if (!clean(visitor.client_id)) throw new Error('visitor.client_id required');

  const existing = await findExistingCanonicalLead(accountId, visitor);
  const canonicalLead = existing.row
    ? await updateCanonicalLead(existing.row, visitor)
    : await createCanonicalLead(accountId, visitor);

  return linkVisitorSources(canonicalLead, accountId, visitor, existing.matchMethod);
}

async function backfillCanonicalLeadsForAccount(accountId, { limit = null } = {}) {
  const params = [accountId];
  const limitSql = limit ? 'LIMIT $2' : '';
  if (limit) params.push(Number(limit));

  const visitors = await queryAll(
    `
    SELECT *
    FROM visitors
    WHERE account_id = $1
      AND (
        ghl_contact_id IS NOT NULL
        OR phone_hash IS NOT NULL
        OR email_hash IS NOT NULL
        OR meta_lead_id IS NOT NULL
      )
    ORDER BY COALESCE(resolved_at, first_seen_at, last_seen_at) ASC NULLS LAST
    ${limitSql}
    `,
    params
  );

  const summary = {
    account_id: Number(accountId),
    scanned_visitors: visitors.length,
    canonical_leads_resolved: 0,
    errors: [],
  };

  for (const visitor of visitors) {
    try {
      await resolveCanonicalLeadForVisitor(visitor);
      summary.canonical_leads_resolved += 1;
    } catch (err) {
      summary.errors.push({ client_id: visitor.client_id || null, error: err.message });
    }
  }

  return summary;
}

async function getCanonicalLeadHealth(accountId) {
  const row = await queryOne(
    `
    WITH visitor_leads AS (
      SELECT COUNT(*)::int AS visitor_identity_rows
      FROM visitors
      WHERE account_id = $1
        AND (
          ghl_contact_id IS NOT NULL
          OR phone_hash IS NOT NULL
          OR email_hash IS NOT NULL
          OR meta_lead_id IS NOT NULL
        )
    )
    SELECT
      (SELECT visitor_identity_rows FROM visitor_leads)::int AS visitor_identity_rows,
      COUNT(DISTINCT cl.id)::int AS canonical_leads,
      COUNT(DISTINCT l.source_id) FILTER (WHERE l.source_type = 'visitor')::int AS linked_visitors,
      COUNT(DISTINCT cl.id) FILTER (WHERE cl.primary_ghl_contact_id IS NOT NULL)::int AS with_ghl_contact,
      COUNT(DISTINCT cl.id) FILTER (WHERE cl.primary_phone_hash IS NOT NULL)::int AS with_phone_hash,
      COUNT(DISTINCT cl.id) FILTER (WHERE cl.primary_email_hash IS NOT NULL)::int AS with_email_hash,
      COUNT(DISTINCT cl.id) FILTER (WHERE cl.primary_meta_lead_id IS NOT NULL)::int AS with_meta_lead
    FROM canonical_leads cl
    LEFT JOIN canonical_lead_links l ON l.canonical_lead_id = cl.id
    WHERE cl.account_id = $1
    `,
    [accountId]
  );

  return {
    account_id: Number(accountId),
    visitor_identity_rows: Number(row?.visitor_identity_rows) || 0,
    canonical_leads: Number(row?.canonical_leads) || 0,
    linked_visitors: Number(row?.linked_visitors) || 0,
    with_ghl_contact: Number(row?.with_ghl_contact) || 0,
    with_phone_hash: Number(row?.with_phone_hash) || 0,
    with_email_hash: Number(row?.with_email_hash) || 0,
    with_meta_lead: Number(row?.with_meta_lead) || 0,
  };
}

module.exports = {
  resolveCanonicalLeadForVisitor,
  linkSourceToCanonicalLead,
  backfillCanonicalLeadsForAccount,
  getCanonicalLeadHealth,
};
