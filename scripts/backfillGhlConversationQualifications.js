#!/usr/bin/env node
require('dotenv').config({ path: '/root/meta-ads-dashboard/.env' });

const backfill = require('../server/services/ghlConversationBackfillService');

function parseArgs(argv) {
  const args = {
    accountId: null,
    sinceDays: 60,
    dryRun: true,
    all: false,
    limit: 1000,
    delayMs: 150,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--account') {
      args.accountId = parseInt(next, 10);
      i += 1;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--since-days') {
      args.sinceDays = parseInt(next, 10);
      i += 1;
    } else if (arg === '--limit') {
      args.limit = parseInt(next, 10);
      i += 1;
    } else if (arg === '--delay-ms') {
      args.delayMs = parseInt(next, 10);
      i += 1;
    } else if (arg === '--write') {
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.all && !args.accountId) {
    throw new Error('Use --account <id> or --all');
  }
  const options = {
    sinceDays: args.sinceDays,
    dryRun: args.dryRun,
    limit: args.limit,
    delayMs: args.delayMs,
  };
  const result = args.all
    ? await backfill.backfillAllAccounts(options)
    : await backfill.backfillAccount(args.accountId, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
