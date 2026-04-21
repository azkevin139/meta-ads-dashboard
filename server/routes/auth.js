const express = require('express');
const { sendError } = require('../errorResponse');
const config = require('../config');
const { parseCookies, serializeCookie, sessionCookieOptions } = require('../utils/cookies');
const csrf = require('../services/csrfService');
const { ensureNonEmptyString, ensureObject, optionalTrimmedString } = require('../validation');
const router = express.Router();
const auth = require('../services/authService');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    if (!config.allowSelfSignup) {
      return res.status(403).json({ error: 'Self-registration is disabled' });
    }
    const body = ensureObject(req.body);
    const email = ensureNonEmptyString(body.email, 'Email required');
    const password = ensureNonEmptyString(body.password, 'Password required');
    const name = optionalTrimmedString(body.name, 200) || '';
    if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
    const user = await auth.register(email, password, name || '');
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const email = ensureNonEmptyString(body.email, 'Email required');
    const password = ensureNonEmptyString(body.password, 'Password required');
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const result = await auth.login(email, password, ip, userAgent);
    const tokenHash = auth.hashSessionToken(result.token);
    res.setHeader('Set-Cookie', serializeCookie('session_token', result.token, sessionCookieOptions(config)));
    res.json({ user: result.user, csrf_token: csrf.createToken(tokenHash) });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = parseCookies(req.headers.cookie || '').session_token ||
      (req.headers.authorization || '').replace('Bearer ', '');
    if (token) await auth.logout(token);
    res.setHeader('Set-Cookie', serializeCookie('session_token', '', { ...sessionCookieOptions(config), maxAge: 0 }));
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/auth/me — get current user
router.get('/me', async (req, res) => {
  try {
    const token = parseCookies(req.headers.cookie || '').session_token ||
      (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const user = await auth.getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    res.json({ user, csrf_token: csrf.createToken(user.session_token_hash) });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
