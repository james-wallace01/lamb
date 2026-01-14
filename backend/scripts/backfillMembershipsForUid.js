/*
  Admin helper: Backfill membership docs for a specific user UID.

  Why
  - Firestore rules require membership.status == 'ACTIVE' for both vault reads and membership reads.
  - Older membership docs may be missing fields (status/user_id/vault_id/role/permissions), locking users out.

  What it does
  - Finds all docs in collectionGroup('memberships') where user_id == uid.
  - Also queries owned vaults (activeOwnerId/ownerId) and ensures an OWNER membership doc exists.
  - For each membership doc, sets missing fields and normalizes status casing.
  - Derives role from vault.activeOwnerId/ownerId when missing.

  Safety
  - Dry-run by default.
  - Requires --execute AND BACKFILL_MEMBERSHIPS_CONFIRM=I_UNDERSTAND

  Usage
    node scripts/backfillMembershipsForUid.js --uid <uid>

    BACKFILL_MEMBERSHIPS_CONFIRM=I_UNDERSTAND node scripts/backfillMembershipsForUid.js --execute --uid <uid>
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
const uid = String(getArgValue('--uid', '')).trim();

const fail = (msg) => {
  console.error(`\n[backfillMemberships] ERROR: ${msg}\n`);
  process.exit(1);
};

const logHeader = () => {
  console.log('\n============================================');
  console.log('[backfillMemberships] Backfill memberships');
  console.log('============================================');
  console.log(`mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`uid: ${uid || '(missing)'}`);
};

const requireConfirmIfExecuting = () => {
  if (!execute) return;
  if (process.env.BACKFILL_MEMBERSHIPS_CONFIRM !== 'I_UNDERSTAND') {
    fail('Refusing to execute without BACKFILL_MEMBERSHIPS_CONFIRM=I_UNDERSTAND');
  }
};

const normalizeStatus = (s) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (up === 'ACTIVE') return 'ACTIVE';
  if (up === 'REVOKED') return 'REVOKED';
  if (up === 'EXPIRED') return 'EXPIRED';
  if (up === 'PENDING') return 'PENDING';
  return up;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const run = async () => {
  logHeader();
  if (!uid) fail('Missing --uid');

  requireConfirmIfExecuting();

  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    fail('Firebase Admin is not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or other credentials).');
  }

  const admin = require('firebase-admin');
  const db = admin.firestore();

  const FieldPath = admin.firestore.FieldPath;

  // 1) Discover vaultIds from membership docs that already have user_id.
  const membershipSnap = await db.collectionGroup('memberships').where('user_id', '==', uid).get();
  console.log(`[backfillMemberships] membership docs found (user_id==uid): ${membershipSnap.size}`);

  // 2) Discover vaultIds where the user is the active owner (may be missing membership docs in legacy data).
  const [activeOwnerSnap, ownerSnap] = await Promise.all([
    db.collection('vaults').where('activeOwnerId', '==', uid).limit(500).get(),
    db.collection('vaults').where('ownerId', '==', uid).limit(500).get(),
  ]);

  const vaultIds = new Set();
  membershipSnap.docs.forEach((d) => {
    const vaultId = d.ref?.parent?.parent?.id ? String(d.ref.parent.parent.id) : null;
    if (vaultId) vaultIds.add(vaultId);
  });
  activeOwnerSnap.docs.forEach((d) => vaultIds.add(String(d.id)));
  ownerSnap.docs.forEach((d) => vaultIds.add(String(d.id)));

  console.log(`[backfillMemberships] vaults to inspect: ${vaultIds.size}`);
  if (vaultIds.size === 0) {
    console.log('[backfillMemberships] nothing to do.');
    return;
  }

  const updates = [];
  const creates = [];
  for (const vaultId of vaultIds) {
    const membershipRef = db.collection('vaults').doc(String(vaultId)).collection('memberships').doc(uid);
    const mSnap = await membershipRef.get();

    let vault = {};
    try {
      const vSnap = await db.collection('vaults').doc(String(vaultId)).get();
      vault = vSnap.exists ? vSnap.data() || {} : {};
    } catch {
      // ignore
    }

    const ownerId = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : typeof vault.ownerId === 'string' ? vault.ownerId : null;
    const isOwned = ownerId && String(ownerId) === uid;

    if (!mSnap.exists) {
      if (!isOwned) continue;
      const now = Date.now();
      creates.push({
        ref: membershipRef,
        data: {
          user_id: uid,
          vault_id: String(vaultId),
          role: 'OWNER',
          status: 'ACTIVE',
          permissions: null,
          assigned_at: now,
          revoked_at: null,
        },
      });
      continue;
    }

    const data = mSnap.data() || {};
    const patch = {};

    if (typeof data.user_id !== 'string' || data.user_id !== uid) patch.user_id = uid;
    if (typeof data.vault_id !== 'string' || data.vault_id !== String(vaultId)) patch.vault_id = String(vaultId);

    const statusNorm = normalizeStatus(data.status);
    if (!statusNorm) {
      patch.status = 'ACTIVE';
    } else if (statusNorm !== data.status) {
      patch.status = statusNorm;
    }

    let role = typeof data.role === 'string' ? data.role.trim().toUpperCase() : null;
    if (role !== 'OWNER' && role !== 'DELEGATE') role = null;
    if (!role) {
      role = isOwned ? 'OWNER' : 'DELEGATE';
      patch.role = role;
    }

    if (role === 'OWNER') {
      if (data.permissions !== null) patch.permissions = null;
    } else {
      const perms = data.permissions && typeof data.permissions === 'object' ? data.permissions : null;
      if (!perms) patch.permissions = { View: true };
    }

    if (typeof data.assigned_at !== 'number') patch.assigned_at = Date.now();
    if (!('revoked_at' in data)) patch.revoked_at = null;

    const keys = Object.keys(patch);
    if (keys.length) updates.push({ ref: membershipRef, patch });
  }

  console.log(`[backfillMemberships] docs needing patch: ${updates.length}`);
  console.log(`[backfillMemberships] missing owner memberships to create: ${creates.length}`);

  if (!execute) {
    for (const u of updates.slice(0, 25)) {
      console.log(`\n[backfillMemberships] would patch: ${u.ref.path}`);
      console.log(JSON.stringify(u.patch, null, 2));
    }
    for (const c of creates.slice(0, 25)) {
      console.log(`\n[backfillMemberships] would create: ${c.ref.path}`);
      console.log(JSON.stringify(c.data, null, 2));
    }
    if (updates.length + creates.length > 50) {
      console.log(`\n[backfillMemberships] (showing first 25 patches and first 25 creates)`);
    }
    console.log('\n[backfillMemberships] dry-run complete.');
    return;
  }

  // Batch in groups (max 500 writes/batch).
  for (const group of chunk(creates, 400)) {
    const batch = db.batch();
    group.forEach((c) => batch.set(c.ref, c.data, { merge: true }));
    await batch.commit();
  }
  for (const group of chunk(updates, 400)) {
    const batch = db.batch();
    group.forEach((u) => batch.set(u.ref, u.patch, { merge: true }));
    await batch.commit();
  }

  console.log('[backfillMemberships] execute complete.');
};

run().catch((err) => {
  console.error('\n[backfillMemberships] fatal:', err);
  process.exit(1);
});
