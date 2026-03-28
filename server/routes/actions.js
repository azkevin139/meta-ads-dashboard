const express = require('express');
const router = express.Router();
const actionService = require('../services/actionService');

// POST /api/actions/pause
// Body: { accountId, entityType, metaEntityId }
router.post('/pause', async (req, res) => {
  try {
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.pauseEntity(accountId || 1, entityType, metaEntityId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/actions/resume
router.post('/resume', async (req, res) => {
  try {
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.resumeEntity(accountId || 1, entityType, metaEntityId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/actions/budget
// Body: { accountId, metaAdSetId, newBudget (in dollars, not cents) }
router.post('/budget', async (req, res) => {
  try {
    const { accountId, metaAdSetId, newBudget } = req.body;
    if (!metaAdSetId || newBudget === undefined) {
      return res.status(400).json({ error: 'metaAdSetId and newBudget required' });
    }
    const result = await actionService.updateBudget(accountId || 1, metaAdSetId, parseFloat(newBudget));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/actions/duplicate
// Body: { accountId, entityType, metaEntityId }
router.post('/duplicate', async (req, res) => {
  try {
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.duplicateEntity(accountId || 1, entityType, metaEntityId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
