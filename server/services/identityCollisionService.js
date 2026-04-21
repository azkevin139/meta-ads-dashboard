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

  return groups.map((group) => ({
    ...group,
    identity_hash: group.identity_hash ? `${String(group.identity_hash).slice(0, 10)}...` : null,
    downstream_effect: downstreamEffect(group, group.latest_decision),
    members: membersByGroup.get(group.id) || [],
  }));
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
};
