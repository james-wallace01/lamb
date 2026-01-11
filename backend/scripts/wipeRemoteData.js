/*
  Wipe remote user account data (DANGEROUS).

  This script is intentionally hard to run by accident:
  - Dry-run by default
  - Requires explicit "--execute"
  - Requires REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA
  - Refuses to run against Stripe live keys unless explicitly overridden

  Usage (dry run):
    node scripts/wipeRemoteData.js

  Execute (test Stripe only):
    REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA \
    node scripts/wipeRemoteData.js --execute

  Optional flags:
    --scope all|stripe|firebase   (default: all)
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
  if (scope === 'all' || scope === 'stripe' || scope === 'firebase') return scope;
  fail(`Unknown --scope "${scope}" (expected all|stripe|firebase)`);
};

const requireConfirmIfExecuting = () => {
  if (!execute) return;
  if (confirm !== 'DELETE_ALL_REMOTE_DATA') {
    fail('Missing or invalid REMOTE_WIPE_CONFIRM (set to DELETE_ALL_REMOTE_DATA to proceed).');
  }
};

const initStripe = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !String(key).trim()) return { stripe: null, key: null };

  const trimmed = String(key).trim();
  const isLive = trimmed.startsWith('sk_live_');
  const allowLive = String(process.env.ALLOW_LIVE_STRIPE_WIPE).toLowerCase() === 'true';
  const liveConfirm = process.env.LIVE_STRIPE_WIPE_CONFIRM;

  if (execute && isLive) {
    if (!allowLive || liveConfirm !== 'I_KNOW_THIS_IS_LIVE') {
      fail(
        'Refusing to wipe Stripe LIVE data. To override, set ALLOW_LIVE_STRIPE_WIPE=true and LIVE_STRIPE_WIPE_CONFIRM=I_KNOW_THIS_IS_LIVE.'
      );
    }
  }

  return { stripe: require('stripe')(trimmed), key: trimmed };
};

const listAllStripe = async (stripe, listFn, perPage = 100) => {
  const out = [];
  let startingAfter = null;

  while (true) {
    const page = await listFn({ limit: perPage, starting_after: startingAfter || undefined });
    const data = Array.isArray(page?.data) ? page.data : [];
    out.push(...data);
    if (limit != null && out.length >= limit) return out.slice(0, limit);
    if (!page?.has_more || data.length === 0) return out;
    startingAfter = data[data.length - 1].id;
  }
};

const wipeStripe = async () => {
  const { stripe, key } = initStripe();
  if (!stripe) {
    console.log('[stripe] STRIPE_SECRET_KEY not set; skipping');
    return;
  }

  console.log(`[stripe] key: ${key.startsWith('sk_live_') ? 'LIVE' : 'TEST'}`);

  // 1) Cancel subscriptions
  console.log('[stripe] listing subscriptions…');
  const subs = await listAllStripe(
    stripe,
    (params) => stripe.subscriptions.list({ ...params, status: 'all' }),
    100
  );

  const toCancel = subs.filter((s) => s && s.status !== 'canceled');
  console.log(`[stripe] subscriptions found: ${subs.length} (to cancel: ${toCancel.length})`);

  if (execute) {
    for (const sub of toCancel) {
      try {
        console.log(`[stripe] cancel ${sub.id} (${sub.status})`);
        await stripe.subscriptions.cancel(sub.id);
      } catch (err) {
        console.log(`[stripe] failed cancel ${sub.id}: ${err?.message || String(err)}`);
      }
    }
  } else {
    toCancel.slice(0, 10).forEach((s) => console.log(`[stripe] would cancel ${s.id} (${s.status})`));
    if (toCancel.length > 10) console.log(`[stripe] …and ${toCancel.length - 10} more`);
  }

  // 2) Delete customers
  console.log('[stripe] listing customers…');
  const customers = await listAllStripe(stripe, (params) => stripe.customers.list(params), 100);
  console.log(`[stripe] customers found: ${customers.length}`);

  if (execute) {
    for (const customer of customers) {
      try {
        console.log(`[stripe] delete customer ${customer.id}`);
        await stripe.customers.del(customer.id);
      } catch (err) {
        console.log(`[stripe] failed delete customer ${customer.id}: ${err?.message || String(err)}`);
      }
    }
  } else {
    customers.slice(0, 10).forEach((c) => console.log(`[stripe] would delete customer ${c.id}`));
    if (customers.length > 10) console.log(`[stripe] …and ${customers.length - 10} more`);
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

  const shouldStripe = scope === 'all' || scope === 'stripe';
  const shouldFirebase = scope === 'all' || scope === 'firebase';

  try {
    if (shouldStripe) await wipeStripe();
    if (shouldFirebase) await wipeFirebaseAuth();

    console.log(`\n[remote wipe] done (${execute ? 'executed' : 'dry-run'})\n`);
  } catch (err) {
    fail(err?.message || String(err));
  }
})();
