const authService = require('../services/authService');
const config = require('../config');

async function authMiddleware(req, res, next) {
  // Skip auth for login/register/health
  if (req.path.startsWith('/api/auth/') || req.path === '/api/health') {
    return next();
  }

  // Skip auth in dev mode
  if (config.nodeEnv === 'development') {
    req.user = { id: 0, email: 'dev@local', name: 'Dev', role: 'admin' };
    return next();
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = await authService.getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

module.exports = authMiddleware;
