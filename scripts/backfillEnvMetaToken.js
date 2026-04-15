require('dotenv').config({ path: '/root/meta-ads-dashboard/.env' });

const accountService = require('../server/services/accountService');
const { query, pool } = require('../server/db');

(async () => {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) throw new Error('Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID');

  await query(
    'UPDATE accounts SET encrypted_token = $1, token_last4 = $2, access_token = NULL, updated_at = NOW() WHERE meta_account_id = $3',
    [accountService.encryptToken(token), token.slice(-4), accountId]
  );
  await pool.end();
  console.log('updated active Meta account token storage');
})().catch(async (err) => {
  console.error(err.message || err);
  await pool.end().catch(() => {});
  process.exit(1);
});
