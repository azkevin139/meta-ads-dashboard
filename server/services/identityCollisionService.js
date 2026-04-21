const { query, queryAll, queryOne } = require('../db');

const DECISION_TO_STATUS = {
  confirmed_same_person: 'resolved',
  keep_separate: 'resolved',
  ignore: 'ignored',
  reopen: 'open',
};

function confidenceForMember(row) {
  const clientId = String(row.client_id || '');
  if (row.ghl_contact_id && !clientId.startsWith('ghl_') && !clientId.startsWith('meta_lead_') && !clientId.startsWith('lead_')) {
    return 'high';
  }
  if (row.ghl_contact_id || row.email_hash || row.phone_hash) return 'medium';
  return 'low';
}

function downstreamEffect(group, latestDecision) {
  if (group.status === 'resolved' && latestDecision === 'confirmed_same_person') {
    return 'allowed_after_operator_review';
  }
  if (group.status === 'resolved' && latestDecision === 'keep_separate') {
    return 'kept_separate_block_automatic_merge';
  }
  if (group.status === 'ignored') {
    return 'hidden_from_review_still_blocked';
  }
  return 'excluded_from_audience_push_and_revisit_automation';
}

function ageDays(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function priorityForGroup(group, members = []) {
  if (group.status !== 'open') {
    return { level: 'normal', score: 0, reasons: ['not_open'] };
  }
  const reasons = [];
  let score = 20;
  const age = ageDays(group.created_at);
  const memberCount = parseInt(group.member_count, 10) || members.length || 0;
  const hasKnownContact = members.some((member) => member.ghl_contact_id);
  const hasHighConfidenceMember = members.some((member) => member.confidence === 'high');
  const hasMultipleKnownContacts = new Set(members.map((member) => member.ghl_contact_id).filter(Boolean)).size > 1;

  if (memberCount >= 3) {
    score += 25;
    reasons.push('three_or_more_members');
  }
  if (hasKnownContact) {
    score += 20;
    reasons.push('affects_known_contacts');
  }
  if (hasHighConfidenceMember) {
    score += 15;
    reasons.push('includes_same_browser_known_contact');
  }
  if (hasMultipleKnownContacts) {
    score += 20;
    reasons.push('multiple_ghl_contacts');
  }
  if (age >= 7) {
    score += 15;
    reasons.push('backlog_older_than_7d');
  } else if (age >= 3) {
    score += 8;
    reasons.push('backlog_older_than_3d');
  }

  const level = score >= 70 ? 'urgent' : score >= 45 ? 'important' : 'normal';
  return { level, score, reasons: reasons.length ? reasons : ['collision_blocks_sensitive_actions'] };
}

function evidenceForGroup(group, members = []) {
  const uniqueClients = new Set(members.map((member) => member.client_id).filter(Boolean)).size;
  const uniqueContacts = new Set(members.map((member) => member.ghl_contact_id).filter(Boolean)).size;
  const sources = Array.from(new Set(members.map((member) => member.metadata?.source || member.source || 'visitors')));
  return {
    why_collided: `${group.identity_type} maps to ${uniqueClients} browser/client id(s) and ${uniqueContacts} GHL contact id(s).`,
    sources,
    restrictions: [
      'excluded_from_audience_push',
      'blocked_from_revisit_automation',
      'treated_as_low_confidence_identity',
    ],
    confirm_same_person_effect: 'Clears collision blocking for this hash and allows downstream trust policy to treat it as operator-reviewed.',
    keep_separate_effect: 'Keeps automatic merge/use blocked and documents that these identities should remain separate.',
    ignore_effect: 'Hides from active review but keeps safety restrictions in place.',
  };
}

async function findCurrentCollisionCandidates(accountId) {
  return queryAll(`
    WITH identity_rows AS (
      SELECT 'email_hash' AS identity_type, email_hash AS identity_hash, client_id, ghl_contact_id, last_seen_at, raw
      FROM visitors
      WHERE account_id = $1 AND email_hash IS NOT NULL
      UNION ALL
      SELECT 'phone_hash' AS identity_type, phone_hash AS identity_hash, client_id, ghl_contact_id, last_seen_at, raw
      FROM visitors
      WHERE account_id = $1 AND phone_hash IS NOT NULL
    ),
    collision_keys AS (
      SELECT identity_type, identity_hash
      FROM identity_rows
      GROUP BY identity_type, identity_hash
      HAVING COUNT(DISTINCT client_id) > 1 OR COUNT(DISTINCT ghl_contact_id) > 1
    )
    SELECT r.*
    FROM identity_rows r
    JOIN collision_keys k
      ON k.identity_type = r.identity_type
     AND k.identity_hash = r.identity_hash
    ORDER BY r.identity_type, r.identity_hash, r.last_seen_at DESC NULLS LAST
  `, [accountId]);
}

async function upsertGroup(accountId, identityType, identityHash, members) {
  const collisionKey = `${identityType}:${identityHash}`;
  const memberCount = members.length;
  const lastSeen = members.reduce((latest, row) => {
    const t = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    return t > latest ? t : latest;
  }, 0);
  const group = await queryOne(`
    INSERT INTO identity_collision_groups (
      account_id, collision_key, identity_type, identity_hash, confidence_bucket, member_count, last_seen_at, updated_at
    ) VALUES ($1,$2,$3,$4,'low',$5,$6,NOW())
    ON CONFLICT (account_id, collision_key) DO UPDATE SET
      member_count = EXCLUDED.member_count,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW()
    RETURNING *
  `, [accountId, collisionKey, identityType, identityHash, memberCount, lastSeen ? new Date(lastSeen).toISOString() : null]);

  await query('DELETE FROM identity_collision_members WHERE collision_group_id = $1', [group.id]);
  for (const member of members) {
    await query(`
      INSERT INTO identity_collision_members (
        collision_group_id, client_id, ghl_contact_id, source, identity_type, identity_hash, confidence, metadata_json
      ) VALUES ($1,$2,$3,'visitors',$4,$5,$6,$7)
      ON CONFLICT DO NOTHING
    `, [
      group.id,
      member.client_id || null,
      member.ghl_contact_id || null,
      identityType,
      identityHash,
      confidenceForMember(member),
      JSON.stringify({
        last_seen_at: member.last_seen_at || null,
        source: member.raw?.ghl ? 'ghl' : member.raw?.meta_lead ? 'meta' : 'native_or_imported',
      }),
    ]);
  }
  return group;
}

async function syncCollisionGroups(accountId) {
  const rows = await findCurrentCollisionCandidates(accountId);
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.identity_type}:${row.identity_hash}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const groups = [];
  for (const members of byKey.values()) {
    groups.push(await upsertGroup(accountId, members[0].identity_type, members[0].identity_hash, members));
  }
  return groups;
}

