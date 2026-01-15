// LAMB Backend Server
// Install dependencies: npm install express cors dotenv
// Run: node server.js

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const https = require('https');
require('dotenv').config();
const { initFirebaseAdmin, firebaseEnabled, requireFirebaseAuth } = require('./firebaseAdmin');
const firebaseAdmin = require('firebase-admin');
const { sendEmail, isEmailEnabled } = require('./email');
const {
  NOTIFICATION_CATEGORIES,
  ROLE_OWNER,
  ROLE_DELEGATE,
  getRoleDefaults,
  ensureNotificationSettings,
  getNotificationSettings,
  updateNotificationSettings,
  sendNotificationEmailIdempotent,
} = require('./notifications');

const app = express();

app.disable('x-powered-by');

app.enable('trust proxy');

// Basic security headers (API-safe defaults).
app.use(
  helmet({
    // This is an API server; we don't need CSP here and it can cause confusion.
    contentSecurityPolicy: false,
  })
);

const isProd = process.env.NODE_ENV === 'production';

const generateRequestId = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // ignore
  }
  return crypto.randomBytes(16).toString('hex');
};

const safeLogJson = (level, message, fields) => {
  const lvl = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  const payload = {
    ts: new Date().toISOString(),
    level: level || 'info',
    message: message || '',
    ...(fields && typeof fields === 'object' ? fields : {}),
  };

  try {
    console[lvl](JSON.stringify(payload));
  } catch {
    console[lvl](String(message || 'log'));
  }
};

const enforceTls = String(process.env.ENFORCE_TLS).toLowerCase() === 'true' || process.env.NODE_ENV === 'production';
if (enforceTls) {
  app.use((req, res, next) => {
    // Render (and some other platforms) may perform internal health checks over plain HTTP.
    // Keep /health reachable so deployments can become healthy.
    if (req.path === '/health') return next();
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const isSecure = req.secure || forwardedProto === 'https';
    if (isSecure) return next();
    return res.status(400).json({ error: 'TLS required' });
  });
}

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const uidOrIpKey = (req) => {
  const uid = req.firebaseUser?.uid;
  if (uid) return `uid:${String(uid)}`;
  return `ip:${String(req.ip || '')}`;
};

const makeUidRateLimiter = ({ name, windowMs, limit }) => {
  const limiterName = String(name || 'rate_limit');
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: uidOrIpKey,
    handler: (req, res, next, options) => {
      const retryAfter = typeof options?.windowMs === 'number' ? Math.ceil(options.windowMs / 1000) : null;
      return res.status(options?.statusCode || 429).json({
        error: options?.message || 'Too many requests',
        limiter: limiterName,
        requestId: req.requestId || null,
        retryAfterSeconds: retryAfter,
      });
    },
  });
};

// Email enumeration protection: keep this tighter than other auth-adjacent endpoints.
// This endpoint intentionally reveals whether an email exists, so we rate limit aggressively.
const emailAvailabilityRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoint-specific abuse controls (prefer uid-based throttling when authed).
const writeRateLimiter = makeUidRateLimiter({ name: 'write_ops', windowMs: 15 * 60 * 1000, limit: 300 });
const destructiveRateLimiter = makeUidRateLimiter({ name: 'destructive_ops', windowMs: 15 * 60 * 1000, limit: 60 });
const inviteRateLimiter = makeUidRateLimiter({ name: 'invite_ops', windowMs: 15 * 60 * 1000, limit: 30 });
const securityNotifyRateLimiter = makeUidRateLimiter({ name: 'security_notify', windowMs: 15 * 60 * 1000, limit: 20 });
const billingRateLimiter = makeUidRateLimiter({ name: 'billing', windowMs: 15 * 60 * 1000, limit: 60 });
const vaultDeleteRateLimiter = makeUidRateLimiter({ name: 'vault_delete', windowMs: 60 * 60 * 1000, limit: 5 });
const accountDeleteRateLimiter = makeUidRateLimiter({ name: 'account_delete', windowMs: 60 * 60 * 1000, limit: 3 });

// CORS is a browser security feature; native mobile clients are not restricted by it.
// In production, if no allowlist is configured, explicitly block requests that include an Origin header.
// This prevents arbitrary websites from calling the API in a browser context.
const corsAllowlist = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (isProd && corsAllowlist.length === 0) {
  app.use((req, res, next) => {
    if (req.headers.origin) {
      return res.status(403).json({ error: 'CORS forbidden' });
    }
    return next();
  });
} else {
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser requests (no Origin header).
        if (!origin) return callback(null, true);

        // If no allowlist is set (typical dev), allow all origins.
        if (!isProd && corsAllowlist.length === 0) return callback(null, true);

        // Production (or configured dev): allow only explicit origins.
        if (corsAllowlist.includes(origin)) return callback(null, true);

        return callback(null, false);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      credentials: false,
      maxAge: 86400,
      optionsSuccessStatus: 204,
    })
  );
}

// Correlation IDs + request logging (avoid logging bodies to reduce PII risk).
app.use((req, res, next) => {
  const inbound = req.headers['x-request-id'];
  const requestId = typeof inbound === 'string' && inbound.trim() ? inbound.trim().slice(0, 128) : generateRequestId();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    const urlNoQuery = String(req.originalUrl || req.url || '').split('?')[0];
    safeLogJson('info', 'request', {
      requestId,
      method: req.method,
      path: urlNoQuery,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      uid: req.firebaseUser?.uid ? String(req.firebaseUser.uid) : null,
    });
  });

  return next();
});

// Serve branded static images (used for default hero images on mobile).
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

const PORT = process.env.PORT || 3001;

const getFirestoreDb = () => {
  if (!firebaseEnabled()) return null;
  try {
    return firebaseAdmin.firestore();
  } catch {
    return null;
  }
};

const revokePaidFeaturesForOwner = async (db, ownerUid, { actorUid = 'system', reason } = {}) => {
  if (!db || !ownerUid) return;
  // Best-effort: most users will have a small number of owned vaults.
  const snap = await db.collection('vaults').where('activeOwnerId', '==', String(ownerUid)).limit(100).get();
  for (const doc of snap.docs) {
    try {
      await revokePaidFeaturesForVault(db, doc.id, { actorUid, reason });
    } catch (err) {
      console.warn('[subscription] downgrade cleanup failed', { vaultId: doc.id, message: err?.message || String(err) });
    }
  }
};

// Optional Firebase Admin initialization (used for verifying Firebase ID tokens)
initFirebaseAdmin();

