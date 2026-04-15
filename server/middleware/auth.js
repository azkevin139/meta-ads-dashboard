const authService = require('../services/authService');
const accountService = require('../services/accountService');

async function authMiddleware(req, res, next) {
  // Skip auth for public auth, health, tracking, and webhook endpoints.
  if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/track/') || req.path.startsWith('/webhooks/')) {
    return next();
  }

  // Token from Authorization header ONLY (no query string)
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = await authService.getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  req.metaAccount = await accountService.getActiveAccountForSession(user);
  next();
}

module.exports = authMiddleware;
