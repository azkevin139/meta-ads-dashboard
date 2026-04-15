require('dotenv').config({ path: '/root/meta-ads-dashboard/.env' });

const accountService = require('../server/services/accountService');
const metaApi = require('../server/services/metaApi');
const { pool } = require('../server/db');

(async () => {
  const account = await accountService.getDefaultAccount();
  if (!account) throw new Error('No default Meta account configured');
  const data = await metaApi.metaGet(`/${metaApi.contextAccountId(account)}`, { fields: 'id,name,account_id' }, account);
  await pool.end();
  console.log(`validated ${data.id || data.account_id || metaApi.contextAccountId(account)} ${data.name || ''}`.trim());
})().catch(async (err) => {
  console.error(err.message || err);
  await pool.end().catch(() => {});
  process.exit(1);
});
