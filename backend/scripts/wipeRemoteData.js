/*
  Wipe remote user account data (DANGEROUS).

  This script is intentionally hard to run by accident:
  - Dry-run by default
  - Requires explicit "--execute"
  - Requires REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA

  Usage (dry run):
    node scripts/wipeRemoteData.js

  Execute:
    REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA \
    node scripts/wipeRemoteData.js --execute

  Optional flags:
    --scope all|firebase          (default: all)
    --limit N                    (default: unlimited)
*/

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);
const getArgValue = (name, fallback) => {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  if (!val || val.startsWith('--')) return fallback;
  return val;
};

const execute = hasFlag('--execute');
const scope = String(getArgValue('--scope', 'all')).toLowerCase();
const limitRaw = getArgValue('--limit', null);
const limit = limitRaw == null ? null : Number(limitRaw);

const confirm = process.env.REMOTE_WIPE_CONFIRM;

const fail = (msg) => {
  console.error(`\n[remote wipe] ERROR: ${msg}\n`);
  process.exit(1);
};

const logHeader = () => {
  console.log('\n==============================');
  console.log('[remote wipe] LAMB remote wipe');
  console.log('==============================');
  console.log(`mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`scope: ${scope}`);
  console.log(`limit: ${limit == null ? 'none' : String(limit)}`);
};

const normalizeScope = () => {
  if (scope === 'all' || scope === 'firebase') return scope;
  fail(`Unknown --scope "${scope}" (expected all|firebase)`);
};

const requireConfirmIfExecuting = () => {
  if (!execute) return;
  if (confirm !== 'DELETE_ALL_REMOTE_DATA') {
    fail('Missing or invalid REMOTE_WIPE_CONFIRM (set to DELETE_ALL_REMOTE_DATA to proceed).');
  }
};

const wipeFirebaseAuth = async () => {
  // Firebase Admin must be configured via env vars/service account.
  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    console.log('[firebase] not configured; skipping');
    return;
  }

  if (execute) {
    const allow = String(process.env.ALLOW_FIREBASE_WIPE).toLowerCase() === 'true';
    if (!allow) {
      fail('Refusing to delete Firebase Auth users unless ALLOW_FIREBASE_WIPE=true is set.');
    }
  }

  const admin = require('firebase-admin');

  console.log('[firebase] listing auth users…');

  const uids = [];
  let pageToken = undefined;
  while (true) {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users || []) {
      uids.push(u.uid);
      if (limit != null && uids.length >= limit) break;
    }
    if (limit != null && uids.length >= limit) break;
    if (!page.pageToken) break;
    pageToken = page.pageToken;
  }

  console.log(`[firebase] auth users found: ${uids.length}`);

  if (!execute) {
    uids.slice(0, 10).forEach((uid) => console.log(`[firebase] would delete ${uid}`));
    if (uids.length > 10) console.log(`[firebase] …and ${uids.length - 10} more`);
    return;
  }

  const batchSize = 1000;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    console.log(`[firebase] deleting ${batch.length} users… (${i + batch.length}/${uids.length})`);
    const result = await admin.auth().deleteUsers(batch);
    if (result.failureCount) {
      for (const err of result.errors || []) {
        console.log(`[firebase] failed delete uid=${err.uid}: ${err.error?.message || String(err.error)}`);
      }
    }
  }
};

(async () => {
  logHeader();
  normalizeScope();
  requireConfirmIfExecuting();

  const shouldFirebase = scope === 'all' || scope === 'firebase';

  try {
    if (shouldFirebase) await wipeFirebaseAuth();

    console.log(`\n[remote wipe] done (${execute ? 'executed' : 'dry-run'})\n`);
  } catch (err) {
    fail(err?.message || String(err));
  }
})();