async function listCollisionGroups(accountId, { status = 'open', limit = 50 } = {}) {
  await syncCollisionGroups(accountId);
  const values = [accountId];
  const filters = ['g.account_id = $1'];
  if (status && status !== 'all') {
    values.push(status);
    filters.push(`g.status = $${values.length}`);
  }
  values.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));

  const groups = await queryAll(`
    WITH latest_resolution AS (
      SELECT DISTINCT ON (collision_group_id)
        collision_group_id, decision, rationale, created_at
      FROM identity_collision_resolutions
      ORDER BY collision_group_id, created_at DESC
    )
    SELECT
      g.*,
      lr.decision AS latest_decision,
      lr.rationale AS latest_rationale,
      lr.created_at AS latest_decision_at
    FROM identity_collision_groups g
    LEFT JOIN latest_resolution lr ON lr.collision_group_id = g.id
    WHERE ${filters.join(' AND ')}
    ORDER BY
      CASE g.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      g.member_count DESC,
      g.updated_at DESC
    LIMIT $${values.length}
  `, values);

  if (!groups.length) return [];
  const members = await queryAll(`
    SELECT *
    FROM identity_collision_members
    WHERE collision_group_id = ANY($1::bigint[])
    ORDER BY confidence DESC, created_at DESC
  `, [groups.map((group) => group.id)]);
  const membersByGroup = new Map();
  for (const member of members) {
    if (!membersByGroup.has(member.collision_group_id)) membersByGroup.set(member.collision_group_id, []);
    membersByGroup.get(member.collision_group_id).push({
      id: member.id,
      client_id: member.client_id,
      ghl_contact_id: member.ghl_contact_id,
      source: member.source,
      identity_type: member.identity_type,
      identity_hash: member.identity_hash ? `${String(member.identity_hash).slice(0, 10)}...` : null,
      confidence: member.confidence,
      metadata: member.metadata_json || {},
    });
  }

  return groups.map((group) => {
    const groupMembers = membersByGroup.get(group.id) || [];
    return {
      ...group,
      identity_hash: group.identity_hash ? `${String(group.identity_hash).slice(0, 10)}...` : null,
      downstream_effect: downstreamEffect(group, group.latest_decision),
      priority: priorityForGroup(group, groupMembers),
      evidence: evidenceForGroup(group, groupMembers),
      members: groupMembers,
    };
  });
}

