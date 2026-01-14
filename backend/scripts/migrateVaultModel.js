/*
  Firestore Migration: Vault-based roles + vault-based subscriptions.

  Goals
  - Introduce /vaults/{vaultId}/memberships/{uid} as the single source of truth for roles.
  - Ensure each vault has exactly one ACTIVE OWNER (vault.activeOwnerId).
  - Move legacy user.subscription -> /vaultSubscriptions/{primaryVaultId}
    where primaryVaultId is the earliest-created vault owned by that user.

  Safety
  - Dry-run by default.
  - Requires --execute AND MIGRATE_CONFIRM=I_UNDERSTAND

  Usage:
    node scripts/migrateVaultModel.js

    MIGRATE_CONFIRM=I_UNDERSTAND node scripts/migrateVaultModel.js --execute

  Optional:
    --limit N
    --scope vaults|memberships|subscriptions|all   (default: all)

  Notes
  - This script assumes legacy data may store:
      vault.ownerId OR vault.activeOwnerId
      vault.sharedWith[] (optional)
      users/{uid}.subscription (legacy)
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

const fail = (msg) => {
  console.error(`\n[migrate] ERROR: ${msg}\n`);
  process.exit(1);
};

const logHeader = () => {
  console.log('\n======================================');
  console.log('[migrate] Firestore vault model migrate');
  console.log('======================================');
  console.log(`mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`scope: ${scope}`);
  console.log(`limit: ${limit == null ? 'none' : String(limit)}`);
};

const normalizeScope = () => {
  if (scope === 'all' || scope === 'vaults' || scope === 'memberships' || scope === 'subscriptions') return;
  fail(`Unknown --scope "${scope}" (expected all|vaults|memberships|subscriptions)`);
};

const requireConfirmIfExecuting = () => {
  if (!execute) return;
  if (process.env.MIGRATE_CONFIRM !== 'I_UNDERSTAND') {
    fail('Refusing to execute without MIGRATE_CONFIRM=I_UNDERSTAND');
  }
};

const legacyRoleToPerms = ({ role, canCreate = false } = {}) => {
  const raw = typeof role === 'string' ? role.trim().toLowerCase() : 'reviewer';
  const r = raw === 'viewer' ? 'reviewer' : raw;
  const empty = { View: false, Create: false, Edit: false, Move: false, Clone: false, Delete: false };
  if (r === 'reviewer') return { ...empty, View: true };
  if (r === 'editor') return { ...empty, View: true, Edit: true, Create: !!canCreate };
  if (r === 'manager') return { ...empty, View: true, Edit: true, Move: true, Clone: true, Create: true };
  // Legacy "owner" share is treated as delegate with broad perms (but not real ownership).
  if (r === 'owner') return { ...empty, View: true, Create: true, Edit: true, Move: true, Clone: true, Delete: true };
  return { ...empty, View: true };
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const run = async () => {
  logHeader();
  normalizeScope();
  requireConfirmIfExecuting();

  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    fail('Firebase Admin is not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or other credentials).');
  }

  const admin = require('firebase-admin');
  const db = admin.firestore();

  const shouldVaults = scope === 'all' || scope === 'vaults';
  const shouldMemberships = scope === 'all' || scope === 'memberships';
  const shouldSubs = scope === 'all' || scope === 'subscriptions';

  const vaultSnap = await db.collection('vaults').get();
  const vaultDocs = vaultSnap.docs;
  const vaults = limit == null ? vaultDocs : vaultDocs.slice(0, limit);

  console.log(`[migrate] vaults found: ${vaultDocs.length} (processing: ${vaults.length})`);

  const stats = {
    vaultsUpdated: 0,
    membershipsUpserted: 0,
    subscriptionsCreated: 0,
    userSubscriptionsRemoved: 0,
    warnings: 0,
  };

  // 1) Normalize vault ownership fields.
  if (shouldVaults) {
    for (const doc of vaults) {
      const data = doc.data() || {};
      const vaultId = doc.id;

      const activeOwnerId = data.activeOwnerId || data.ownerId || null;
      if (!activeOwnerId) {
        console.log(`[migrate][warn] vault ${vaultId}: missing ownerId/activeOwnerId`);
        stats.warnings += 1;
        continue;
      }

      const patch = {};
      if (!data.activeOwnerId) patch.activeOwnerId = String(activeOwnerId);
      if (!data.createdBy) patch.createdBy = String(activeOwnerId);
      if (!data.createdAt) patch.createdAt = Date.now();

      if (Object.keys(patch).length) {
        if (execute) {
          await doc.ref.set(patch, { merge: true });
        }
        stats.vaultsUpdated += 1;
        console.log(`[migrate] vault ${vaultId}: set ${Object.keys(patch).join(', ')}`);
      }
    }
  }

  // 2) Create memberships.
  if (shouldMemberships) {
    for (const doc of vaults) {
      const data = doc.data() || {};
      const vaultId = doc.id;
      const ownerId = String(data.activeOwnerId || data.ownerId || '');
      if (!ownerId) continue;

      const membershipCol = doc.ref.collection('memberships');

      const upserts = [];

      // Owner
      upserts.push({
        ref: membershipCol.doc(ownerId),
        data: {
          user_id: ownerId,
          vault_id: vaultId,
          role: 'OWNER',
          permissions: null,
          status: 'ACTIVE',
          assigned_at: data.createdAt || Date.now(),
          revoked_at: null,
        },
      });

      // Delegates (legacy sharedWith)
      const sharedWith = Array.isArray(data.sharedWith) ? data.sharedWith : [];
      for (const s of sharedWith) {
        const uid = s?.userId ? String(s.userId) : null;
        if (!uid || uid === ownerId) continue;
        const perms = legacyRoleToPerms({ role: s?.role, canCreate: !!s?.canCreateCollections });
        upserts.push({
          ref: membershipCol.doc(uid),
          data: {
            user_id: uid,
            vault_id: vaultId,
            role: 'DELEGATE',
            permissions: perms,
            status: 'ACTIVE',
            assigned_at: Date.now(),
            revoked_at: null,
          },
        });
      }

      if (!execute) {
        console.log(`[migrate] vault ${vaultId}: would upsert memberships=${upserts.length}`);
        stats.membershipsUpserted += upserts.length;
        continue;
      }

      // Firestore batch max 500 writes.
      for (const group of chunk(upserts, 400)) {
        const batch = db.batch();
        for (const u of group) batch.set(u.ref, u.data, { merge: true });
        await batch.commit();
        stats.membershipsUpserted += group.length;
      }

      // Optionally remove legacy sharedWith array from vault doc to avoid dual sources of truth.
      if (Array.isArray(data.sharedWith) && data.sharedWith.length) {
        await doc.ref.set({ sharedWith: [] }, { merge: true });
      }
    }
  }

  // 3) Subscription migration: attach each user's legacy subscription to their earliest-created owned vault.
  if (shouldSubs) {
    const usersSnap = await db.collection('users').get();
    const userDocs = usersSnap.docs;

    console.log(`[migrate] users found: ${userDocs.length}`);

    for (const udoc of userDocs) {
      const u = udoc.data() || {};
      const uid = udoc.id;
      const legacySub = u.subscription || null;
      if (!legacySub) continue;

      // Find earliest vault owned by this user.
      const owned = vaultDocs
        .map((v) => ({ id: v.id, data: v.data() || {} }))
        .filter((v) => String(v.data.activeOwnerId || v.data.ownerId || '') === String(uid));

      if (!owned.length) {
        console.log(`[migrate][warn] user ${uid}: has subscription but owns no vaults`);
        stats.warnings += 1;
        continue;
      }

      owned.sort((a, b) => {
        const ac = typeof a.data.createdAt === 'number' ? a.data.createdAt : Number.MAX_SAFE_INTEGER;
        const bc = typeof b.data.createdAt === 'number' ? b.data.createdAt : Number.MAX_SAFE_INTEGER;
        return ac - bc;
      });

      const primaryVaultId = owned[0].id;

      const subDoc = db.collection('vaultSubscriptions').doc(primaryVaultId);
      const payload = {
        vault_id: primaryVaultId,
        tier: legacySub.tier || null,
        cancelAtPeriodEnd: !!legacySub.cancelAtPeriodEnd,
        startDate: legacySub.startDate || null,
        trialEndsAt: legacySub.trialEndsAt || null,
        renewalDate: legacySub.renewalDate || null,
        // Normalize into a rules-friendly status.
        status: legacySub.cancelAtPeriodEnd ? 'canceled' : (legacySub.tier ? 'active' : 'none'),
        updatedAt: Date.now(),
        migratedFromUserId: uid,
      };

      if (!execute) {
        console.log(`[migrate] user ${uid}: would attach subscription -> vaultSubscriptions/${primaryVaultId}`);
        stats.subscriptionsCreated += 1;
        stats.userSubscriptionsRemoved += 1;
        continue;
      }

      await subDoc.set(payload, { merge: true });
      stats.subscriptionsCreated += 1;

      // Remove user.subscription (no data loss: it's now on the vault).
      await udoc.ref.set({ subscription: admin.firestore.FieldValue.delete() }, { merge: true });
      stats.userSubscriptionsRemoved += 1;
    }
  }

  console.log('\n[migrate] done');
  console.log(stats);
};

run().catch((err) => fail(err?.message || String(err)));