const maybeRequireFirebaseAuth = (req, res, next) => {
  const requireAuth = process.env.NODE_ENV === 'production' || String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true';
  if (!requireAuth) return next();
  return requireFirebaseAuth(req, res, next);
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getPublicAppName = () => String(process.env.PUBLIC_APP_NAME || 'LAMB').trim() || 'LAMB';

const getAdminAlertEmail = () => {
  const email = normalizeEmail(process.env.ADMIN_ALERT_EMAIL);
  return email && email.includes('@') ? email : null;
};

const sendAdminAlertEmailBestEffort = async ({ db, dedupeKey, subject, text, requestId } = {}) => {
  try {
    if (!db) return { ok: false, skipped: true };
    const to = getAdminAlertEmail();
    if (!to) return { ok: false, skipped: true };

    const appName = getPublicAppName();
    const safeSubject = String(subject || `${appName} alert`).slice(0, 200);
    const safeText = String(text || '').slice(0, 4000);

    return await sendNotificationEmailIdempotent({
      db,
      dedupeKey: String(dedupeKey || `admin-alert:${Date.now()}`),
      category: NOTIFICATION_CATEGORIES.security,
      to,
      recipientUid: null,
      recipientRole: ROLE_OWNER,
      vaultId: null,
      auditEventId: null,
      subject: safeSubject,
      text: safeText || `RequestId: ${requestId || 'unknown'}`,
      html: null,
      // Security category is mandatory, but keep this explicit.
      defaultOptInIfNoSettings: true,
    });
  } catch {
    return { ok: false, skipped: true };
  }
};

const buildInviteEmail = ({ code } = {}) => {
  const appName = getPublicAppName();
  const safeCode = String(code || '').trim();
  const lines = [
    `You've been invited to join a shared vault in ${appName}.`,
    '',
    'To accept:',
    '1) Open the app',
    '2) Go to Home',
    '3) Paste this invite code:',
    '',
    safeCode,
    '',
    "If you weren't expecting this invite, you can ignore this email.",
  ];
  return {
    subject: `${appName} vault invitation`,
    text: lines.join('\n'),
    html: `<p>You've been invited to join a shared vault in <b>${appName}</b>.</p>
<p><b>Invite code:</b> <code>${safeCode}</code></p>
<p>Open the app → Home → paste the invite code to accept.</p>
<p style="color:#666">If you weren't expecting this invite, you can ignore this email.</p>`,
  };
};

const buildUsernameChangedEmail = ({ oldUsername, newUsername } = {}) => {
  const appName = getPublicAppName();
  const now = new Date();
  const lines = [
    `Your ${appName} username was changed.`,
    '',
    `Old: ${oldUsername || '(unknown)'}`,
    `New: ${newUsername || '(unknown)'}`,
    '',
    `Time: ${now.toISOString()}`,
    '',
    'If you did not make this change, please secure your account immediately.',
  ];
  return {
    subject: `${appName} username changed`,
    text: lines.join('\n'),
  };
};

const buildPasswordChangedEmail = () => {
  const appName = getPublicAppName();
  const now = new Date();
  const lines = [
    `Your ${appName} password was changed.`,
    '',
    `Time: ${now.toISOString()}`,
    '',
    'If you did not make this change, please secure your account immediately.',
  ];
  return {
    subject: `${appName} password changed`,
    text: lines.join('\n'),
  };
};

const buildSubscriptionStartedEmail = ({ vaultName } = {}) => {
  const appName = getPublicAppName();
  const safeVault = vaultName ? String(vaultName) : 'your vault';
  return {
    subject: `Subscription started for “${safeVault}”`,
    text: [
      `Your ${appName} subscription is active for the vault “${safeVault}”.`,
      '',
      'If you did not expect this, review your billing settings immediately.',
    ].join('\n'),
  };
};

const buildSubscriptionCancelledEmail = ({ vaultName } = {}) => {
  const appName = getPublicAppName();
  const safeVault = vaultName ? String(vaultName) : 'your vault';
  return {
    subject: `Your subscription has been cancelled`,
    text: [
      `Your ${appName} subscription for the vault “${safeVault}” has been cancelled.`,
      '',
      'You will retain access until the end of the billing period (if applicable).',
      '',
      'If this wasn’t expected, review your subscription settings.',
    ].join('\n'),
  };
};

const buildPaymentFailedEmail = ({ vaultName } = {}) => {
  const appName = getPublicAppName();
  const safeVault = vaultName ? String(vaultName) : 'your vault';
  return {
    subject: `Payment failed for “${safeVault}”`,
    text: [
      `We couldn’t process a payment for your ${appName} subscription on the vault “${safeVault}”.`,
      '',
      'To avoid interruptions, update your payment method as soon as possible.',
    ].join('\n'),
  };
};

const getUserEmailAndName = async (db, uid) => {
  if (!db || !uid) return { email: null, name: null };
  const snap = await db.collection('users').doc(String(uid)).get();
  const d = snap.exists ? (snap.data() || {}) : {};
  const email = normalizeEmail(d.email) || null;
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.username || null;
  return { email, name };
};
const sendBillingEmailToVaultOwner = async ({ db, vaultId, type, billingEventId } = {}) => {
  if (!db || !vaultId || !type) return { ok: false, skipped: true };

  const vaultSnap = await db.collection('vaults').doc(String(vaultId)).get();
  const vault = vaultSnap.exists ? (vaultSnap.data() || {}) : {};
  const ownerUid = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : null;
  if (!ownerUid) return { ok: false, skipped: true };

  const { email } = await getUserEmailAndName(db, ownerUid);
  if (!email) return { ok: false, skipped: true };

  const vaultName = vault.name || null;

  const msg =
    type === 'SUBSCRIPTION_STARTED'
      ? buildSubscriptionStartedEmail({ vaultName })
      : type === 'SUBSCRIPTION_CANCELLED'
        ? buildSubscriptionCancelledEmail({ vaultName })
        : buildPaymentFailedEmail({ vaultName });

  const auditEventId = await writeUserAuditEvent(db, ownerUid, {
    type,
    actorUid: 'system',
    payload: { vault_id: String(vaultId), billing_event_id: billingEventId || null },
  });

  return await sendNotificationEmailIdempotent({
    db,
    dedupeKey: `billing:${String(billingEventId || 'unknown')}:vault:${String(vaultId)}:owner:${String(ownerUid)}:type:${String(type)}`,
    category: NOTIFICATION_CATEGORIES.billing,
    to: email,
    recipientUid: String(ownerUid),
    recipientRole: ROLE_OWNER,
    vaultId: String(vaultId),
    auditEventId,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
};

const isPaidStatus = (status) => {
  const s = typeof status === 'string' ? status : '';
  return s === 'active' || s === 'trialing' || s === 'past_due';
};

const normalizeTier = (tier) => {
  const t = typeof tier === 'string' ? tier.trim().toUpperCase() : '';
  if (t === 'BASIC' || t === 'PREMIUM' || t === 'PRO') return t;
  return 'BASIC';
};

const TIER_LIMITS = Object.freeze({
  BASIC: Object.freeze({
    maxMembers: 2, // owner + 1 delegate
    maxDelegates: 1,
    maxAssets: 1000,
    maxCollections: 200,
    auditRetentionDays: 30,
    maxBulkOpsPerDay: 10,
    maxWriteOpsPerDay: 2000,
    maxDestructiveOpsPerDay: 500,
    maxInviteOpsPerDay: 100,
  }),
  PREMIUM: Object.freeze({
    maxMembers: 6,
    maxDelegates: 5,
    maxAssets: 10000,
    maxCollections: 1000,
    auditRetentionDays: 180,
    maxBulkOpsPerDay: 50,
    maxWriteOpsPerDay: 10000,
    maxDestructiveOpsPerDay: 2000,
    maxInviteOpsPerDay: 500,
  }),
  PRO: Object.freeze({
    maxMembers: 21,
    maxDelegates: 20,
    maxAssets: 50000,
    maxCollections: 5000,
    auditRetentionDays: 365,
    maxBulkOpsPerDay: 200,
    maxWriteOpsPerDay: 50000,
    maxDestructiveOpsPerDay: 10000,
    maxInviteOpsPerDay: 2000,
  }),
});

const getTierLimits = (tier) => {
  const t = normalizeTier(tier);
  return TIER_LIMITS[t] || TIER_LIMITS.BASIC;
};

const getUserSubscriptionOrNull = async (db, userId) => {
  if (!db || !userId) return null;
  try {
    const snap = await db.collection('userSubscriptions').doc(String(userId)).get();
    return snap.exists ? (snap.data() || {}) : null;
  } catch {
    return null;
  }
};

const getVaultOwnerIdOrNull = async (db, vaultId) => {
  if (!db || !vaultId) return null;
  try {
    const snap = await db.collection('vaults').doc(String(vaultId)).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const ownerId = typeof data.activeOwnerId === 'string' ? data.activeOwnerId : null;
    return ownerId ? String(ownerId) : null;
  } catch {
    return null;
  }
};

const getLegacyVaultSubscriptionOrNull = async (db, vaultId) => {
  if (!db || !vaultId) return null;
  try {
    const snap = await db.collection('vaultSubscriptions').doc(String(vaultId)).get();
    return snap.exists ? (snap.data() || {}) : null;
  } catch {
    return null;
  }
};

const getVaultTier = async (db, vaultId) => {
  if (!db || !vaultId) return 'BASIC';
  const ownerId = await getVaultOwnerIdOrNull(db, vaultId);
  if (ownerId) {
    const userSub = await getUserSubscriptionOrNull(db, ownerId);
    if (userSub) return normalizeTier(userSub.tier);
  }

  // Back-compat fallback: legacy per-vault subscription doc.
  const legacy = await getLegacyVaultSubscriptionOrNull(db, vaultId);
  if (legacy) return normalizeTier(legacy.tier);

  return 'BASIC';
};

const assertUnderDelegateLimit = async (db, vaultId) => {
  const tier = await getVaultTier(db, vaultId);
  const limits = getTierLimits(tier);
  const maxDelegates = Number.isFinite(limits.maxDelegates) ? limits.maxDelegates : 0;

  // Paid feature implies at least 1 delegate allowed, but be defensive.
  if (maxDelegates <= 0) {
    return { ok: false, status: 403, error: 'Delegate limit reached' };
  }

  const snap = await db
    .collection('vaults')
    .doc(String(vaultId))
    .collection('memberships')
    .where('role', '==', 'DELEGATE')
    .where('status', '==', 'ACTIVE')
    .limit(maxDelegates + 1)
    .get();

  if (snap.size > maxDelegates) {
    return {
      ok: false,
      status: 403,
      error: `Delegate limit reached for ${tier} tier (max ${maxDelegates})`,
      tier,
      limits,
    };
  }

  return { ok: true, tier, limits, activeDelegates: snap.size };
};

const makeRandomId = (prefix) => {
  const p = typeof prefix === 'string' ? prefix : '';
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  return `${p}${ts}_${rand}`;
};

const getVaultUsageRef = (db, vaultId) => {
  return db.collection('vaults').doc(String(vaultId)).collection('stats').doc('usage');
};

const computeCollectionCount = async (colRef) => {
  if (!colRef) return 0;
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
    let q = colRef.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    total += snap.size;
    if (snap.empty || snap.size < 1000) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return total;
};

const ensureVaultUsage = async (db, vaultId) => {
  const ref = getVaultUsageRef(db, vaultId);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data() || {};
    return {
      assetsCount: typeof d.assetsCount === 'number' ? d.assetsCount : 0,
      collectionsCount: typeof d.collectionsCount === 'number' ? d.collectionsCount : 0,
    };
  }

  const vaultRef = db.collection('vaults').doc(String(vaultId));
  const [assetsCount, collectionsCount] = await Promise.all([
    computeCollectionCount(vaultRef.collection('assets')),
    computeCollectionCount(vaultRef.collection('collections')),
  ]);

  await ref.set(
    {
      assetsCount,
      collectionsCount,
      computedAt: Date.now(),
      updatedAt: Date.now(),
    },
    { merge: false }
  );

  return { assetsCount, collectionsCount };
};

const shouldDisableDailyQuotas = () => String(process.env.DISABLE_DAILY_QUOTAS).toLowerCase() === 'true';

const getUtcDateKey = (ms) => {
  const t = typeof ms === 'number' ? ms : Date.now();
  return new Date(t).toISOString().slice(0, 10); // YYYY-MM-DD
};

const getVaultDailyUsageRef = (db, vaultId, dateKey) => {
  const day = String(dateKey || getUtcDateKey());
  return db.collection('vaults').doc(String(vaultId)).collection('stats').doc(`dailyUsage_${day}`);
};

const assertAndIncrementVaultDailyQuota = async (db, vaultId, { kind, delta = 1, actorUid } = {}) => {
  if (!db || !vaultId) return { ok: true, skipped: true };
  if (shouldDisableDailyQuotas()) return { ok: true, skipped: true };

  const safeDelta = Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 1;
  const dateKey = getUtcDateKey();

  const tier = await getVaultTier(db, vaultId);
  const limits = getTierLimits(tier);

  const kindKey = String(kind || '').toLowerCase();
  const field =
    kindKey === 'invite'
      ? 'inviteOps'
      : kindKey === 'destructive'
        ? 'destructiveOps'
        : kindKey === 'bulk'
          ? 'bulkOps'
          : 'writeOps';

  const max =
    field === 'inviteOps'
      ? Number.isFinite(limits.maxInviteOpsPerDay)
        ? limits.maxInviteOpsPerDay
        : 0
      : field === 'destructiveOps'
        ? Number.isFinite(limits.maxDestructiveOpsPerDay)
          ? limits.maxDestructiveOpsPerDay
          : 0
        : field === 'bulkOps'
          ? Number.isFinite(limits.maxBulkOpsPerDay)
            ? limits.maxBulkOpsPerDay
            : 0
          : Number.isFinite(limits.maxWriteOpsPerDay)
            ? limits.maxWriteOpsPerDay
            : 0;

  const ref = getVaultDailyUsageRef(db, vaultId, dateKey);
  const now = Date.now();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? (snap.data() || {}) : {};
      const current = typeof d[field] === 'number' ? d[field] : 0;

      if (max > 0 && current + safeDelta > max) {
        const e = new Error('Daily quota exceeded');
        e.status = 429;
        e.code = 'DAILY_QUOTA_EXCEEDED';
        e.current = current;
        e.max = max;
        e.field = field;
        throw e;
      }

      tx.set(
        ref,
        {
          dateKey,
          vaultId: String(vaultId),
          updatedAt: now,
          createdAt: typeof d.createdAt === 'number' ? d.createdAt : now,
          updatedBy: actorUid ? String(actorUid) : null,
          [field]: firebaseAdmin.firestore.FieldValue.increment(safeDelta),
        },
        { merge: true }
      );
    });

    return { ok: true, tier, limits, dateKey, field };
  } catch (err) {
    if (err && err.code === 'DAILY_QUOTA_EXCEEDED') {
      return {
        ok: false,
        status: err.status || 429,
        error: `Daily quota exceeded for ${tier} tier`,
        tier,
        limits,
        dateKey,
        kind: kindKey || 'write',
        field: err.field || field,
        current: typeof err.current === 'number' ? err.current : null,
        max: typeof err.max === 'number' ? err.max : null,
      };
    }

    return { ok: false, status: 500, error: err?.message || 'Daily quota check failed' };
  }
};

