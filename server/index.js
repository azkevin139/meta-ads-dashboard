const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { pool } = require('./db');
const authMiddleware = require('./middleware/auth');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const metaRoutes = require('./routes/meta');
const insightsRoutes = require('./routes/insights');
const aiRoutes = require('./routes/ai');
const actionsRoutes = require('./routes/actions');
const logsRoutes = require('./routes/logs');

const app = express();

// ─── MIDDLEWARE ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth on all API routes (skips /api/auth/* and /api/health)
app.use('/api', authMiddleware);

// ─── API ROUTES ───────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/logs', logsRoutes);

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() AS time');
    res.json({
      status: 'ok',
      time: dbResult.rows[0].time,
      uptime: process.uptime(),
      env: config.nodeEnv,
      meta_configured: !!config.meta.accessToken,
      openai_configured: !!config.openai.apiKey,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─── CATCH-ALL: serve index.html for SPA-style routing ────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────
app.listen(config.port, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   Meta Ads Dashboard — V2               ║
  ║   Running on port ${config.port}                  ║
  ║   Env: ${config.nodeEnv.padEnd(33)}║
  ╚══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});
