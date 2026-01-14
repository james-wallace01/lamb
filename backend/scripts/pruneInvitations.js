#!/usr/bin/env node

require('dotenv').config();

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');
const admin = require('firebase-admin');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    days: Number(process.env.INVITATIONS_RETENTION_DAYS || 30) || 30,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--days') {
      out.days = Number(args[i + 1] || 0) || out.days;
      i++;
      continue;
    }
    if (a === '--dry-run' || a === '--dryRun') {
      out.dryRun = true;
      continue;
    }
  }

  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 30;
  return out;
};

const main = async () => {
  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    throw new Error('Firebase is not configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON (or related env vars).');
  }

  const { days, dryRun } = parseArgs();
  const db = admin.firestore();

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  console.log(
    `Pruning vault invitations older than ${days} day(s) (cutoff ${new Date(cutoffMs).toISOString()})${dryRun ? ' [DRY RUN]' : ''}`
  );

  let deleted = 0;
  while (true) {
    const snap = await db
      .collectionGroup('invitations')
      .where('createdAt', '<', cutoffMs)
      .orderBy('createdAt')
      .limit(250)
      .get();

    if (snap.empty) break;

    if (dryRun) {
      deleted += snap.size;
      console.log(`Would delete ${snap.size} (total would delete: ${deleted})`);
      break;
    }

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();

    deleted += snap.size;
    console.log(`Deleted ${snap.size} (total deleted: ${deleted})`);

    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`Done. ${dryRun ? 'Would delete' : 'Deleted'} ${deleted} invitations.`);
};

main().catch((err) => {
  console.error('pruneInvitations failed:', err?.message || String(err));
  process.exitCode = 1;
});