const getGrantDoc = async (db, vaultId, { scopeType, scopeId, userId }) => {
  if (!db || !vaultId || !scopeType || !scopeId || !userId) return null;
  const id = `${String(scopeType)}:${String(scopeId)}:${String(userId)}`;
  const snap = await db.collection('vaults').doc(String(vaultId)).collection('permissionGrants').doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: snap.data() || {} };
};

const canVaultCreate = (membershipData) => {
  if (!membershipData) return false;
  if (membershipData.role === 'OWNER') return true;
  const perms = membershipData.permissions && typeof membershipData.permissions === 'object' ? membershipData.permissions : null;
  return !!(perms && perms.Create === true);
};

const assertCanCreateCollection = async (db, vaultId, uid) => {
  const m = await getMembershipDoc(db, vaultId, uid);
  if (!m) return { ok: false, status: 403, error: 'Not a vault member' };
  if ((m.data || {}).status !== 'ACTIVE') return { ok: false, status: 403, error: 'Membership inactive' };
  if (canVaultCreate(m.data)) return { ok: true };
  return { ok: false, status: 403, error: 'Create permission required' };
};

const assertCanCreateAsset = async (db, vaultId, uid, collectionId) => {
  const m = await getMembershipDoc(db, vaultId, uid);
  if (!m) return { ok: false, status: 403, error: 'Not a vault member' };
  if ((m.data || {}).status !== 'ACTIVE') return { ok: false, status: 403, error: 'Membership inactive' };
  if (m.data.role === 'OWNER') return { ok: true };
  if (canVaultCreate(m.data)) return { ok: true };

  if (collectionId) {
    const grant = await getGrantDoc(db, vaultId, { scopeType: 'COLLECTION', scopeId: collectionId, userId: uid });
    const perms = grant && grant.data && typeof grant.data.permissions === 'object' ? grant.data.permissions : null;
    if (perms && perms.Create === true) return { ok: true };
  }

  return { ok: false, status: 403, error: 'Create permission required' };
};

const assertUnderCollectionLimit = async (db, vaultId) => {
  const tier = await getVaultTier(db, vaultId);
  const limits = getTierLimits(tier);
  const max = Number.isFinite(limits.maxCollections) ? limits.maxCollections : 0;
  if (max <= 0) return { ok: false, status: 403, error: 'Collection limit reached' };
  await ensureVaultUsage(db, vaultId);

  const ref = getVaultUsageRef(db, vaultId);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() || {}) : {};
  const collectionsCount = typeof d.collectionsCount === 'number' ? d.collectionsCount : 0;
  if (collectionsCount >= max) {
    return { ok: false, status: 403, error: `Collection limit reached for ${tier} tier (max ${max})`, tier, limits };
  }
  return { ok: true, tier, limits, collectionsCount };
};

const assertUnderAssetLimit = async (db, vaultId) => {
  const tier = await getVaultTier(db, vaultId);
  const limits = getTierLimits(tier);
  const max = Number.isFinite(limits.maxAssets) ? limits.maxAssets : 0;
  if (max <= 0) return { ok: false, status: 403, error: 'Asset limit reached' };
  await ensureVaultUsage(db, vaultId);

  const ref = getVaultUsageRef(db, vaultId);
  const snap = await ref.get();
  const d = snap.exists ? (snap.data() || {}) : {};
  const assetsCount = typeof d.assetsCount === 'number' ? d.assetsCount : 0;
  if (assetsCount >= max) {
    return { ok: false, status: 403, error: `Asset limit reached for ${tier} tier (max ${max})`, tier, limits };
  }
  return { ok: true, tier, limits, assetsCount };
};

const getMembershipDoc = async (db, vaultId, userId) => {
  const snap = await db.collection('vaults').doc(String(vaultId)).collection('memberships').doc(String(userId)).get();
  return snap.exists ? { id: snap.id, data: snap.data() || {} } : null;
};

const assertOwnerForVaultUid = async (db, vaultId, uid) => {
  if (!uid) return { ok: false, status: 401, error: 'Missing authenticated user' };
  if (!vaultId) return { ok: false, status: 400, error: 'Missing vaultId' };

  const m = await getMembershipDoc(db, vaultId, uid);
  if (!m) return { ok: false, status: 403, error: 'Not a vault member' };

  const role = m.data.role;
  const membershipStatus = m.data.status;
  if (membershipStatus !== 'ACTIVE') return { ok: false, status: 403, error: 'Membership inactive' };
  if (role !== 'OWNER') return { ok: false, status: 403, error: 'Owner permission required' };

  return { ok: true };
};

const assertOwnerForVault = async (db, vaultId, firebaseUser) => {
  if (!firebaseUser?.uid) return { ok: false, status: 401, error: 'Missing authenticated user' };
  if (!vaultId) return { ok: false, status: 400, error: 'Missing vaultId' };

  const m = await getMembershipDoc(db, vaultId, firebaseUser.uid);
  if (!m) return { ok: false, status: 403, error: 'Not a vault member' };

  const role = m.data.role;
  const membershipStatus = m.data.status;
  if (membershipStatus !== 'ACTIVE') return { ok: false, status: 403, error: 'Membership inactive' };
  if (role !== 'OWNER') return { ok: false, status: 403, error: 'Owner permission required' };

  return { ok: true };
};

const assertVaultPaid = async (db, vaultId) => {
  const ownerId = await getVaultOwnerIdOrNull(db, vaultId);
  const userSub = ownerId ? await getUserSubscriptionOrNull(db, ownerId) : null;
  const legacySub = userSub ? null : await getLegacyVaultSubscriptionOrNull(db, vaultId);
  const data = userSub || legacySub || {};
  const status = data.status;
  if (!isPaidStatus(status)) {
    return { ok: false, status: 402, error: 'Vault is not on a paid plan' };
  }
  return { ok: true, subscription: data, ownerId: ownerId || null };
};

const writeAuditEventIfPaid = async (db, vaultId, { type, actorUid, payload }) => {
  const paid = await assertVaultPaid(db, vaultId);
  if (!paid.ok) return;

  const id = `ae_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  await db.collection('vaults').doc(String(vaultId)).collection('auditEvents').doc(id).set(
    {
      id,
      vault_id: String(vaultId),
      type: String(type || 'UNKNOWN'),
      actor_uid: actorUid ? String(actorUid) : null,
      createdAt: Date.now(),
      payload: payload || null,
    },
    { merge: false }
  );

  return id;
};

// Best-effort: audit quota exceeded, but keep it bounded to avoid turning quota denial into a write-amplification vector.
// This intentionally logs at most once per (vaultId, actorUid, kind, dateKey) per server instance.
const quotaExceededAuditCache = new Map();
const QUOTA_EXCEEDED_AUDIT_CACHE_TTL_MS = 10 * 60 * 1000;

const maybeWriteDailyQuotaExceededAuditOnceIfPaid = async (db, vaultId, { actorUid, quota, kind, requestId, path }) => {
  if (!db || !vaultId || !actorUid) return;
  if (!quota || quota.ok !== false) return;
  if (quota.status !== 429) return;
  if (!quota.dateKey) return;

  const now = Date.now();
  const dateKey = String(quota.dateKey);
  const kindKey = String(kind || quota.kind || '').toLowerCase() || 'write';
  const cacheKey = `${dateKey}:${String(vaultId)}:${String(actorUid)}:${kindKey}`;

  const existing = quotaExceededAuditCache.get(cacheKey);
  if (existing && typeof existing.expiresAt === 'number' && existing.expiresAt > now) return;
  quotaExceededAuditCache.set(cacheKey, { expiresAt: now + QUOTA_EXCEEDED_AUDIT_CACHE_TTL_MS });

  // Opportunistic cleanup.
  if (quotaExceededAuditCache.size > 5000) {
    for (const [k, v] of quotaExceededAuditCache.entries()) {
      if (!v || typeof v.expiresAt !== 'number' || v.expiresAt <= now) quotaExceededAuditCache.delete(k);
    }
  }

  const paid = await assertVaultPaid(db, vaultId);
  if (!paid.ok) return;

  const hash = crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 20);
  const id = `qex_${dateKey}_${hash}`;
  const ref = db.collection('vaults').doc(String(vaultId)).collection('auditEvents').doc(id);

  try {
    await ref.create({
      id,
      vault_id: String(vaultId),
      type: 'DAILY_QUOTA_EXCEEDED',
      actor_uid: String(actorUid),
      createdAt: now,
      payload: {
        dateKey,
        kind: kindKey,
        tier: quota.tier || null,
        field: quota.field || null,
        current: typeof quota.current === 'number' ? quota.current : null,
        max: typeof quota.max === 'number' ? quota.max : null,
        request_id: requestId || null,
        path: path || null,
      },
    });
  } catch (err) {
    // Ignore already-exists and any best-effort audit failures.
  }
};

const writeUserAuditEvent = async (db, userId, { type, actorUid, payload } = {}) => {
  if (!db || !userId) return null;
  const uid = String(userId);
  const id = `uae_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  await db
    .collection('userAuditEvents')
    .doc(uid)
    .collection('events')
    .doc(id)
    .set(
      {
        id,
        user_id: uid,
        type: String(type || 'UNKNOWN'),
        actor_uid: actorUid ? String(actorUid) : null,
        createdAt: Date.now(),
        payload: payload || null,
      },
      { merge: false }
    );
  return id;
};

const roleForMembership = (m) => {
  const role = m?.data?.role;
  return role === 'OWNER' ? ROLE_OWNER : ROLE_DELEGATE;
};

const chunkArray = (arr, size) => {
  const list = Array.isArray(arr) ? arr : [];
  const s = Math.max(1, Number(size) || 400);
  const out = [];
  for (let i = 0; i < list.length; i += s) out.push(list.slice(i, i + s));
  return out;
};

