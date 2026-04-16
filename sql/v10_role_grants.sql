-- ============================================================
-- V10 Migration: Ensure app role grants for post-v4 objects
-- Run: sudo -u postgres psql -d meta_dashboard -f v10_role_grants.sql
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON audience_pushes TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE audience_pushes_id_seq TO meta_dash;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meta_dash;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO meta_dash;

SELECT 'V10 role grants migration complete' AS status;
