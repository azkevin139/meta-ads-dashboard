const config = require('../config');

// Simple API key auth via x-api-key header or ?key= query param
// For an internal tool, this is sufficient. Upgrade to JWT if needed later.
function authMiddleware(req, res, next) {
  // Skip auth in dev mode
  if (config.nodeEnv === 'development') return next();

  const apiKey = req.headers['x-api-key'] || req.query.key;

  if (!apiKey || apiKey !== config.authSecret) {
    return res.status(401).json({ error: 'Unauthorized — provide x-api-key header' });
  }

  next();
}

module.exports = authMiddleware;