const revokePaidFeaturesForVault = async (db, vaultId, { actorUid, reason } = {}) => {
  if (!db || !vaultId) return;

  const vaultRef = db.collection('vaults').doc(String(vaultId));
  const membershipsRef = vaultRef.collection('memberships');
  const grantsRef = vaultRef.collection('permissionGrants');
  const invitesRef = vaultRef.collection('invitations');

  // Revoke delegates (paid feature).
  const delegateSnap = await membershipsRef.where('role', '==', 'DELEGATE').limit(500).get();
  const delegateDocs = delegateSnap.docs
    .map((d) => ({ ref: d.ref, data: d.data() || {} }))
    .filter((x) => x.data.status === 'ACTIVE');

  for (const group of chunkArray(delegateDocs, 400)) {
    const batch = db.batch();
    group.forEach(({ ref }) => {
      batch.set(ref, { status: 'REVOKED', revoked_at: Date.now(), revokedBy: actorUid ? String(actorUid) : 'system' }, { merge: true });
    });
    await batch.commit();
  }

  // Remove all scoped grants (paid feature).
  const grantsSnap = await grantsRef.limit(500).get();
  for (const group of chunkArray(grantsSnap.docs, 400)) {
    const batch = db.batch();
    group.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // Revoke pending invitations (paid feature).
  const invSnap = await invitesRef.limit(500).get();
  const pendingInvRefs = invSnap.docs
    .map((d) => ({ ref: d.ref, data: d.data() || {} }))
    .filter((x) => x.data.status === 'PENDING');

  for (const group of chunkArray(pendingInvRefs, 400)) {
    const batch = db.batch();
    group.forEach(({ ref }) => {
      batch.set(ref, { status: 'REVOKED', revokedAt: Date.now(), revokedBy: actorUid ? String(actorUid) : 'system', revokeReason: reason || 'DOWNGRADED' }, { merge: true });
    });
    await batch.commit();
  }
};

const deleteCollectionInPages = async (colRef, { pageSize = 400 } = {}) => {
  // Paginate using document name ordering to avoid requiring additional indexes.
  let last = null;
  while (true) {
    let q = colRef.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = colRef.firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
};

const deleteVaultRecursive = async (db, vaultId) => {
  const vaultRef = db.collection('vaults').doc(String(vaultId));

  // Delete known subcollections first.
  const subcollections = ['assets', 'collections', 'memberships', 'permissionGrants', 'invitations', 'auditEvents', 'stats'];
  for (const name of subcollections) {
    await deleteCollectionInPages(vaultRef.collection(name));
  }

  // Delete the vault doc.
  await vaultRef.delete();
};

const deleteGrantsByPrefix = async (db, vaultId, prefix) => {
  if (!prefix) return;
  const grantsRef = db.collection('vaults').doc(String(vaultId)).collection('permissionGrants');
  const snap = await grantsRef.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).get();
  const targets = snap.docs.filter((d) => String(d.id).startsWith(prefix));
  for (const group of chunkArray(targets, 400)) {
    const batch = db.batch();
    group.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
};

const deleteGrantsByPrefixes = async (db, vaultId, prefixes) => {
  const list = Array.isArray(prefixes) ? prefixes.map((p) => String(p || '')).filter(Boolean) : [];
  if (list.length === 0) return;

  const prefixSet = new Set(list);
  const grantsRef = db.collection('vaults').doc(String(vaultId)).collection('permissionGrants');
  const snap = await grantsRef.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).get();
  const targets = snap.docs.filter((d) => {
    const id = String(d.id);
    for (const p of prefixSet) {
      if (id.startsWith(p)) return true;
    }
    return false;
  });

  for (const group of chunkArray(targets, 400)) {
    const batch = db.batch();
    group.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
};

const moveAssetAcrossVaults = async (db, { sourceVaultId, assetId, targetVaultId, targetCollectionId, actorUid }) => {
  const sourceRef = db.collection('vaults').doc(String(sourceVaultId)).collection('assets').doc(String(assetId));
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) return { ok: false, status: 404, error: 'Asset not found' };
  const source = sourceSnap.data() || {};

  const targetAssets = db.collection('vaults').doc(String(targetVaultId)).collection('assets');
  const targetRef = targetAssets.doc(String(assetId));
  const targetSnap = await targetRef.get();

  const outId = targetSnap.exists ? `a_${Date.now()}_${crypto.randomBytes(6).toString('hex')}` : String(assetId);
  const finalTargetRef = targetAssets.doc(outId);

  const now = Date.now();
  const movedDoc = {
    ...source,
    id: outId,
    vaultId: String(targetVaultId),
    vault_id: String(targetVaultId),
    collectionId: String(targetCollectionId),
    editedAt: now,
    movedAt: now,
    movedFrom: { vaultId: String(sourceVaultId), assetId: String(assetId) },
  };

  const batch = db.batch();
  batch.set(finalTargetRef, movedDoc, { merge: false });
  batch.delete(sourceRef);
  await batch.commit();

  // Remove old grants for this asset in the source vault.
  await deleteGrantsByPrefix(db, sourceVaultId, `ASSET:${String(assetId)}:`);

  await writeAuditEventIfPaid(db, sourceVaultId, {
    type: 'ASSET_MOVED_OUT',
    actorUid,
    payload: { asset_id: String(assetId), to_vault_id: String(targetVaultId), to_collection_id: String(targetCollectionId), new_asset_id: outId },
  });
  await writeAuditEventIfPaid(db, targetVaultId, {
    type: 'ASSET_MOVED_IN',
    actorUid,
    payload: { asset_id: outId, from_vault_id: String(sourceVaultId), from_asset_id: String(assetId), to_collection_id: String(targetCollectionId) },
  });

  return { ok: true, assetId: outId };
};

const moveCollectionAcrossVaults = async (db, { sourceVaultId, collectionId, targetVaultId, actorUid }) => {
  const sourceColRef = db.collection('vaults').doc(String(sourceVaultId)).collection('collections').doc(String(collectionId));
  const sourceSnap = await sourceColRef.get();
  if (!sourceSnap.exists) return { ok: false, status: 404, error: 'Collection not found' };
  const source = sourceSnap.data() || {};

  const targetCols = db.collection('vaults').doc(String(targetVaultId)).collection('collections');
  const targetRef = targetCols.doc(String(collectionId));
  const targetSnap = await targetRef.get();

  const outId = targetSnap.exists ? `c_${Date.now()}_${crypto.randomBytes(6).toString('hex')}` : String(collectionId);
  const finalTargetRef = targetCols.doc(outId);

  const now = Date.now();
  const movedCol = {
    ...source,
    id: outId,
    vaultId: String(targetVaultId),
    editedAt: now,
    movedAt: now,
    movedFrom: { vaultId: String(sourceVaultId), collectionId: String(collectionId) },
  };

  // Create the destination collection doc first.
  await db.batch().set(finalTargetRef, movedCol, { merge: false }).commit();

  // Move all assets in this collection (paginate; avoid 500-doc limits).
  const assetsRef = db.collection('vaults').doc(String(sourceVaultId)).collection('assets');
  const movedAssetIds = [];
  let last = null;
  while (true) {
    let q = assetsRef
      .where('collectionId', '==', String(collectionId))
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => {
      const a = d.data() || {};
      const targetAssetRef = db.collection('vaults').doc(String(targetVaultId)).collection('assets').doc(String(d.id));
      batch.set(targetAssetRef, { ...a, vaultId: String(targetVaultId), collectionId: outId, editedAt: now }, { merge: false });
      batch.delete(d.ref);
      movedAssetIds.push(String(d.id));
    });
    await batch.commit();

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }

  // Delete the source collection doc last.
  await sourceColRef.delete();

  // Remove collection + asset grants in source vault.
  // Collection grants are prefix-addressable; asset grants are prefix-addressable by asset id.
  await deleteGrantsByPrefixes(db, sourceVaultId, [
    `COLLECTION:${String(collectionId)}:`,
    ...movedAssetIds.map((aId) => `ASSET:${aId}:`),
  ]);

  await writeAuditEventIfPaid(db, sourceVaultId, {
    type: 'COLLECTION_MOVED_OUT',
    actorUid,
    payload: { collection_id: String(collectionId), to_vault_id: String(targetVaultId), new_collection_id: outId, moved_asset_ids: movedAssetIds },
  });
  await writeAuditEventIfPaid(db, targetVaultId, {
    type: 'COLLECTION_MOVED_IN',
    actorUid,
    payload: { collection_id: outId, from_vault_id: String(sourceVaultId), from_collection_id: String(collectionId), moved_asset_ids: movedAssetIds },
  });

  return { ok: true, collectionId: outId, movedAssetIds };
};

const generateInviteCode = (vaultId) => {
  const rand = crypto.randomBytes(9).toString('base64url');
  return `${String(vaultId)}_${rand}`;
};

// JSON parser for all non-webhook routes.
app.use(express.json({ limit: '1mb' }));

// ---- Apple IAP (Option A) ----

const APPLE_VERIFY_URL_PROD = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_VERIFY_URL_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';

const postJson = (url, payload) =>
  new Promise((resolve, reject) => {
    try {
      const json = JSON.stringify(payload || {});
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
          },
          timeout: 15_000,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = body ? JSON.parse(body) : null;
              resolve({ statusCode: res.statusCode || 0, body: parsed });
            } catch {
              reject(new Error(`Invalid JSON from Apple verifyReceipt (status ${res.statusCode || 0})`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy(new Error('Apple verifyReceipt request timed out'));
      });
      req.write(json);
      req.end();
    } catch (err) {
      reject(err);
    }
  });

const appleTierForProductId = (productId) => {
  const id = String(productId || '');
  if (id.includes('.basic.')) return 'BASIC';
  if (id.includes('.premium.')) return 'PREMIUM';
  if (id.includes('.pro.')) return 'PRO';
  return null;
};

const verifyAppleReceipt = async (receiptData) => {
  const sharedSecret = String(process.env.APPLE_IAP_SHARED_SECRET || '').trim();
  if (!sharedSecret) {
    throw new Error('APPLE_IAP_SHARED_SECRET is not set');
  }

  const payload = {
    'receipt-data': String(receiptData || ''),
    password: sharedSecret,
    'exclude-old-transactions': true,
  };

  const first = await postJson(APPLE_VERIFY_URL_PROD, payload);
  const status = typeof first?.body?.status === 'number' ? first.body.status : null;

  // 21007: production endpoint received a sandbox receipt.
  if (status === 21007) {
    return await postJson(APPLE_VERIFY_URL_SANDBOX, payload);
  }

  return first;
};

