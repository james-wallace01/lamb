/*
  Fetch and print the canonical per-user subscription doc:
    /userSubscriptions/{uid}

  Usage:
    node scripts/getUserSubscription.js <uid>
    node scripts/getUserSubscription.js <uid> --watch

  Requires Firebase Admin credentials (see backend/.env).
*/

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initFirebaseAdmin, firebaseEnabled } = require('../firebaseAdmin');

const argv = process.argv.slice(2);
const uid = argv.find((a) => a && !a.startsWith('--'));
const watch = argv.includes('--watch');

const fail = (msg) => {
  console.error(`\n[getUserSubscription] ERROR: ${msg}\n`);
  process.exit(1);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runOnce = async (db, userId) => {
  try {
    const snap = await db.collection('userSubscriptions').doc(String(userId)).get();
    if (!snap.exists) {
      console.log(JSON.stringify({ ok: true, exists: false, uid: String(userId) }, null, 2));
      return;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          exists: true,
          uid: String(userId),
          data: snap.data() || {},
        },
        null,
        2
      )
    );
  } catch (err) {
    const message = err?.message || String(err);
    const details = {
      ok: false,
      uid: String(userId),
      error: message,
    };

    // Common misconfig: Firestore API disabled.
    if (/firestore api has not been used|is disabled|firestore\.googleapis\.com/i.test(message)) {
      details.hint =
        'Firestore API appears disabled for this GCP project/credentials. Enable it in Google Cloud Console (Firestore API) or point GOOGLE_APPLICATION_CREDENTIALS at the correct Firebase project.';
    }

    // Common setup gap: Firestore database not created for the project.
    if (/\bNOT_FOUND\b/i.test(message)) {
      details.hint =
        details.hint ||
        'Firestore returned NOT_FOUND. This often means the project does not have a Firestore database created yet (Firebase Console → Firestore Database → Create database), or your GOOGLE_APPLICATION_CREDENTIALS points at the wrong project.';
    }

    console.log(JSON.stringify(details, null, 2));
    process.exitCode = 2;
  }
};

(async () => {
  if (!uid) {
    fail('Missing <uid>. Usage: node scripts/getUserSubscription.js <uid> [--watch]');
  }

  initFirebaseAdmin();
  if (!firebaseEnabled()) {
    fail('Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
  }

  const admin = require('firebase-admin');
  let db;
  try {
    db = admin.firestore();
  } catch (err) {
    fail(err?.message || String(err));
  }

  if (!watch) {
    await runOnce(db, uid);
    return;
  }

  console.log(`[getUserSubscription] watching userSubscriptions/${String(uid)} (polling every 2s)…`);

  let lastPrinted = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const snap = await db.collection('userSubscriptions').doc(String(uid)).get();
      const payload = snap.exists ? snap.data() || {} : null;
      const serialized = JSON.stringify(payload);
      if (serialized !== lastPrinted) {
        lastPrinted = serialized;
        console.log(`\n--- ${new Date().toISOString()} ---`);
        await runOnce(db, uid);
      }
    } catch (err) {
      console.log(`\n--- ${new Date().toISOString()} ---`);
      console.log(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
    }

    await sleep(2000);
  }
})();
