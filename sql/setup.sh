#!/bin/bash
# ============================================================
# Meta Ads Dashboard — DB Setup
# Run this on emma42 where Postgres is installed
# ============================================================

set -e

DB_NAME="meta_dashboard"
DB_USER="${PGUSER:-postgres}"

echo "=== Meta Ads Dashboard — Database Setup ==="
echo ""

# 1. Create database (skip if exists)
echo "[1/3] Creating database '$DB_NAME'..."
psql -U "$DB_USER" -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME"
echo "  ✓ Database ready"

# 2. Run schema + migrations
echo "[2/3] Running schema.sql..."
psql -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/schema.sql"
for migration in \
  v2_users.sql \
  v3_multi_accounts.sql \
  v4_tracking_attribution.sql \
  v5_meta_lead_sync.sql \
  v6_token_health.sql \
  v7_ghl_integration.sql \
  v8_audience_push.sql \
  v9_attribution_fields.sql \
  v10_role_grants.sql \
  v11_touch_sequences.sql \
  v12_ghl_sync_state.sql \
  v13_normalized_stage.sql \
  v14_meta_lead_sync_state.sql \
  v19_data_truth_layer.sql
do
  if [ -f "$(dirname "$0")/$migration" ]; then
    echo "    • $migration"
    psql -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/$migration"
  fi
done
echo "  ✓ Schema created"

# 3. Run seed
echo "[3/3] Running seed.sql..."
psql -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/seed.sql"
echo "  ✓ Seed data loaded"

echo ""
echo "=== Done! ==="
echo "Connect with: psql -U $DB_USER -d $DB_NAME"
echo ""
echo "Quick checks:"
echo "  psql -U $DB_USER -d $DB_NAME -c 'SELECT * FROM v_pending_recommendations;'"
echo "  psql -U $DB_USER -d $DB_NAME -c 'SELECT date, spend, conversions, cost_per_result FROM daily_insights WHERE level = '\\''account'\\'' ORDER BY date DESC LIMIT 7;'"