// Verifies iOS subscription receipts and stores per-user entitlements in userSubscriptions/{uid}.
app.post('/iap/verify', requireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const receiptData = req.body?.receiptData || req.body?.receipt || req.body?.transactionReceipt;
    if (!receiptData) return res.status(400).json({ error: 'Missing receiptData' });

    const appleResp = await verifyAppleReceipt(receiptData);
    const appleBody = appleResp?.body || null;
    const appleStatus = typeof appleBody?.status === 'number' ? appleBody.status : null;

    if (appleStatus !== 0) {
      return res.status(400).json({ ok: false, status: appleStatus, error: 'Apple receipt verification failed' });
    }

    const latest = Array.isArray(appleBody?.latest_receipt_info)
      ? appleBody.latest_receipt_info
      : Array.isArray(appleBody?.receipt?.in_app)
        ? appleBody.receipt.in_app
        : [];

    const mostRecent = latest
      .map((r) => {
        const expiresMs = r?.expires_date_ms != null ? Number(r.expires_date_ms) : null;
        return {
          productId: r?.product_id || null,
          expiresDateMs: Number.isFinite(expiresMs) ? expiresMs : null,
          originalTransactionId: r?.original_transaction_id || null,
          transactionId: r?.transaction_id || null,
        };
      })
      .filter((r) => r.expiresDateMs)
      .sort((a, b) => (b.expiresDateMs || 0) - (a.expiresDateMs || 0))[0] || null;

    const now = Date.now();
    const expiresDateMs = mostRecent?.expiresDateMs || null;
    const active = !!(expiresDateMs && expiresDateMs > now);
    const tier = normalizeTier(appleTierForProductId(mostRecent?.productId) || req.body?.tier || 'BASIC');
    const status = active ? 'active' : 'canceled';

    // Detect paid->unpaid transitions for cleanup.
    let prevStatus = null;
    try {
      const prevSnap = await db.collection('userSubscriptions').doc(uid).get();
      prevStatus = prevSnap.exists ? (prevSnap.data() || {}).status : null;
    } catch {
      prevStatus = null;
    }

    await db
      .collection('userSubscriptions')
      .doc(uid)
      .set(
        {
          user_id: uid,
          tier,
          status,
          source: 'APPLE_IAP',
          appleStatus,
          appleProductId: mostRecent?.productId || null,
          appleTransactionId: mostRecent?.transactionId || null,
          appleOriginalTransactionId: mostRecent?.originalTransactionId || null,
          expiresDateMs,
          updatedAt: now,
        },
        { merge: true }
      );

    const wasPaid = isPaidStatus(prevStatus);
    const nowPaid = isPaidStatus(status);
    if (wasPaid && !nowPaid) {
      try {
        await revokePaidFeaturesForOwner(db, uid, { actorUid: 'system', reason: 'IAP_EXPIRED_OR_CANCELED' });
      } catch (err) {
        console.warn('[subscription] downgrade cleanup failed', { userId: uid, status, message: err?.message || String(err) });
      }
    }

    return res.json({
      ok: true,
      tier,
      status,
      expiresDateMs,
      productId: mostRecent?.productId || null,
    });
  } catch (err) {
    console.error('IAP verify failed:', { requestId: req.requestId, message: err?.message || String(err) });
    return res.status(500).json({ error: err?.message || 'IAP verify failed' });
  }
});

// Notification settings (per-user).
// NOTE: UI preferences are advisory; the backend enforces mandatory categories.
app.get('/notification-settings', requireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const stored = await ensureNotificationSettings(db, uid);
    const normalized = stored ? { ...stored } : null;

    return res.json({
      ok: true,
      settings: normalized,
      roleDefaults: {
        OWNER: getRoleDefaults(ROLE_OWNER),
        DELEGATE: getRoleDefaults(ROLE_DELEGATE),
      },
      enforced: {
        billing: true,
        security: true,
      },
    });
  } catch (err) {
    console.error('Error getting notification settings:', err);
    return res.status(500).json({ error: err?.message || 'Failed to get notification settings' });
  }
});

app.put('/notification-settings', requireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    await ensureNotificationSettings(db, uid);
    const next = await updateNotificationSettings(db, uid, {
      emailEnabled: req.body?.emailEnabled,
      categories: req.body?.categories,
      digestFrequency: req.body?.digestFrequency,
    });

    return res.json({ ok: true, settings: next });
  } catch (err) {
    console.error('Error updating notification settings:', err);
    return res.status(500).json({ error: err?.message || 'Failed to update notification settings' });
  }
});

// Email availability check used by the signup UI (runs before the user is authenticated).
// Note: This endpoint intentionally reveals whether an email exists. Keep the rate limit tight.
app.post('/email-available', emailAvailabilityRateLimiter, async (req, res) => {
  try {
    // Ensure intermediaries don't cache an email existence response.
    res.set('Cache-Control', 'no-store');
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'Missing email' });
    if (!firebaseEnabled()) {
      return res.status(503).json({ error: 'Firebase is not configured on this server' });
    }

    try {
      await firebaseAdmin.auth().getUserByEmail(email);
      return res.json({ available: false });
    } catch (err) {
      const code = err?.code ? String(err.code) : '';
      if (code === 'auth/user-not-found') {
        return res.json({ available: true });
      }
      console.error('Email availability check failed:', err?.message || err);
      return res.status(500).json({ error: 'Email check failed' });
    }
  } catch (error) {
    console.error('Email availability endpoint error:', error);
    return res.status(500).json({ error: 'Email check failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: process.env.RENDER_SERVICE_NAME || null,
    region: process.env.RENDER_REGION || null,
    instanceId: process.env.RENDER_INSTANCE_ID || null,
    gitCommit: process.env.RENDER_GIT_COMMIT || null,
    nodeEnv: process.env.NODE_ENV || null,
    serverTime: Date.now(),
    billingProvider: 'apple_iap',
    appleIapSecretConfigured: !!String(process.env.APPLE_IAP_SHARED_SECRET || '').trim(),
    firebase: firebaseEnabled() ? 'enabled' : 'disabled',
    requireFirebaseAuth: String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true',
  });
});

// Debug endpoint: email configuration status (owner-only).
// Does not reveal secrets; intended for verifying staging/prod config.
app.get('/debug/email-status', requireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const uid = req.firebaseUser?.uid ? String(req.firebaseUser.uid) : '';
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    // Owner-only: require the caller to own at least one vault.
    const ownsSnap = await db.collection('vaults').where('activeOwnerId', '==', uid).limit(1).get();
    if (ownsSnap.empty) return res.status(403).json({ error: 'Owner access required' });

    const providerRaw = String(process.env.EMAIL_PROVIDER || 'none').trim().toLowerCase();
    const provider = providerRaw || 'none';
    const from = String(process.env.EMAIL_FROM || '').trim();
    const adminAlertEmail = getAdminAlertEmail();

    return res.json({
      ok: true,
      email: {
        enabled: !!isEmailEnabled(),
        provider,
        fromConfigured: !!from,
        adminAlertConfigured: !!adminAlertEmail,
        sendgridKeyConfigured: !!String(process.env.SENDGRID_API_KEY || '').trim(),
        smtpHostConfigured: !!String(process.env.SMTP_HOST || '').trim(),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to load email status' });
  }
});

// Paid-owner invitation system.
// Owners create invite codes; invitees accept using a Firebase-authenticated endpoint.

app.get('/vaults/:vaultId/invitations', requireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const owner = await assertOwnerForVault(db, vaultId, req.firebaseUser);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    const paid = await assertVaultPaid(db, vaultId);
    if (!paid.ok) return res.status(paid.status).json({ error: paid.error });

    const snap = await db.collection('vaults').doc(vaultId).collection('invitations').orderBy('createdAt', 'desc').limit(50).get();
    const invitations = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    return res.json({ ok: true, invitations });
  } catch (err) {
    console.error('Error listing invitations:', err);
    return res.status(500).json({ error: err?.message || 'Failed to list invitations' });
  }
});

app.post('/vaults/:vaultId/invitations', requireFirebaseAuth, inviteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const inviteeEmail = normalizeEmail(req.body?.email);
    if (!inviteeEmail) return res.status(400).json({ error: 'Missing email' });

    const owner = await assertOwnerForVault(db, vaultId, req.firebaseUser);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    const paid = await assertVaultPaid(db, vaultId);
    if (!paid.ok) return res.status(paid.status).json({ error: paid.error });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'invite', actorUid: String(req.firebaseUser.uid) });
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    const withinLimit = await assertUnderDelegateLimit(db, vaultId);
    if (!withinLimit.ok) return res.status(withinLimit.status).json({ error: withinLimit.error });

    const code = generateInviteCode(vaultId);
    const now = Date.now();
    const expiresAt = now + 14 * 24 * 60 * 60 * 1000;

    const doc = {
      id: code,
      vault_id: vaultId,
      status: 'PENDING',
      invitee_email: inviteeEmail,
      invitee_uid: null,
      createdAt: now,
      createdBy: String(req.firebaseUser.uid),
      expiresAt,
    };

    await db.collection('vaults').doc(vaultId).collection('invitations').doc(code).set(doc, { merge: false });
    const auditEventId = await writeAuditEventIfPaid(db, vaultId, {
      type: 'INVITE_CREATED',
      actorUid: req.firebaseUser.uid,
      payload: { invitee_email: inviteeEmail, invitation_id: code },
    });

    let emailSent = false;
    try {
      const msg = buildInviteEmail({ code });
      const resp = await sendNotificationEmailIdempotent({
        db,
        dedupeKey: `vault:${vaultId}:invite:${code}:to:${inviteeEmail}`,
        category: NOTIFICATION_CATEGORIES.accessChanges,
        to: inviteeEmail,
        recipientUid: null,
        recipientRole: ROLE_DELEGATE,
        vaultId,
        auditEventId,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        // Invites are a special case: if the invitee has never set preferences,
        // default to sending this message (they can opt out explicitly later).
        defaultOptInIfNoSettings: true,
      });
      emailSent = !!resp?.sent;
    } catch (emailErr) {
      console.error('Failed to send invitation email:', emailErr?.message || emailErr);
      emailSent = false;
    }

    return res.json({ ok: true, code, invitation: doc, emailSent });
  } catch (err) {
    console.error('Error creating invitation:', err);
    return res.status(500).json({ error: err?.message || 'Failed to create invitation' });
  }
});

// Resolve a user identifier (email or username) to a uid.
// This is intentionally server-side because Firestore rules do not allow listing `/users` from clients.
// Paid + owner gated to avoid creating a public user directory.
app.post('/vaults/:vaultId/users/resolve', requireFirebaseAuth, inviteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const raw = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!vaultId) return res.status(400).json({ error: 'Missing vaultId' });
    if (!raw) return res.status(400).json({ error: 'Missing query' });

    const owner = await assertOwnerForVault(db, vaultId, req.firebaseUser);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    const paid = await assertVaultPaid(db, vaultId);
    if (!paid.ok) return res.status(paid.status).json({ error: paid.error });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'invite', actorUid: String(req.firebaseUser.uid) });
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    let uid = null;
    const q = raw;
    const asEmail = normalizeEmail(q);

    if (asEmail && asEmail.includes('@')) {
      try {
        const authUser = await firebaseAdmin.auth().getUserByEmail(asEmail);
        uid = authUser?.uid ? String(authUser.uid) : null;
      } catch (err) {
        uid = null;
      }
    } else {
      // Username lookup is done against the users collection.
      const username = String(q).trim().toLowerCase();
      const snap = await db.collection('users').where('username', '==', username).limit(1).get();
      if (!snap.empty) uid = String(snap.docs[0].id);
    }

    if (!uid) return res.status(404).json({ error: 'User not found' });

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};

    return res.json({
      ok: true,
      user: {
        uid,
        email: userData.email || (asEmail && asEmail.includes('@') ? asEmail : null),
        username: userData.username || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
      },
    });
  } catch (err) {
    console.error('Error resolving user:', err);
    return res.status(500).json({ error: err?.message || 'Failed to resolve user' });
  }
});

