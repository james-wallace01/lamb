#!/usr/bin/env node

require('dotenv').config();

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');
const admin = require('firebase-admin');

const TIER_AUDIT_RETENTION_DAYS = Object.freeze({
  BASIC: 30,
  PREMIUM: 180,
  PRO: 365,
});

const normalizeTier = (tier) => {
  const t = typeof tier === 'string' ? tier.trim().toUpperCase() : '';
  if (t === 'BASIC' || t === 'PREMIUM' || t === 'PRO') return t;
  return 'BASIC';
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    days: null, // if set, overrides tier-based retention
    dryRun: false,
    vaultLimit: Number(process.env.PRUNE_AUDIT_VAULT_LIMIT || 0) || 0,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--days') {
      out.days = Number(args[i + 1] || 0) || null;
      i++;
      continue;
    }
    if (a === '--vault-limit') {
      out.vaultLimit = Number(args[i + 1] || 0) || 0;
      i++;
      continue;
    }
    if (a === '--dry-run' || a === '--dryRun') {
      out.dryRun = true;
      continue;
    }
  }

  if (out.days != null && (!Number.isFinite(out.days) || out.days <= 0)) out.days = null;
  if (!Number.isFinite(out.vaultLimit) || out.vaultLimit < 0) out.vaultLimit = 0;
  return out;
};

const getRetentionDaysForVault = async (db, vaultId, overrideDays) => {
  if (overrideDays != null) return overrideDays;

  try {
    const vaultSnap = await db.collection('vaults').doc(String(vaultId)).get();
    const vault = vaultSnap.exists ? (vaultSnap.data() || {}) : {};
    const ownerId = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : null;

    if (ownerId) {
      const userSnap = await db.collection('userSubscriptions').doc(String(ownerId)).get();
      const userSub = userSnap.exists ? (userSnap.data() || {}) : {};
      const tier = normalizeTier(userSub.tier);
      return TIER_AUDIT_RETENTION_DAYS[tier] || TIER_AUDIT_RETENTION_DAYS.BASIC;
    }

    // Back-compat fallback.
    const legacySnap = await db.collection('vaultSubscriptions').doc(String(vaultId)).get();
    const legacy = legacySnap.exists ? (legacySnap.data() || {}) : {};
    const tier = normalizeTier(legacy.tier);
    return TIER_AUDIT_RETENTION_DAYS[tier] || TIER_AUDIT_RETENTION_DAYS.BASIC;
  } catch {
    return TIER_AUDIT_RETENTION_DAYS.BASIC;
  }
};

const deleteOldAuditEventsForVault = async (db, vaultId, cutoffMs, dryRun) => {
  let deleted = 0;

  while (true) {
    const snap = await db
      .collection('vaults')
      .doc(String(vaultId))
      .collection('auditEvents')
      .where('createdAt', '<', cutoffMs)
      .orderBy('createdAt')
      .limit(250)
      .get();

    if (snap.empty) break;

    if (dryRun) {
      deleted += snap.size;
      break;
    }

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();

    deleted += snap.size;

    await new Promise((r) => setTimeout(r, 25));
  }

  return deleted;
};

const main = async () => {
  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    throw new Error('Firebase is not configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON (or related env vars).');
  }

  const { days, dryRun, vaultLimit } = parseArgs();
  const db = admin.firestore();

  console.log(
    `Pruning vault auditEvents${days != null ? ` older than ${days} day(s)` : ' using tier-based retention'}${dryRun ? ' [DRY RUN]' : ''}`
  );

  let totalDeleted = 0;
  let processedVaults = 0;

  let last = null;
  while (true) {
    let q = db.collection('vaults').orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const vaultId = doc.id;
      processedVaults += 1;
      if (vaultLimit > 0 && processedVaults > vaultLimit) break;

      const retentionDays = await getRetentionDaysForVault(db, vaultId, days);
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const deleted = await deleteOldAuditEventsForVault(db, vaultId, cutoffMs, dryRun);
      totalDeleted += deleted;

      if (deleted > 0) {
        console.log(`Vault ${vaultId}: ${dryRun ? 'would delete' : 'deleted'} ${deleted} (retention ${retentionDays}d)`);
      }
    }

    if (vaultLimit > 0 && processedVaults >= vaultLimit) break;

    last = snap.docs[snap.docs.length - 1];
  }

  console.log(`Done. Processed ${processedVaults} vault(s). ${dryRun ? 'Would delete' : 'Deleted'} ${totalDeleted} auditEvents.`);
};

main().catch((err) => {
  console.error('pruneAuditEvents failed:', err?.message || String(err));
  process.exitCode = 1;
});