async function getIntegrityMetrics(accountId) {
  await syncCollisionGroups(accountId);
  const allOpen = await listCollisionGroups(accountId, { status: 'open', limit: 200 });
  const urgentOpen = allOpen.filter((group) => group.priority?.level === 'urgent');
  const rows = await queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'open')::int AS open_groups,
      COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_groups,
      COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored_groups,
      EXTRACT(day FROM NOW() - MIN(created_at) FILTER (WHERE status = 'open'))::int AS oldest_open_age_days,
      COALESCE(SUM(member_count) FILTER (WHERE status = 'open'), 0)::int AS rows_excluded_from_sensitive_actions
    FROM identity_collision_groups
    WHERE account_id = $1
  `, [accountId]);
  const recent = await queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE r.decision IN ('confirmed_same_person', 'keep_separate') AND r.created_at >= NOW() - INTERVAL '7 days')::int AS resolved_last_7d,
      COUNT(*) FILTER (WHERE r.decision = 'ignore' AND r.created_at >= NOW() - INTERVAL '7 days')::int AS ignored_last_7d,
      COUNT(*) FILTER (WHERE r.decision = 'reopen' AND r.created_at >= NOW() - INTERVAL '7 days')::int AS reopened_last_7d
    FROM identity_collision_resolutions r
    JOIN identity_collision_groups g ON g.id = r.collision_group_id
    WHERE g.account_id = $1
  `, [accountId]);
  const operatorQuality = await queryAll(`
    SELECT
      COALESCE(u.email, 'unknown') AS operator,
      COUNT(*)::int AS decisions,
      COUNT(*) FILTER (WHERE r.decision = 'confirmed_same_person')::int AS confirmed_same,
      COUNT(*) FILTER (WHERE r.decision = 'ignore')::int AS ignored,
      COUNT(*) FILTER (WHERE r.decision = 'reopen')::int AS reopened
    FROM identity_collision_resolutions r
    JOIN identity_collision_groups g ON g.id = r.collision_group_id
    LEFT JOIN users u ON u.id = r.decided_by_user_id
    WHERE g.account_id = $1
      AND r.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY u.email
    ORDER BY decisions DESC, operator
    LIMIT 10
  `, [accountId]);

  const launchReady = urgentOpen.length === 0 && (parseInt(rows.oldest_open_age_days, 10) || 0) < 14;
  return {
    open_groups: parseInt(rows.open_groups, 10) || 0,
    urgent_open_groups: urgentOpen.length,
    important_open_groups: allOpen.filter((group) => group.priority?.level === 'important').length,
    oldest_open_age_days: parseInt(rows.oldest_open_age_days, 10) || 0,
    resolved_last_7d: parseInt(recent?.resolved_last_7d, 10) || 0,
    ignored_last_7d: parseInt(recent?.ignored_last_7d, 10) || 0,
    reopened_last_7d: parseInt(recent?.reopened_last_7d, 10) || 0,
    rows_excluded_from_sensitive_actions: parseInt(rows.rows_excluded_from_sensitive_actions, 10) || 0,
    launch_readiness: {
      ready: launchReady,
      status: launchReady ? 'ready' : 'blocked',
      reasons: launchReady ? [] : [
        urgentOpen.length ? 'urgent_unresolved_collisions' : null,
        (parseInt(rows.oldest_open_age_days, 10) || 0) >= 14 ? 'collision_backlog_too_old' : null,
      ].filter(Boolean),
      thresholds: {
        urgent_open_groups: 0,
        oldest_open_age_days_lt: 14,
      },
    },
    operator_quality: operatorQuality,
  };
}

async function resolveCollisionGroup(accountId, groupId, { decision, rationale, userId } = {}) {
  if (!DECISION_TO_STATUS[decision]) throw new Error('Invalid collision resolution decision');
  const cleanRationale = String(rationale || '').trim();
  if (['confirmed_same_person', 'keep_separate'].includes(decision) && cleanRationale.length < 5) {
    throw new Error('Rationale is required for this decision');
  }

  const group = await queryOne('SELECT * FROM identity_collision_groups WHERE id = $1 AND account_id = $2', [groupId, accountId]);
  if (!group) throw new Error('Collision group not found');
  const nextStatus = DECISION_TO_STATUS[decision];

  const resolution = await queryOne(`
    INSERT INTO identity_collision_resolutions (
      collision_group_id, decision, previous_status, next_status, decided_by_user_id, rationale
    ) VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [group.id, decision, group.status, nextStatus, userId || null, cleanRationale || null]);

  const updated = await queryOne(`
    UPDATE identity_collision_groups
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [group.id, nextStatus]);

  return { group: updated, resolution };
}

async function getResolvedHashSets(accountId) {
  const rows = await queryAll(`
    SELECT g.identity_type, g.identity_hash, lr.decision
    FROM identity_collision_groups g
    JOIN LATERAL (
      SELECT decision
      FROM identity_collision_resolutions r
      WHERE r.collision_group_id = g.id
      ORDER BY r.created_at DESC
      LIMIT 1
    ) lr ON TRUE
    WHERE g.account_id = $1
      AND g.status = 'resolved'
      AND lr.decision = 'confirmed_same_person'
  `, [accountId]);

  return {
    email: new Set(rows.filter((row) => row.identity_type === 'email_hash').map((row) => row.identity_hash)),
    phone: new Set(rows.filter((row) => row.identity_type === 'phone_hash').map((row) => row.identity_hash)),
  };
}

module.exports = {
  listCollisionGroups,
  resolveCollisionGroup,
  syncCollisionGroups,
  getResolvedHashSets,
  getIntegrityMetrics,
};