// Server-side create/delete for collections/assets.
// These exist to enforce tier caps (max collections/assets) and prevent client-side bypass.
app.post('/vaults/:vaultId/collections', requireFirebaseAuth, writeRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    if (!vaultId) return res.status(400).json({ error: 'Missing vaultId' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const can = await assertCanCreateCollection(db, vaultId, uid);
    if (!can.ok) return res.status(can.status).json({ error: can.error });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'write', actorUid: uid });
    if (!quota.ok) {
      await maybeWriteDailyQuotaExceededAuditOnceIfPaid(db, vaultId, {
        actorUid: uid,
        quota,
        kind: 'write',
        requestId: req.requestId,
        path: String(req.originalUrl || req.url || ''),
      });
      return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });
    }

    const within = await assertUnderCollectionLimit(db, vaultId);
    if (!within.ok) return res.status(within.status).json({ error: within.error });

    const vaultSnap = await db.collection('vaults').doc(vaultId).get();
    const vault = vaultSnap.exists ? (vaultSnap.data() || {}) : {};
    const activeOwnerId = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : uid;
    const ownerId = typeof req.body?.ownerId === 'string' && req.body.ownerId.trim() ? req.body.ownerId.trim() : activeOwnerId;

    const now = Date.now();
    const id = makeRandomId('c');
    const usageRef = getVaultUsageRef(db, vaultId);
    const ref = db.collection('vaults').doc(vaultId).collection('collections').doc(id);

    await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const usage = usageSnap.exists ? (usageSnap.data() || {}) : {};
      const collectionsCount = typeof usage.collectionsCount === 'number' ? usage.collectionsCount : 0;
      const maxCollections = Number.isFinite(within?.limits?.maxCollections) ? within.limits.maxCollections : 0;
      if (maxCollections > 0 && collectionsCount >= maxCollections) {
        throw new Error(`Collection limit reached for ${within.tier} tier (max ${maxCollections})`);
      }

      tx.set(ref, {
        id,
        vaultId,
        ownerId,
        name: String(name).slice(0, 120),
        description: typeof req.body?.description === 'string' ? req.body.description.slice(0, 500) : '',
        manager: typeof req.body?.manager === 'string' ? req.body.manager.slice(0, 120) : '',
        createdBy: uid,
        createdAt: now,
        editedAt: now,
        viewedAt: now,
        images: Array.isArray(req.body?.images) ? req.body.images.filter(Boolean).slice(0, 4) : [],
        heroImage: typeof req.body?.heroImage === 'string' ? req.body.heroImage : null,
        isDefault: false,
      });

      tx.set(
        usageRef,
        {
          collectionsCount: collectionsCount + 1,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    await writeAuditEventIfPaid(db, vaultId, {
      type: 'COLLECTION_CREATED',
      actorUid: uid,
      payload: { collection_id: id, name: String(name).slice(0, 120), request_id: req.requestId || null },
    });

    return res.json({ ok: true, collectionId: id });
  } catch (err) {
    const msg = err?.message || 'Failed to create collection';
    return res.status(400).json({ error: msg });
  }
});

app.post('/vaults/:vaultId/assets', requireFirebaseAuth, writeRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    if (!vaultId) return res.status(400).json({ error: 'Missing vaultId' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const collectionId = typeof req.body?.collectionId === 'string' ? req.body.collectionId.trim() : '';
    if (!collectionId) return res.status(400).json({ error: 'Missing collectionId' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'Missing title' });

    const can = await assertCanCreateAsset(db, vaultId, uid, collectionId);
    if (!can.ok) return res.status(can.status).json({ error: can.error });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'write', actorUid: uid });
    if (!quota.ok) {
      await maybeWriteDailyQuotaExceededAuditOnceIfPaid(db, vaultId, {
        actorUid: uid,
        quota,
        kind: 'write',
        requestId: req.requestId,
        path: String(req.originalUrl || req.url || ''),
      });
      return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });
    }

    const within = await assertUnderAssetLimit(db, vaultId);
    if (!within.ok) return res.status(within.status).json({ error: within.error });

    const vaultSnap = await db.collection('vaults').doc(vaultId).get();
    const vault = vaultSnap.exists ? (vaultSnap.data() || {}) : {};
    const activeOwnerId = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : uid;
    const ownerId = typeof req.body?.ownerId === 'string' && req.body.ownerId.trim() ? req.body.ownerId.trim() : activeOwnerId;

    const now = Date.now();
    const id = makeRandomId('a');
    const usageRef = getVaultUsageRef(db, vaultId);
    const ref = db.collection('vaults').doc(vaultId).collection('assets').doc(id);

    await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const usage = usageSnap.exists ? (usageSnap.data() || {}) : {};
      const assetsCount = typeof usage.assetsCount === 'number' ? usage.assetsCount : 0;
      const maxAssets = Number.isFinite(within?.limits?.maxAssets) ? within.limits.maxAssets : 0;
      if (maxAssets > 0 && assetsCount >= maxAssets) {
        throw new Error(`Asset limit reached for ${within.tier} tier (max ${maxAssets})`);
      }

      tx.set(ref, {
        id,
        vaultId,
        ownerId,
        collectionId,
        title: String(title).slice(0, 120),
        type: typeof req.body?.type === 'string' ? req.body.type.slice(0, 120) : '',
        category: typeof req.body?.category === 'string' ? req.body.category.slice(0, 120) : '',
        description: typeof req.body?.description === 'string' ? req.body.description.slice(0, 2000) : '',
        manager: typeof req.body?.manager === 'string' ? req.body.manager.slice(0, 120) : '',
        value: typeof req.body?.value === 'number' ? req.body.value : 0,
        estimatedValue: typeof req.body?.estimatedValue === 'number' ? req.body.estimatedValue : 0,
        rrp: typeof req.body?.rrp === 'number' ? req.body.rrp : 0,
        purchasePrice: typeof req.body?.purchasePrice === 'number' ? req.body.purchasePrice : 0,
        quantity: typeof req.body?.quantity === 'number' ? req.body.quantity : 1,
        createdBy: uid,
        createdAt: now,
        editedAt: now,
        viewedAt: now,
        images: Array.isArray(req.body?.images) ? req.body.images.filter(Boolean).slice(0, 4) : [],
        heroImage: typeof req.body?.heroImage === 'string' ? req.body.heroImage : null,
      });

      tx.set(
        usageRef,
        {
          assetsCount: assetsCount + 1,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    await writeAuditEventIfPaid(db, vaultId, {
      type: 'ASSET_CREATED',
      actorUid: uid,
      payload: {
        asset_id: id,
        collection_id: String(collectionId),
        title: String(title).slice(0, 120),
        request_id: req.requestId || null,
      },
    });

    return res.json({ ok: true, assetId: id });
  } catch (err) {
    const msg = err?.message || 'Failed to create asset';
    return res.status(400).json({ error: msg });
  }
});

app.post('/vaults/:vaultId/assets/:assetId/delete', requireFirebaseAuth, destructiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const assetId = String(req.params.assetId || '');
    if (!vaultId || !assetId) return res.status(400).json({ error: 'Missing vaultId or assetId' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const m = await getMembershipDoc(db, vaultId, uid);
    if (!m || (m.data || {}).status !== 'ACTIVE') return res.status(403).json({ error: 'Membership required' });

    // Permission: owners always; delegates require Delete (vault or asset-scope grant).
    let allowed = (m.data || {}).role === 'OWNER';
    const vaultPerms = m.data && typeof m.data.permissions === 'object' ? m.data.permissions : null;
    if (!allowed && vaultPerms && vaultPerms.Delete === true) allowed = true;

    if (!allowed) {
      const grant = await getGrantDoc(db, vaultId, { scopeType: 'ASSET', scopeId: assetId, userId: uid });
      const perms = grant && grant.data && typeof grant.data.permissions === 'object' ? grant.data.permissions : null;
      if (perms && perms.Delete === true) allowed = true;
    }

    if (!allowed) return res.status(403).json({ error: 'Delete permission required' });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'destructive', actorUid: uid });
    if (!quota.ok) {
      await maybeWriteDailyQuotaExceededAuditOnceIfPaid(db, vaultId, {
        actorUid: uid,
        quota,
        kind: 'destructive',
        requestId: req.requestId,
        path: String(req.originalUrl || req.url || ''),
      });
      return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });
    }

    await ensureVaultUsage(db, vaultId);
    const usageRef = getVaultUsageRef(db, vaultId);
    const assetRef = db.collection('vaults').doc(vaultId).collection('assets').doc(assetId);
    const now = Date.now();

    let deleted = false;
    await db.runTransaction(async (tx) => {
      // Firestore transactions require all reads before any writes.
      const [a, usageSnap] = await Promise.all([tx.get(assetRef), tx.get(usageRef)]);
      if (!a.exists) return;
      deleted = true;

      const usage = usageSnap.exists ? (usageSnap.data() || {}) : {};
      const assetsCount = typeof usage.assetsCount === 'number' ? usage.assetsCount : 0;

      tx.delete(assetRef);
      tx.set(
        usageRef,
        {
          assetsCount: Math.max(0, assetsCount - 1),
          updatedAt: now,
        },
        { merge: true }
      );
    });

    if (deleted) {
      await writeAuditEventIfPaid(db, vaultId, {
        type: 'ASSET_DELETED',
        actorUid: uid,
        payload: { asset_id: assetId, request_id: req.requestId || null },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to delete asset' });
  }
});

app.post('/vaults/:vaultId/collections/:collectionId/delete', requireFirebaseAuth, destructiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const collectionId = String(req.params.collectionId || '');
    if (!vaultId || !collectionId) return res.status(400).json({ error: 'Missing vaultId or collectionId' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const m = await getMembershipDoc(db, vaultId, uid);
    if (!m || (m.data || {}).status !== 'ACTIVE') return res.status(403).json({ error: 'Membership required' });

    // Permission: owners always; delegates require Delete (vault or collection-scope grant).
    let allowed = (m.data || {}).role === 'OWNER';
    const vaultPerms = m.data && typeof m.data.permissions === 'object' ? m.data.permissions : null;
    if (!allowed && vaultPerms && vaultPerms.Delete === true) allowed = true;

    if (!allowed) {
      const grant = await getGrantDoc(db, vaultId, { scopeType: 'COLLECTION', scopeId: collectionId, userId: uid });
      const perms = grant && grant.data && typeof grant.data.permissions === 'object' ? grant.data.permissions : null;
      if (perms && perms.Delete === true) allowed = true;
    }

    if (!allowed) return res.status(403).json({ error: 'Delete permission required' });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'destructive', actorUid: uid });
    if (!quota.ok) {
      await maybeWriteDailyQuotaExceededAuditOnceIfPaid(db, vaultId, {
        actorUid: uid,
        quota,
        kind: 'destructive',
        requestId: req.requestId,
        path: String(req.originalUrl || req.url || ''),
      });
      return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });
    }

    const vaultRef = db.collection('vaults').doc(vaultId);
    const colRef = vaultRef.collection('collections').doc(collectionId);
    const assetsRef = vaultRef.collection('assets');

    // Idempotency + safety: if the collection doesn't exist, do not delete anything and do not decrement usage counters.
    const colSnap = await colRef.get();
    if (!colSnap.exists) return res.json({ ok: true, deletedAssets: 0 });

    // Delete assets in pages to avoid batch limits.
    let deletedAssets = 0;
    let last = null;
    while (true) {
      let q = assetsRef
        .where('collectionId', '==', String(collectionId))
        .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
        .limit(400);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      deletedAssets += snap.size;
      if (snap.size < 400) break;
      last = snap.docs[snap.docs.length - 1];
    }

    await colRef.delete();

    // Best-effort usage counter updates.
    await ensureVaultUsage(db, vaultId);
    const usageRef = getVaultUsageRef(db, vaultId);
    await db.runTransaction(async (tx) => {
      const usageSnap = await tx.get(usageRef);
      const usage = usageSnap.exists ? (usageSnap.data() || {}) : {};
      const assetsCount = typeof usage.assetsCount === 'number' ? usage.assetsCount : 0;
      const collectionsCount = typeof usage.collectionsCount === 'number' ? usage.collectionsCount : 0;
      tx.set(
        usageRef,
        {
          assetsCount: Math.max(0, assetsCount - deletedAssets),
          collectionsCount: Math.max(0, collectionsCount - 1),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    });

    await writeAuditEventIfPaid(db, vaultId, {
      type: 'COLLECTION_DELETED',
      actorUid: uid,
      payload: {
        collection_id: collectionId,
        deleted_assets: deletedAssets,
        request_id: req.requestId || null,
      },
    });

    return res.json({ ok: true, deletedAssets });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to delete collection' });
  }
});

