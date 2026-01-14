#!/usr/bin/env node

require('dotenv').config();

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');
const admin = require('firebase-admin');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {
    days: Number(process.env.DAILY_USAGE_RETENTION_DAYS || 90) || 90,
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

  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 90;
  return out;
};

const getUtcDateKey = (ms) => {
  const t = typeof ms === 'number' ? ms : Date.now();
  return new Date(t).toISOString().slice(0, 10); // YYYY-MM-DD
};

const main = async () => {
  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    throw new Error('Firebase is not configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON (or related env vars).');
  }

  const { days, dryRun } = parseArgs();
  const db = admin.firestore();

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoffDateKey = getUtcDateKey(cutoffMs);

  console.log(`Pruning dailyUsage_* stats older than ${days} day(s) (dateKey < ${cutoffDateKey})${dryRun ? ' [DRY RUN]' : ''}`);

  let deleted = 0;
  while (true) {
    const snap = await db
      .collectionGroup('stats')
      .where('dateKey', '<', cutoffDateKey)
      .orderBy('dateKey')
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

  console.log(`Done. ${dryRun ? 'Would delete' : 'Deleted'} ${deleted} daily usage docs.`);
};

main().catch((err) => {
  console.error('pruneDailyUsage failed:', err?.message || String(err));
  process.exitCode = 1;
});
