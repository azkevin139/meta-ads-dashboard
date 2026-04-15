const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { pool } = require('./db');
const authMiddleware = require('./middleware/auth');
const metaUsage = require('./services/metaUsageService');

let helmet, rateLimit;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; }

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

const app = express();

if (helmet) {
  app.use(helmet({ contentSecurityPolicy: false }));
}

if (rateLimit) {
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts. Try again later.' } }));
}

app.use(cors({
  origin: ['http://72.62.94.97:4000', 'http://localhost:4000', 'https://ads.emma42.com'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', authMiddleware);

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

const createRoutes = require('./routes/create');
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/meta', metaRateRoutes);
app.use('/api/meta', metaEntityRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/create', createRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      meta_configured: Boolean(config.meta.accessToken && config.meta.adAccountId),
      openai_configured: Boolean(config.openai.apiKey),
      time: new Date().toISOString(),
      env: config.nodeEnv,
      read_only: readOnly,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      uptime: process.uptime(),
      meta_configured: Boolean(config.meta.accessToken && config.meta.adAccountId),
      openai_configured: Boolean(config.openai.apiKey),
      time: new Date().toISOString(),
      env: config.nodeEnv,
      read_only: readOnly,
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   Meta Ads Dashboard — V2               ║
  ║   Port: ${String(config.port).padEnd(35)}║
  ║   Env: ${config.nodeEnv.padEnd(36)}║
  ║   Read-only: ${String(readOnly).padEnd(30)}║
  ║   Helmet: ${String(!!helmet).padEnd(33)}║
  ║   Rate limit: ${String(!!rateLimit).padEnd(29)}║
  ╚══════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});