// Account change notifications.
// These send an informational email to the signed-in user's email address.
app.post('/notifications/username-changed', requireFirebaseAuth, securityNotifyRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const email = normalizeEmail(req.firebaseUser?.email);
    if (!email) return res.status(400).json({ error: 'Missing email on authenticated user' });

    const oldUsername = normalizeUsername(req.body?.oldUsername);
    const newUsername = normalizeUsername(req.body?.newUsername);
    if (!newUsername) return res.status(400).json({ error: 'Missing newUsername' });

    const eventId = typeof req.body?.eventId === 'string' ? req.body.eventId.trim() : '';
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

    const auditEventId = await writeUserAuditEvent(db, String(req.firebaseUser.uid), {
      type: 'USERNAME_CHANGED',
      actorUid: String(req.firebaseUser.uid),
      payload: { oldUsername: oldUsername || null, newUsername: newUsername || null },
    });

    const msg = buildUsernameChangedEmail({ oldUsername, newUsername });
    const resp = await sendNotificationEmailIdempotent({
      db,
      dedupeKey: `user:${String(req.firebaseUser.uid)}:username-changed:${eventId}`,
      category: NOTIFICATION_CATEGORIES.security,
      to: email,
      recipientUid: String(req.firebaseUser.uid),
      recipientRole: null,
      vaultId: null,
      auditEventId,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });

    return res.json({ ok: true, email: { sent: !!resp?.sent, skipped: !!resp?.skipped, deduped: !!resp?.deduped } });
  } catch (err) {
    console.error('Error sending username-changed email:', err);
    return res.status(500).json({ error: err?.message || 'Failed to send email' });
  }
});

app.post('/notifications/password-changed', requireFirebaseAuth, securityNotifyRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const email = normalizeEmail(req.firebaseUser?.email);
    if (!email) return res.status(400).json({ error: 'Missing email on authenticated user' });

    const eventId = typeof req.body?.eventId === 'string' ? req.body.eventId.trim() : '';
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

    const auditEventId = await writeUserAuditEvent(db, String(req.firebaseUser.uid), {
      type: 'PASSWORD_CHANGED',
      actorUid: String(req.firebaseUser.uid),
      payload: {},
    });

    const msg = buildPasswordChangedEmail();
    const resp = await sendNotificationEmailIdempotent({
      db,
      dedupeKey: `user:${String(req.firebaseUser.uid)}:password-changed:${eventId}`,
      category: NOTIFICATION_CATEGORIES.security,
      to: email,
      recipientUid: String(req.firebaseUser.uid),
      recipientRole: null,
      vaultId: null,
      auditEventId,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });

    return res.json({ ok: true, email: { sent: !!resp?.sent, skipped: !!resp?.skipped, deduped: !!resp?.deduped } });
  } catch (err) {
    console.error('Error sending password-changed email:', err);
    return res.status(500).json({ error: err?.message || 'Failed to send email' });
  }
});

app.post('/vaults/:vaultId/invitations/:code/revoke', requireFirebaseAuth, inviteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const code = String(req.params.code || '').trim();
    if (!vaultId || !code) return res.status(400).json({ error: 'Missing vaultId or code' });

    const owner = await assertOwnerForVault(db, vaultId, req.firebaseUser);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    const paid = await assertVaultPaid(db, vaultId);
    if (!paid.ok) return res.status(paid.status).json({ error: paid.error });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'invite', actorUid: String(req.firebaseUser.uid) });
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    const invRef = db.collection('vaults').doc(vaultId).collection('invitations').doc(code);
    const snap = await invRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Invitation not found' });

    const inv = snap.data() || {};
    if (inv.status !== 'PENDING') {
      return res.status(409).json({ error: 'Only pending invitations can be revoked' });
    }

    await invRef.set({ status: 'REVOKED', revokedAt: Date.now(), revokedBy: String(req.firebaseUser.uid) }, { merge: true });
    await writeAuditEventIfPaid(db, vaultId, {
      type: 'INVITE_REVOKED',
      actorUid: req.firebaseUser.uid,
      payload: { invitation_id: code },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error revoking invitation:', err);
    return res.status(500).json({ error: err?.message || 'Failed to revoke invitation' });
  }
});

app.post('/invitations/accept', requireFirebaseAuth, inviteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const vaultId = code.split('_')[0];
    if (!vaultId) return res.status(400).json({ error: 'Invalid code' });

    const quota = await assertAndIncrementVaultDailyQuota(db, vaultId, { kind: 'invite', actorUid: String(req.firebaseUser.uid) });
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    const invRef = db.collection('vaults').doc(String(vaultId)).collection('invitations').doc(code);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ error: 'Invitation not found' });

    const inv = invSnap.data() || {};
    if (inv.status !== 'PENDING') return res.status(409).json({ error: 'Invitation is no longer active' });
    if (typeof inv.expiresAt === 'number' && Date.now() > inv.expiresAt) {
      await invRef.set({ status: 'EXPIRED' }, { merge: true });
      return res.status(410).json({ error: 'Invitation has expired' });
    }

    const tokenEmail = normalizeEmail(req.firebaseUser?.email);
    const inviteEmail = normalizeEmail(inv.invitee_email);
    if (inviteEmail && tokenEmail && inviteEmail !== tokenEmail) {
      return res.status(403).json({ error: 'This invitation is for a different email' });
    }

    const uid = String(req.firebaseUser.uid);
    const membershipRef = db.collection('vaults').doc(String(vaultId)).collection('memberships').doc(uid);
    const existingMember = await membershipRef.get();
    if (existingMember.exists) {
      // If already a member, treat as idempotent accept.
      await invRef.set({ status: 'ACCEPTED', acceptedAt: Date.now(), acceptedByUid: uid, invitee_uid: uid }, { merge: true });
    } else {
      const withinLimit = await assertUnderDelegateLimit(db, vaultId);
      if (!withinLimit.ok) return res.status(withinLimit.status).json({ error: withinLimit.error });

      await membershipRef.set(
        {
          user_id: uid,
          vault_id: String(vaultId),
          role: 'DELEGATE',
          status: 'ACTIVE',
          permissions: { View: true },
          assigned_at: Date.now(),
          revoked_at: null,
          invitedBy: inv.createdBy || null,
          invitedAt: inv.createdAt || null,
        },
        { merge: true }
      );
      await invRef.set({ status: 'ACCEPTED', acceptedAt: Date.now(), acceptedByUid: uid, invitee_uid: uid }, { merge: true });
    }

    await writeAuditEventIfPaid(db, vaultId, {
      type: 'INVITE_ACCEPTED',
      actorUid: uid,
      payload: { invitation_id: code },
    });

    // Best-effort: notify the active owner that access was accepted.
    try {
      const vaultSnap = await db.collection('vaults').doc(String(vaultId)).get();
      const vault = vaultSnap.exists ? (vaultSnap.data() || {}) : {};
      const ownerUid = typeof vault.activeOwnerId === 'string' ? vault.activeOwnerId : null;
      if (ownerUid && ownerUid !== uid) {
        const ownerProfile = await getUserEmailAndName(db, ownerUid);
        const actorProfile = await getUserEmailAndName(db, uid);
        const vaultName = vault.name ? String(vault.name) : 'your vault';

        const auditEventId = await writeUserAuditEvent(db, ownerUid, {
          type: 'ACCESS_ACCEPTED',
          actorUid: uid,
          payload: { vault_id: String(vaultId), accepted_by: String(uid) },
        });

        if (ownerProfile?.email) {
          const subject = `Access accepted for your Vault “${vaultName}”`;
          const who = actorProfile?.name || 'Someone';
          const text = [
            `${who} has accepted your invitation to help manage assets in the Vault “${vaultName}”.`,
            '',
            'You can review or update their access at any time in the app.',
          ].join('\n');

          await sendNotificationEmailIdempotent({
            db,
            dedupeKey: `vault:${String(vaultId)}:invite-accepted:${String(code)}:to-owner:${String(ownerUid)}`,
            category: NOTIFICATION_CATEGORIES.accessChanges,
            to: ownerProfile.email,
            recipientUid: String(ownerUid),
            recipientRole: ROLE_OWNER,
            vaultId: String(vaultId),
            auditEventId,
            subject,
            text,
          });
        }
      }
    } catch (e) {
      console.warn('[invite accept] owner email failed', { message: e?.message || String(e) });
    }

    const vaultSnap = await db.collection('vaults').doc(String(vaultId)).get();
    const vault = vaultSnap.exists ? { id: vaultSnap.id, ...(vaultSnap.data() || {}) } : null;
    return res.json({ ok: true, vaultId: String(vaultId), vault });
  } catch (err) {
    console.error('Error accepting invitation:', err);
    return res.status(500).json({ error: err?.message || 'Failed to accept invitation' });
  }
});

// Hard ops (admin-style), still authenticated + owner-gated.
// These exist because some operations cannot be safely performed client-side due to Firestore rule constraints
// (e.g. recursive deletion) or cross-vault document moves.

