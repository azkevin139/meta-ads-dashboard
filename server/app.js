const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const authMiddleware = require('./middleware/auth');
const csrfMiddleware = require('./middleware/csrf');
const metaUsage = require('./services/metaUsageService');
const aiBackendSettings = require('./services/aiBackendSettingsService');

let helmet, rateLimit, ipKeyGenerator;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try {
  const erl = require('express-rate-limit');
  rateLimit = erl;
  ipKeyGenerator = erl.ipKeyGenerator || ((ip) => String(ip || 'unknown'));
} catch (e) { rateLimit = null; ipKeyGenerator = (ip) => String(ip || 'unknown'); }

function createApp(config) {
  const authRoutes = require('./routes/auth');
  const adminRoutes = require('./routes/admin');
  const metaRoutes = require('./routes/meta');
  const metaRateRoutes = require('./routes/metaRate');
  const metaEntityRoutes = require('./routes/metaEntity');
  const insightsRoutes = require('./routes/insights');
  const aiRoutes = require('./routes/ai');
  const intelligenceRoutes = require('./routes/intelligence');
  const actionsRoutes = require('./routes/actions');
  const logsRoutes = require('./routes/logs');
  const accountRoutes = require('./routes/accounts');
  const reportRoutes = require('./routes/reports');
  const publicReportRoutes = require('./routes/publicReports');
  const trackingRoutes = require('./routes/tracking');
  const webhookRoutes = require('./routes/webhooks');
  const createRoutes = require('./routes/create');
  const { pool } = require('./db');
  const cspService = require('./services/cspService');
  const reportLinks = require('./services/reportLinkService');
  const reportLinkThrottle = require('./services/reportLinkThrottle');

  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  if (helmet) {
    app.use(helmet({
      contentSecurityPolicy: {
        reportOnly: true,
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://track.lnxo.me', 'https://n8n.emma42.com'],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          reportUri: ['/api/security/csp-report'],
        },
      },
    }));
  }

  if (rateLimit) {
    app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
    app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts. Try again later.' } }));
  }

  app.use('/api/track', (req, res, next) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(cors({
    origin: ['http://72.62.94.97:4000', 'http://localhost:4000', 'https://ads.emma42.com', 'https://track.lnxo.me'],
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({
    limit: '1mb',
    type: ['application/json', 'application/csp-report', 'application/reports+json'],
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.post('/api/security/csp-report', (req, res) => {
    console.warn('[csp-report]', JSON.stringify({
      request_id: req.requestId,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
      report: req.body || null,
    }));
    cspService.recordReport(req).catch((err) => {
      console.warn('[csp-report] persistence failed:', err.message);
    });
    res.status(204).end();
  });
  app.get('/js/meta-tracker.js', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });
  app.get('/report/:token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const respondUnavailable = () => {
      res.status(404).type('html').send(
        '<!doctype html><html lang="en"><head><meta charset="UTF-8">'
        + '<meta name="robots" content="noindex,nofollow">'
        + '<meta name="referrer" content="no-referrer">'
        + '<title>Report unavailable</title>'
        + '<style>body{font-family:system-ui,sans-serif;background:#F7F8FA;color:#111;'
        + 'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}'
        + '.box{max-width:420px;text-align:center;background:#fff;border:0.5px solid rgba(0,0,0,0.07);'
        + 'border-radius:8px;padding:32px}h1{font-size:18px;margin:0 0 8px}'
        + 'p{font-size:14px;color:#6B6A65;margin:0;line-height:1.5}</style></head>'
        + '<body><div class="box"><h1>Report unavailable</h1>'
        + '<p>This report link is no longer valid. Ask your account manager for a new one.</p>'
        + '</div></body></html>'
      );
    };

    if (reportLinkThrottle.isBlocked(req.ip)) {
      res.status(429).type('text/plain').send('Too many invalid report attempts. Try again later.');
      return;
    }
    if (!reportLinks.isValidTokenFormat(req.params.token)) {
      reportLinkThrottle.noteFailure(req.ip);
      respondUnavailable();
      return;
    }
    try {
      await reportLinks.resolveToken(req.params.token);
    } catch (_err) {
      reportLinkThrottle.noteFailure(req.ip);
      respondUnavailable();
      return;
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'client-report.html'));
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  if (rateLimit) {
    // Per (IP, token) so one noisy client cannot starve others; 30/min/IP/token.
    app.use('/api/public/reports', rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const m = req.path.match(/^\/([^\/]+)\//);
        const tokenKey = m ? m[1] : 'none';
        return `${ipKeyGenerator(req.ip || 'unknown')}:${tokenKey}`;
      },
      message: { error: 'Too many report requests. Try again later.' },
    }));
  }
  app.use('/api/public/reports', publicReportRoutes);
  app.use('/api', authMiddleware);
  app.use('/api', csrfMiddleware);

  const readOnly = process.env.READ_ONLY === 'true';
  if (readOnly) {
    app.use('/api/meta/update-ad', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
    app.use('/api/meta/update-adset', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
    app.use('/api/create', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
    app.use('/api/actions', (req, res, next) => {
      if (req.method === 'POST') return res.status(403).json({ error: 'Dashboard is in read-only mode' });
      next();
    });
  }

  app.use(['/api/meta/update-ad', '/api/meta/update-adset'], async (req, res, next) => {
    if (readOnly || req.method !== 'POST') return next();
    try {
      const usage = await metaUsage.fetchLiveStatus(false, req.metaAccount);
      if (!usage.safe_to_write) {
        return res.status(429).json({ error: `Meta API write pressure is too high right now. Wait ${usage.estimated_regain_seconds || 0}s before trying again.` });
      }
      next();
    } catch (err) {
      next();
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/track', trackingRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/meta', metaRateRoutes);
  app.use('/api/meta', metaEntityRoutes);
  app.use('/api/meta', metaRoutes);
  app.use('/api/insights', insightsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/intelligence', intelligenceRoutes);
  app.use('/api/actions', actionsRoutes);
  app.use('/api/logs', logsRoutes);
  app.use('/api/create', createRoutes);

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      const aiStatus = await aiBackendSettings.getStatus().catch(() => ({ configured: Boolean(config.openai.apiKey) }));
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        meta_configured: Boolean(config.meta.accessToken && config.meta.adAccountId),
        openai_configured: Boolean(aiStatus.configured),
        time: new Date().toISOString(),
        env: config.nodeEnv,
        read_only: readOnly,
      });
    } catch (err) {
      const aiStatus = await aiBackendSettings.getStatus().catch(() => ({ configured: Boolean(config.openai.apiKey) }));
      res.status(500).json({
        status: 'error',
        uptime: process.uptime(),
        meta_configured: Boolean(config.meta.accessToken && config.meta.adAccountId),
        openai_configured: Boolean(aiStatus.configured),
        time: new Date().toISOString(),
        env: config.nodeEnv,
        read_only: readOnly,
      });
    }
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

module.exports = { createApp };
