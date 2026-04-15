const express = require('express');
const { sendError } = require('../errorResponse');
const accountService = require('../services/accountService');

const router = express.Router();

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.get('/', async (req, res) => {
  try {
    const accounts = await accountService.listAccounts();
    res.json({
      data: accounts,
      active: accountService.publicAccount(req.metaAccount),
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/active', async (req, res) => {
  try {
    const accountId = parseInt(req.body.accountId, 10);
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    const account = await accountService.updateSessionAccount(req.user.session_token_hash, accountId);
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const account = await accountService.createAccount(req.body);
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/default', adminOnly, async (req, res) => {
  try {
    const account = await accountService.setDefaultAccount(parseInt(req.params.id, 10));
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
