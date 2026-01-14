#!/usr/bin/env node

require('dotenv').config();

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');
const admin = require('firebase-admin');

const usageDocRefForVault = (db, vaultId) => {
  return db.collection('vaults').doc(String(vaultId)).collection('stats').doc('usage');
};

const computeCollectionCount = async (colRef) => {
  if (!colRef) return 0;

  // Prefer Firestore server-side count aggregation when available.
  try {
    if (typeof colRef.count === 'function') {
      const agg = await colRef.count().get();
      const data = agg && typeof agg.data === 'function' ? agg.data() : {};
      const n = typeof data?.count === 'number' ? data.count : 0;
      return n;
    }
  } catch {
    // fall through
  }

  // Fallback: page through document ids.
  let total = 0;
  let last = null;
  while (true) {
    let q = colRef.orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    total += snap.size;
    if (snap.empty || snap.size < 1000) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return total;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { vaultId: null, limit: 0 };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--vault' || a === '--vaultId') {
      out.vaultId = args[i + 1] || null;
      i++;
      continue;
    }
    if (a === '--limit') {
      out.limit = Number(args[i + 1] || 0) || 0;
      i++;
      continue;
    }
  }

  return out;
};

const main = async () => {
  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    throw new Error('Firebase is not configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON (or related env vars).');
  }

  const { vaultId, limit } = parseArgs();

  const db = admin.firestore();

  const vaultIds = [];
  if (vaultId) {
    vaultIds.push(String(vaultId));
  } else {
    let q = db.collection('vaults');
    if (limit > 0) q = q.limit(limit);
    const snap = await q.get();
    for (const doc of snap.docs) vaultIds.push(doc.id);
  }

  if (vaultIds.length === 0) {
    console.log('No vaults found to recompute');
    return;
  }

  console.log(`Recomputing usage for ${vaultIds.length} vault(s)...`);

  let updated = 0;
  for (const id of vaultIds) {
    const vaultRef = db.collection('vaults').doc(String(id));
    const [assetsCount, collectionsCount] = await Promise.all([
      computeCollectionCount(vaultRef.collection('assets')),
      computeCollectionCount(vaultRef.collection('collections')),
    ]);

    const now = Date.now();
    await usageDocRefForVault(db, id).set(
      {
        assetsCount,
        collectionsCount,
        computedAt: now,
        updatedAt: now,
        recomputedAt: now,
      },
      { merge: false }
    );

    updated++;
    if (updated % 10 === 0) {
      console.log(`Updated ${updated}/${vaultIds.length}...`);
    }
  }

  console.log(`Done. Updated ${updated}/${vaultIds.length} vault(s).`);
};

main().catch((err) => {
  console.error('recomputeVaultUsage failed:', err?.message || String(err));
  process.exitCode = 1;
});
