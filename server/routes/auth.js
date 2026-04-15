const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const auth = require('../services/authService');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await auth.register(email, password, name || '');
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const result = await auth.login(email, password, ip, userAgent);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) await auth.logout(token);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/auth/me — get current user
router.get('/me', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const user = await auth.getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    res.json({ user });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
