const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db');

async function main() {
  const file = path.join(__dirname, '..', 'server', 'data', 'tracking-outages.json');
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ imported: 0, reason: 'missing_json' }));
    return;
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let imported = 0;
  for (const [accountId, row] of Object.entries(data)) {
    await pool.query(`
      INSERT INTO tracking_outage_windows (
        account_id, outage_start, outage_end, notes, status,
        last_backfill_at, last_backfill, updated_at
      ) VALUES ($1,$2,$3,$4,'active',$5,$6::jsonb,COALESCE($7::timestamptz,NOW()))
      ON CONFLICT (account_id) WHERE status = 'active' DO UPDATE SET
        outage_start = EXCLUDED.outage_start,
        outage_end = EXCLUDED.outage_end,
        notes = EXCLUDED.notes,
        last_backfill_at = EXCLUDED.last_backfill_at,
        last_backfill = EXCLUDED.last_backfill,
        updated_at = EXCLUDED.updated_at
    `, [
      parseInt(accountId, 10),
      row.outage_start,
      row.outage_end,
      row.notes || '',
      row.last_backfill_at || null,
      JSON.stringify(row.last_backfill || {}),
      row.updated_at || null,
    ]);
    imported += 1;
  }
  console.log(JSON.stringify({ imported }));
}

main()
  .catch((err) => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
