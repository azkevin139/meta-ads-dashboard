const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const auth = require('../services/authService');

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

// POST /api/admin/users/:id — update user
router.post('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role, is_active, name, meta_token, password } = req.body;
    await auth.updateUser(userId, { role, is_active, name, meta_token, password });
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
