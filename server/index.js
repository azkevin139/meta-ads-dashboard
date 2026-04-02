const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { pool } = require('./db');
const authMiddleware = require('./middleware/auth');

let helmet, rateLimit;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; }

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const metaRoutes = require('./routes/meta');
const insightsRoutes = require('./routes/insights');
const aiRoutes = require('./routes/ai');
const actionsRoutes = require('./routes/actions');
const logsRoutes = require('./routes/logs');

const app = express();

// ─── SECURITY MIDDLEWARE ──────────────────────────────────
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // allow inline scripts for our SPA
  }));
}

// Rate limiting
if (rateLimit) {
  // Global: 300 requests per 15 min
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
  // Strict on login: 10 attempts per 15 min
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts. Try again later.' } }));
}

// CORS — restrict to known origins
app.use(cors({
  origin: [
    'http://72.62.94.97:4000',
    'http://localhost:4000',
    'https://ads.emma42.com', // add your domain when ready
  ],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth on all API routes
app.use('/api', authMiddleware);

// ─── READ-ONLY MODE ───────────────────────────────────────
const readOnly = process.env.READ_ONLY === 'true';
if (readOnly) {
  app.use('/api/meta/update-ad', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
  app.use('/api/meta/update-adset', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
  app.use('/api/create', (req, res) => res.status(403).json({ error: 'Dashboard is in read-only mode' }));
  app.use('/api/actions', (req, res) => {
    if (req.method === 'POST') return res.status(403).json({ error: 'Dashboard is in read-only mode' });
    req.next();
  });
}

// ─── API ROUTES ───────────────────────────────────────────
const createRoutes = require('./routes/create');
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/create', createRoutes);

// ─── HEALTH CHECK (minimal — no config exposure) ─────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error' });
  }
});

// ─── CATCH-ALL ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────
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
