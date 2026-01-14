/*
  Admin helper: Grant a user temporary membership to a vault.

  Writes:
    /vaults/{vaultId}/memberships/{uid}

  Safety
  - Dry-run by default.
  - Requires --execute AND GRANT_MEMBERSHIP_CONFIRM=I_UNDERSTAND

  Usage:
    node scripts/grantMembership.js --vaultId <vaultId> --uid <uid>

    GRANT_MEMBERSHIP_CONFIRM=I_UNDERSTAND node scripts/grantMembership.js --execute \
      --vaultId <vaultId> --uid <uid> --role DELEGATE

  Options:
    --role OWNER|DELEGATE   (default: DELEGATE)

  Notes
  - This does not change vault.activeOwnerId. Granting OWNER role should only be used
    for testing and may not reflect app ownership semantics.
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
const vaultId = String(getArgValue('--vaultId', '')).trim();
const uid = String(getArgValue('--uid', '')).trim();
const roleRaw = String(getArgValue('--role', 'DELEGATE')).trim().toUpperCase();
const role = roleRaw === 'OWNER' ? 'OWNER' : 'DELEGATE';

const fail = (msg) => {
  console.error(`\n[grantMembership] ERROR: ${msg}\n`);
  process.exit(1);
};

const logHeader = () => {
  console.log('\n======================================');
  console.log('[grantMembership] Grant vault membership');
  console.log('======================================');
  console.log(`mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`vaultId: ${vaultId || '(missing)'}`);
  console.log(`uid: ${uid || '(missing)'}`);
  console.log(`role: ${role}`);
};

const requireConfirmIfExecuting = () => {
  if (!execute) return;
  if (process.env.GRANT_MEMBERSHIP_CONFIRM !== 'I_UNDERSTAND') {
    fail('Refusing to execute without GRANT_MEMBERSHIP_CONFIRM=I_UNDERSTAND');
  }
};

const run = async () => {
  logHeader();

  if (!vaultId) fail('Missing --vaultId');
  if (!uid) fail('Missing --uid');

  requireConfirmIfExecuting();

  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    fail('Firebase Admin is not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or other credentials).');
  }

  const admin = require('firebase-admin');
  const db = admin.firestore();

  const membershipRef = db.collection('vaults').doc(String(vaultId)).collection('memberships').doc(String(uid));

  const now = Date.now();
  const data = {
    user_id: String(uid),
    vault_id: String(vaultId),
    role,
    status: 'ACTIVE',
    permissions: role === 'OWNER' ? null : { View: true },
    assigned_at: now,
    revoked_at: null,
  };

  if (!execute) {
    console.log(`\n[grantMembership] would upsert: vaults/${vaultId}/memberships/${uid}`);
    console.log('[grantMembership] data:', JSON.stringify(data, null, 2));
    console.log('\n[grantMembership] dry-run complete.');
    return;
  }

  await membershipRef.set(data, { merge: true });
  console.log(`\n[grantMembership] upserted: vaults/${vaultId}/memberships/${uid}`);
  console.log('[grantMembership] done.');
};

run().catch((err) => {
  console.error('\n[grantMembership] fatal:', err);
  process.exit(1);
});
