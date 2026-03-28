const crypto = require('crypto');
const { query, queryOne, queryAll } = require('../db');
const config = require('../config');

// ─── PASSWORD HASHING (PBKDF2 with 100k iterations) ──────

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

// ─── JWT ──────────────────────────────────────────────────

function createToken(payload, expiresInHours = 24) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + (expiresInHours * 3600),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSecret)
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', config.authSecret)
      .update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ─── SESSION TOKEN HASHING ────────────────────────────────

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── USER OPERATIONS ──────────────────────────────────────

async function register(email, password, name, role = 'viewer') {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing) throw new Error('Email already registered');

  const passwordHash = hashPassword(password);
  const user = await queryOne(
    'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at',
    [email.toLowerCase(), passwordHash, name, role]
  );
  return user;
}

async function login(email, password, ip, userAgent) {
  const user = await queryOne('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!user) throw new Error('Invalid email or password');
  if (!user.is_active) throw new Error('Account is deactivated');
  if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password');

  // Create JWT
  const token = createToken({ userId: user.id, email: user.email, role: user.role });

  // Store hashed session token
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  await query(
    'INSERT INTO user_sessions (user_id, token, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [user.id, tokenHash, ip, (userAgent || '').substring(0, 500), expiresAt]
  );

  // Update login stats
  await query('UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1', [user.id]);

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

async function logout(token) {
  const tokenHash = hashSessionToken(token);
  await query('DELETE FROM user_sessions WHERE token = $1', [tokenHash]);
}

async function getUserFromToken(token) {
  // 1. Verify JWT signature + expiry
  const payload = verifyToken(token);
  if (!payload) return null;

  // 2. Verify session still exists in DB (real logout)
  const tokenHash = hashSessionToken(token);
  const session = await queryOne(
    'SELECT id, user_id, expires_at FROM user_sessions WHERE token = $1 AND expires_at > NOW()',
    [tokenHash]
  );
  if (!session) return null;

  // 3. Verify user is still active
  const user = await queryOne(
    'SELECT id, email, name, role, is_active FROM users WHERE id = $1',
    [payload.userId]
  );
  if (!user || !user.is_active) return null;

  return user;
}

// ─── ADMIN OPERATIONS ─────────────────────────────────────

async function getAllUsers() {
  return queryAll(`
    SELECT id, email, name, role, is_active, last_login, login_count, created_at
    FROM users ORDER BY created_at DESC
  `);
}

async function getActiveSessions() {
  return queryAll(`
    SELECT s.id, s.user_id, u.email, u.name, s.ip_address,
      LEFT(s.user_agent, 80) AS user_agent, s.created_at, s.expires_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > NOW()
    ORDER BY s.created_at DESC
  `);
}

async function updateUser(userId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.role !== undefined) { fields.push(`role = $${idx++}`); values.push(updates.role); }
  if (updates.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(updates.is_active); }
  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.password) { fields.push(`password_hash = $${idx++}`); values.push(hashPassword(updates.password)); }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);
  values.push(userId);

  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
}

async function cleanExpiredSessions() {
  await query('DELETE FROM user_sessions WHERE expires_at < NOW()');
}

module.exports = {
  register, login, logout, getUserFromToken,
  getAllUsers, getActiveSessions, updateUser, deleteUser, cleanExpiredSessions,
  verifyToken, createToken,
};