app.post('/account/delete', requireFirebaseAuth, accountDeleteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const uid = String(req.firebaseUser?.uid || '');
    if (!uid) return res.status(401).json({ error: 'Missing authenticated user' });

    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
    if (confirm !== 'DELETE') return res.status(400).json({ error: 'Missing confirm=DELETE' });

    // Return immediately so mobile UX is snappy; do the heavy work in the background.
    const requestId = req.requestId || generateRequestId();
    res.status(202).json({ ok: true, queued: true, requestId });

    setImmediate(() => {
      (async () => {
        const dbBg = getFirestoreDb();
        if (!dbBg) throw new Error('Firebase is not configured on this server');

        safeLogJson('info', 'account_delete_queued', { requestId, uid });

        // 1) Discover vault memberships for this user (also used for cleanup below).
        let membershipDocs = [];
        let vaultIds = new Set();
        const ownedVaultIds = new Set();

        try {
          const membershipSnap = await dbBg
            .collectionGroup('memberships')
            .where(firebaseAdmin.firestore.FieldPath.documentId(), '==', uid)
            .get();

          membershipDocs = membershipSnap.docs || [];
          for (const d of membershipDocs) {
            const vaultRef = d.ref?.parent?.parent;
            const vaultId = vaultRef && vaultRef.id ? String(vaultRef.id) : null;
            if (!vaultId) continue;
            vaultIds.add(vaultId);

            const data = d.data() || {};
            if (data.role === 'OWNER') ownedVaultIds.add(vaultId);
          }
        } catch (e) {
          console.warn('[account delete] membership discovery failed', { requestId, uid, message: e?.message || String(e) });
        }

        // Fallback: also attempt to discover owned vaults via top-level vault fields.
        // (May require indexes; best-effort only.)
        try {
          const [activeOwnerSnap, ownerSnap] = await Promise.all([
            dbBg.collection('vaults').where('activeOwnerId', '==', uid).limit(500).get(),
            dbBg.collection('vaults').where('ownerId', '==', uid).limit(500).get(),
          ]);
          activeOwnerSnap.docs.forEach((d) => ownedVaultIds.add(String(d.id)));
          ownerSnap.docs.forEach((d) => ownedVaultIds.add(String(d.id)));
        } catch {
          // ignore
        }

        // 2) Delete vaults owned by the user.
        for (const vaultId of ownedVaultIds) {
          try {
            await deleteVaultRecursive(dbBg, vaultId);
          } catch (e) {
            console.warn('[account delete] failed deleting owned vault', { requestId, uid, vaultId: String(vaultId), message: e?.message || String(e) });
          }
        }

        // 3) Remove memberships and permission grants for the user in any remaining vaults.
        try {
          for (const group of chunkArray(membershipDocs, 400)) {
            const batch = dbBg.batch();
            group.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }

          const deleteUserGrantsInVault = async (vaultId) => {
            const grantsRef = dbBg.collection('vaults').doc(String(vaultId)).collection('permissionGrants');
            let last = null;
            while (true) {
              let q = grantsRef.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(400);
              if (last) q = q.startAfter(last);
              const snap = await q.get();
              if (snap.empty) break;

              const targets = snap.docs.filter((d) => String(d.id).endsWith(`:${uid}`));
              if (targets.length > 0) {
                const batch = dbBg.batch();
                targets.forEach((d) => batch.delete(d.ref));
                await batch.commit();
              }

              last = snap.docs[snap.docs.length - 1];
              if (snap.size < 400) break;
            }
          };

          for (const vaultId of vaultIds) {
            // Owned vaults are already deleted above; grants cleanup here is for shared vaults.
            if (ownedVaultIds.has(String(vaultId))) continue;
            try {
              await deleteUserGrantsInVault(vaultId);
            } catch (e) {
              console.warn('[account delete] failed deleting grants', { requestId, uid, vaultId: String(vaultId), message: e?.message || String(e) });
            }
          }
        } catch (e) {
          console.warn('[account delete] membership cleanup failed', { requestId, uid, message: e?.message || String(e) });
        }

        // 4) Delete user-scoped root docs.
        await Promise.all([
          dbBg.collection('users').doc(uid).delete().catch(() => {}),
          dbBg.collection('notificationSettings').doc(uid).delete().catch(() => {}),
          dbBg.collection('userSubscriptions').doc(uid).delete().catch(() => {}),
        ]);

        // 5) Delete user audit events.
        try {
          const userAuditRef = dbBg.collection('userAuditEvents').doc(uid);
          await deleteCollectionInPages(userAuditRef.collection('events'));
          await userAuditRef.delete().catch(() => {});
        } catch (e) {
          console.warn('[account delete] user audit cleanup failed', { requestId, uid, message: e?.message || String(e) });
        }

        // 6) Best-effort: delete email events for this recipient uid (may be large).
        try {
          let last = null;
          while (true) {
            let q = dbBg.collection('emailEvents').where('recipient_uid', '==', uid).orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(400);
            if (last) q = q.startAfter(last);
            const snap = await q.get();
            if (snap.empty) break;

            const batch = dbBg.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();

            last = snap.docs[snap.docs.length - 1];
            if (snap.size < 400) break;
          }
        } catch {
          // ignore; deletion is still successful without this.
        }

        // 7) Delete the Firebase Auth user.
        try {
          await firebaseAdmin.auth().deleteUser(uid);
        } catch (e) {
          // If the user is already gone, treat as success.
          if (e?.code !== 'auth/user-not-found') {
            console.warn('[account delete] auth delete failed', { requestId, uid, message: e?.message || String(e) });
          }
        }

        safeLogJson('info', 'account_delete_completed', { requestId, uid });
      })().catch((err) => {
        console.error('Error deleting account (async):', { requestId, uid, message: err?.message || String(err) });
      });
    });

    return;
  } catch (err) {
    console.error('Error deleting account:', err);
    return res.status(500).json({ error: err?.message || 'Failed to delete account' });
  }
});

app.post('/vaults/:vaultId/delete', requireFirebaseAuth, vaultDeleteRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const vaultId = String(req.params.vaultId || '');
    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
    if (confirm !== 'DELETE') return res.status(400).json({ error: 'Missing confirm=DELETE' });

    const owner = await assertOwnerForVault(db, vaultId, req.firebaseUser);
    if (!owner.ok) return res.status(owner.status).json({ error: owner.error });

    await deleteVaultRecursive(db, vaultId);
    await writeAuditEventIfPaid(db, vaultId, {
      type: 'VAULT_DELETED',
      actorUid: req.firebaseUser.uid,
      payload: { vault_id: vaultId },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting vault:', err);
    return res.status(500).json({ error: err?.message || 'Failed to delete vault' });
  }
});

app.post('/vaults/:vaultId/assets/:assetId/move', requireFirebaseAuth, destructiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const sourceVaultId = String(req.params.vaultId || '');
    const assetId = String(req.params.assetId || '');
    const targetVaultId = String(req.body?.targetVaultId || '');
    const targetCollectionId = String(req.body?.targetCollectionId || '');
    if (!sourceVaultId || !assetId || !targetVaultId || !targetCollectionId) {
      return res.status(400).json({ error: 'Missing source vaultId, assetId, targetVaultId, or targetCollectionId' });
    }

    const ownerSource = await assertOwnerForVault(db, sourceVaultId, req.firebaseUser);
    if (!ownerSource.ok) return res.status(ownerSource.status).json({ error: ownerSource.error });

    const ownerTarget = await assertOwnerForVaultUid(db, targetVaultId, String(req.firebaseUser.uid));
    if (!ownerTarget.ok) return res.status(ownerTarget.status).json({ error: ownerTarget.error });

    const quotaSource = await assertAndIncrementVaultDailyQuota(db, sourceVaultId, { kind: 'destructive', actorUid: String(req.firebaseUser.uid) });
    if (!quotaSource.ok) {
      return res
        .status(quotaSource.status)
        .json({ error: quotaSource.error, tier: quotaSource.tier, limits: quotaSource.limits, dateKey: quotaSource.dateKey });
    }

    if (String(targetVaultId) !== String(sourceVaultId)) {
      const quotaTarget = await assertAndIncrementVaultDailyQuota(db, targetVaultId, { kind: 'destructive', actorUid: String(req.firebaseUser.uid) });
      if (!quotaTarget.ok) {
        return res
          .status(quotaTarget.status)
          .json({ error: quotaTarget.error, tier: quotaTarget.tier, limits: quotaTarget.limits, dateKey: quotaTarget.dateKey });
      }
    }

    const moved = await moveAssetAcrossVaults(db, {
      sourceVaultId,
      assetId,
      targetVaultId,
      targetCollectionId,
      actorUid: String(req.firebaseUser.uid),
    });
    if (!moved.ok) return res.status(moved.status || 400).json({ error: moved.error || 'Move failed' });
    return res.json({ ok: true, assetId: moved.assetId });
  } catch (err) {
    console.error('Error moving asset across vaults:', err);
    return res.status(500).json({ error: err?.message || 'Failed to move asset' });
  }
});

app.post('/vaults/:vaultId/collections/:collectionId/move', requireFirebaseAuth, destructiveRateLimiter, async (req, res) => {
  try {
    const db = getFirestoreDb();
    if (!db) return res.status(503).json({ error: 'Firebase is not configured on this server' });

    const sourceVaultId = String(req.params.vaultId || '');
    const collectionId = String(req.params.collectionId || '');
    const targetVaultId = String(req.body?.targetVaultId || '');
    if (!sourceVaultId || !collectionId || !targetVaultId) {
      return res.status(400).json({ error: 'Missing source vaultId, collectionId, or targetVaultId' });
    }

    const ownerSource = await assertOwnerForVault(db, sourceVaultId, req.firebaseUser);
    if (!ownerSource.ok) return res.status(ownerSource.status).json({ error: ownerSource.error });

    const ownerTarget = await assertOwnerForVaultUid(db, targetVaultId, String(req.firebaseUser.uid));
    if (!ownerTarget.ok) return res.status(ownerTarget.status).json({ error: ownerTarget.error });

    const quotaSource = await assertAndIncrementVaultDailyQuota(db, sourceVaultId, { kind: 'destructive', actorUid: String(req.firebaseUser.uid) });
    if (!quotaSource.ok) {
      return res
        .status(quotaSource.status)
        .json({ error: quotaSource.error, tier: quotaSource.tier, limits: quotaSource.limits, dateKey: quotaSource.dateKey });
    }

    if (String(targetVaultId) !== String(sourceVaultId)) {
      const quotaTarget = await assertAndIncrementVaultDailyQuota(db, targetVaultId, { kind: 'destructive', actorUid: String(req.firebaseUser.uid) });
      if (!quotaTarget.ok) {
        return res
          .status(quotaTarget.status)
          .json({ error: quotaTarget.error, tier: quotaTarget.tier, limits: quotaTarget.limits, dateKey: quotaTarget.dateKey });
      }
    }

    const moved = await moveCollectionAcrossVaults(db, {
      sourceVaultId,
      collectionId,
      targetVaultId,
      actorUid: String(req.firebaseUser.uid),
    });
    if (!moved.ok) return res.status(moved.status || 400).json({ error: moved.error || 'Move failed' });
    return res.json({ ok: true, collectionId: moved.collectionId, movedAssetIds: moved.movedAssetIds || [] });
  } catch (err) {
    console.error('Error moving collection across vaults:', err);
    return res.status(500).json({ error: err?.message || 'Failed to move collection' });
  }
});

// Convenience: Render service root should respond in-browser.
app.get('/', (req, res) => {
  res.redirect('/health');
});

// Simple endpoint to validate Firebase auth wiring.
app.get('/me', requireFirebaseAuth, (req, res) => {
  res.json({ uid: req.firebaseUser?.uid, email: req.firebaseUser?.email || null });
});

async function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
