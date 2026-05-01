#!/usr/bin/env node
require('dotenv').config({ path: '/root/meta-ads-dashboard/.env' });

const backfill = require('../server/services/ghlConversationBackfillService');

function parseArgs(argv) {
  const args = {
    accountId: null,
    reconcileAccountId: null,
    sinceDays: 60,
    dryRun: true,
    all: false,
    limit: 1000,
    maxContacts: 10000,
    delayMs: 150,
    progress: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--account') {
      args.accountId = parseInt(next, 10);
      i += 1;
    } else if (arg === '--reconcile-account') {
      args.reconcileAccountId = parseInt(next, 10);
      i += 1;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--since-days') {
      args.sinceDays = parseInt(next, 10);
      i += 1;
    } else if (arg === '--limit') {
      args.limit = parseInt(next, 10);
      i += 1;
    } else if (arg === '--max-contacts') {
      args.maxContacts = parseInt(next, 10);
      i += 1;
    } else if (arg === '--delay-ms') {
      args.delayMs = parseInt(next, 10);
      i += 1;
    } else if (arg === '--write') {
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--progress') {
      args.progress = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.all && !args.accountId && !args.reconcileAccountId) {
    throw new Error('Use --account <id>, --reconcile-account <id>, or --all');
  }
  const options = {
    sinceDays: args.sinceDays,
    dryRun: args.dryRun,
    limit: args.limit,
    maxContacts: args.maxContacts,
    delayMs: args.delayMs,
  };
  if (args.progress) {
    options.onProgress = (state) => {
      console.error(`[reconcile] ${state.scanned}/${state.total} scanned, inbound=${state.contacts_with_inbound_reply}, matched=${state.matched_to_local_leads}, new=${state.newly_qualified}, unmatched=${state.unmatched_replied_contacts}, errors=${state.errors}`);
    };
  }
  const result = args.reconcileAccountId
    ? await backfill.reconcileQualifiedLeadsForAccount(args.reconcileAccountId, options)
    : args.all
    ? await backfill.backfillAllAccounts(options)
    : await backfill.backfillAccount(args.accountId, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
