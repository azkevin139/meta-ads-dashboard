const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const auth = require('../services/authService');
const { ensureBoolean, ensureEnum, ensureInteger, ensureObject, optionalTrimmedString } = require('../validation');

// Admin-only middleware
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.use(adminOnly);

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await auth.getAllUsers();
    res.json({ data: users });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/admin/sessions — active sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await auth.getActiveSessions();
    res.json({ data: sessions });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/users — create user
router.post('/users', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const email = optionalTrimmedString(body.email, 320);
    const password = optionalTrimmedString(body.password, 500);
    const name = optionalTrimmedString(body.name, 200) || '';
    const role = body.role === undefined ? 'viewer' : ensureEnum(body.role, ['admin', 'operator', 'viewer'], 'Invalid role');
    if (!email) return res.status(400).json({ error: 'Email required' });
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
    const user = await auth.register(email, password, name, role);
    res.json({ success: true, data: user });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/admin/users/:id — update user
router.post('/users/:id', async (req, res) => {
  try {
    const userId = ensureInteger(req.params.id, 'id must be a positive integer');
    const body = ensureObject(req.body);
    const role = body.role === undefined ? undefined : ensureEnum(body.role, ['admin', 'operator', 'viewer'], 'Invalid role');
    const is_active = body.is_active === undefined ? undefined : ensureBoolean(body.is_active, 'is_active must be true or false');
    const name = optionalTrimmedString(body.name, 200);
    const password = optionalTrimmedString(body.password, 500);
    await auth.updateUser(userId, { role, is_active, name, password });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await auth.deleteUser(userId);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
