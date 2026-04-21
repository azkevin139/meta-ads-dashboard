const csrf = require('../services/csrfService');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isExempt(req) {
  return req.path === '/auth/login' ||
    req.path.startsWith('/track/') ||
    req.path.startsWith('/webhooks/');
}

function csrfMiddleware(req, res, next) {
  if (SAFE_METHODS.has(req.method) || isExempt(req)) return next();
  if (!req.user?.session_token_hash) return next();

  const token = req.headers['x-csrf-token'];
  if (!csrf.verifyToken(req.user.session_token_hash, token)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
}

module.exports = csrfMiddleware;
