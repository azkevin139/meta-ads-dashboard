const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.db.connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

// Helper: run a query and return rows
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return result;
}

// Helper: get a single row or null
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

// Helper: get all rows
async function queryAll(text, params) {
  const result = await query(text, params);
  return result.rows;
}

module.exports = { pool, query, queryOne, queryAll };
