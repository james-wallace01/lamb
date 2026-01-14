// LAMB Backend Server for Stripe Payment Processing
// Install dependencies: npm install express stripe cors dotenv
// Run: node server.js

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config();
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = typeof stripeSecretKey === 'string' && stripeSecretKey.trim() ? require('stripe')(stripeSecretKey.trim()) : null;
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

const isStripeConfigured = () => !!stripe;

const getFirestoreDb = () => {
  if (!firebaseEnabled()) return null;
  try {
    return firebaseAdmin.firestore();
  } catch {
    return null;
  }
};

const toStripeMetadata = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    const s = String(v);
    if (!s) continue;
    out[k] = s;
  }
  return out;
};

const normalizeVaultSubStatus = (stripeSubscription) => {
  const stripeStatus = typeof stripeSubscription?.status === 'string' ? stripeSubscription.status : '';
  const cancelAtPeriodEnd = !!stripeSubscription?.cancel_at_period_end;

  // Firestore rules treat these as paid.
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') return stripeStatus;

  // Everything else is not paid; distinguish explicit cancels for UX/debugging.
  if (stripeStatus === 'canceled' || cancelAtPeriodEnd) return 'canceled';
  return stripeStatus || 'none';
};

const inferVaultIdForStripeCustomer = async (db, customerId) => {
  if (!db || !customerId) return null;

  // Prefer explicit metadata if present.
  const customer = await stripe.customers.retrieve(customerId);
  const firebaseUid = typeof customer?.metadata?.firebaseUid === 'string' ? customer.metadata.firebaseUid : '';
  if (!firebaseUid) return null;

  // Primary vault policy: earliest-created vault owned by this user.
  // Avoid orderBy to reduce index requirements; pick min createdAt in memory.
  const ownedSnap = await db.collection('vaults').where('activeOwnerId', '==', firebaseUid).limit(50).get();
  if (ownedSnap.empty) return null;

  let best = null;
  for (const doc of ownedSnap.docs) {
    const data = doc.data() || {};
    const createdAt = typeof data.createdAt === 'number' ? data.createdAt : Number.MAX_SAFE_INTEGER;
    if (!best || createdAt < best.createdAt) best = { id: doc.id, createdAt };
  }
  return best?.id || null;
};

const upsertVaultSubscriptionFromStripe = async ({ eventType, stripeSubscription }) => {
  const db = getFirestoreDb();
  if (!db) {
    const msg = 'Firebase is not configured; cannot sync vaultSubscriptions from Stripe webhooks.';
    if (isProd) throw new Error(msg);
    console.warn(`[stripe webhook] ${msg}`);
    return;
  }

  const customerId = typeof stripeSubscription?.customer === 'string' ? stripeSubscription.customer : stripeSubscription?.customer?.id;
  const metaVaultId = typeof stripeSubscription?.metadata?.vaultId === 'string' ? stripeSubscription.metadata.vaultId : '';
  const vaultId = metaVaultId || (await inferVaultIdForStripeCustomer(db, customerId));

  if (!vaultId) {
    console.warn('[stripe webhook] Unable to determine vaultId for subscription', {
      eventType,
      subscriptionId: stripeSubscription?.id,
      customerId,
    });
    return;
  }

  const metaTier = typeof stripeSubscription?.metadata?.tier === 'string' ? stripeSubscription.metadata.tier : '';
  const tier = metaTier ? metaTier.toUpperCase() : null;
  const status = normalizeVaultSubStatus(stripeSubscription);

  const payload = {
    vault_id: vaultId,
    tier,
    status,
    stripeSubscriptionId: stripeSubscription?.id || null,
    stripeCustomerId: customerId || null,
    cancelAtPeriodEnd: !!stripeSubscription?.cancel_at_period_end,
    trialEndsAt: stripeSubscription?.trial_end ? stripeSubscription.trial_end * 1000 : null,
    renewalDate: stripeSubscription?.current_period_end ? stripeSubscription.current_period_end * 1000 : null,
    currentPeriodStart: stripeSubscription?.current_period_start ? stripeSubscription.current_period_start * 1000 : null,
    currentPeriodEnd: stripeSubscription?.current_period_end ? stripeSubscription.current_period_end * 1000 : null,
    updatedAt: Date.now(),
    lastStripeEventType: eventType || null,
  };

  // Detect paid->unpaid transitions for cleanup.
  let prevStatus = null;
  try {
    const prevSnap = await db.collection('vaultSubscriptions').doc(String(vaultId)).get();
    prevStatus = prevSnap.exists ? (prevSnap.data() || {}).status : null;
  } catch {
    prevStatus = null;
  }

  await db.collection('vaultSubscriptions').doc(vaultId).set(payload, { merge: true });

  const wasPaid = isPaidStatus(prevStatus);
  const nowPaid = isPaidStatus(status);
  if (wasPaid && !nowPaid) {
    try {
      await revokePaidFeaturesForVault(db, vaultId, { actorUid: 'system', reason: `SUBSCRIPTION_${String(status || 'NONE').toUpperCase()}` });
    } catch (err) {
      console.warn('[subscription] downgrade cleanup failed', { vaultId, status, message: err?.message || String(err) });
    }
  }
};

// Optional Firebase Admin initialization (used for verifying Firebase ID tokens)
initFirebaseAdmin();

// If Stripe isn't configured, still allow /health and /me so Firebase auth can be tested.
app.use((req, res, next) => {
  if (isStripeConfigured()) return next();
  if (req.path === '/health' || req.path === '/me' || req.path === '/public-config' || req.path === '/email-available') return next();
  return res.status(503).json({ error: 'Stripe is not configured on this server' });
});

app.get('/public-config', (req, res) => {
  res.json({
    stripePublishableKey: (process.env.STRIPE_PUBLISHABLE_KEY || '').trim() || null,
  });
});

const maybeRequireFirebaseAuth = (req, res, next) => {
  const requireAuth = process.env.NODE_ENV === 'production' || String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true';
  if (!requireAuth) return next();
  return requireFirebaseAuth(req, res, next);
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeUsername = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getPublicAppName = () => String(process.env.PUBLIC_APP_NAME || 'LAMB').trim() || 'LAMB';

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

const sendBillingEmailToVaultOwner = async ({ db, vaultId, type, stripeEventId } = {}) => {
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
    payload: { vault_id: String(vaultId), stripe_event_id: stripeEventId || null },
  });

  return await sendNotificationEmailIdempotent({
    db,
    dedupeKey: `stripe:${String(stripeEventId || 'unknown')}:vault:${String(vaultId)}:owner:${String(ownerUid)}:type:${String(type)}`,
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

const getVaultTier = async (db, vaultId) => {
  if (!db || !vaultId) return 'BASIC';
  try {
    const snap = await db.collection('vaultSubscriptions').doc(String(vaultId)).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    return normalizeTier(data.tier);
  } catch {
    return 'BASIC';
  }
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
  const snap = await db.collection('vaultSubscriptions').doc(String(vaultId)).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const status = data.status;
  if (!isPaidStatus(status)) {
    return { ok: false, status: 402, error: 'Vault is not on a paid plan' };
  }
  return { ok: true, subscription: data };
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
  const subcollections = ['assets', 'collections', 'memberships', 'permissionGrants', 'invitations', 'auditEvents'];
  for (const name of subcollections) {
    await deleteCollectionInPages(vaultRef.collection(name));
  }

  // Delete the vault doc and subscription doc.
  await vaultRef.delete();
  await db.collection('vaultSubscriptions').doc(String(vaultId)).delete().catch(() => {});
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

const assertStripeCustomerOwnedByFirebaseUser = async (customerId, firebaseUser) => {
  if (!customerId) return { ok: false, status: 400, error: 'Missing customerId' };
  if (!firebaseUser?.uid) return { ok: false, status: 401, error: 'Missing authenticated user' };

  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || customer.deleted) return { ok: false, status: 404, error: 'Stripe customer not found' };

  const uid = String(firebaseUser.uid);
  const tokenEmail = normalizeEmail(firebaseUser.email);

  const metaUid = typeof customer.metadata?.firebaseUid === 'string' ? customer.metadata.firebaseUid : '';
  const customerEmail = normalizeEmail(customer.email);

  const matchesUid = metaUid && metaUid === uid;
  const matchesEmail = tokenEmail && customerEmail && tokenEmail === customerEmail;

  if (matchesUid || matchesEmail) {
    // Best-effort: stamp ownership metadata for future strict checks.
    if (!matchesUid) {
      try {
        await stripe.customers.update(customerId, {
          metadata: {
            ...(customer.metadata || {}),
            firebaseUid: uid,
            firebaseEmail: tokenEmail || customerEmail || null,
          },
        });
      } catch {
        // ignore
      }
    }
    return { ok: true, customer };
  }

  return { ok: false, status: 403, error: 'Forbidden' };
};

// Stripe webhooks require the raw request body to validate signatures.
// This MUST be registered before express.json().
app.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Stripe is not configured on this server' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !String(secret).trim()) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not set' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe-Signature header' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, String(secret).trim());
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err?.message || 'invalid signature'}` });
  }

  try {
    switch (event.type) {
      // Subscription lifecycle
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        console.log('[stripe webhook]', event.type, {
          requestId: req.requestId,
          eventId: event.id,
          id: sub?.id,
          status: sub?.status,
          customer: sub?.customer,
          cancel_at_period_end: sub?.cancel_at_period_end,
          current_period_end: sub?.current_period_end,
        });

        await upsertVaultSubscriptionFromStripe({ eventType: event.type, stripeSubscription: sub });

        // Best-effort billing notifications (mandatory; owners only).
        try {
          const db = getFirestoreDb();
          if (db) {
            const customerId = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
            const metaVaultId = typeof sub?.metadata?.vaultId === 'string' ? sub.metadata.vaultId : '';
            const vaultId = metaVaultId || (await inferVaultIdForStripeCustomer(db, customerId));
            if (vaultId) {
              if (event.type === 'customer.subscription.created') {
                await sendBillingEmailToVaultOwner({ db, vaultId, type: 'SUBSCRIPTION_STARTED', stripeEventId: event.id });
              }
              if (event.type === 'customer.subscription.deleted' || sub?.status === 'canceled' || sub?.cancel_at_period_end) {
                await sendBillingEmailToVaultOwner({ db, vaultId, type: 'SUBSCRIPTION_CANCELLED', stripeEventId: event.id });
              }
            }
          }
        } catch (e) {
          console.warn('[stripe webhook] billing email failed', {
            requestId: req.requestId,
            eventId: event.id,
            type: event.type,
            message: e?.message || String(e),
          });
        }
        break;
      }

      // Invoicing/payment status
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('[stripe webhook]', event.type, {
          requestId: req.requestId,
          eventId: event.id,
          id: invoice?.id,
          customer: invoice?.customer,
          subscription: invoice?.subscription,
          status: invoice?.status,
          paid: invoice?.paid,
        });

        // Best-effort: sync the linked subscription since invoice events are often what users notice first.
        const subId = typeof invoice?.subscription === 'string' ? invoice.subscription : invoice?.subscription?.id;
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            await upsertVaultSubscriptionFromStripe({ eventType: event.type, stripeSubscription: sub });

            if (event.type === 'invoice.payment_failed') {
              try {
                const db = getFirestoreDb();
                if (db) {
                  const customerId = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
                  const metaVaultId = typeof sub?.metadata?.vaultId === 'string' ? sub.metadata.vaultId : '';
                  const vaultId = metaVaultId || (await inferVaultIdForStripeCustomer(db, customerId));
                  if (vaultId) {
                    await sendBillingEmailToVaultOwner({ db, vaultId, type: 'PAYMENT_FAILED', stripeEventId: event.id });
                  }
                }
              } catch (e) {
                console.warn('[stripe webhook] payment failed email send error', {
                  requestId: req.requestId,
                  eventId: event.id,
                  message: e?.message || String(e),
                });
              }
            }
          } catch (err) {
            console.warn('[stripe webhook] failed to retrieve subscription for invoice', {
              requestId: req.requestId,
              eventId: event.id,
              invoiceId: invoice?.id,
              subscription: subId,
              message: err?.message || String(err),
            });
          }
        }
        break;
      }

      default:
        // Keep logs quiet for unhandled events.
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Error handling webhook:', {
      requestId: req.requestId,
      eventId: event?.id,
      message: err?.message || String(err),
    });
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// JSON parser for all non-webhook routes.
app.use(express.json({ limit: '200kb' }));

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

// Price amounts in cents
const PRICE_MAP = {
  BASIC: 249,
  PREMIUM: 499,
  PRO: 999
};

// Cache for Stripe Price IDs
let stripePriceIds = {};

// Initialize Stripe Products and Prices
async function initializeStripePrices() {
  try {
    if (!isStripeConfigured()) {
      console.warn('Skipping Stripe price initialization: STRIPE_SECRET_KEY is not set.');
      stripePriceIds = {};
      return;
    }
    console.log('Initializing Stripe products and prices...');
    
    for (const [tier, amount] of Object.entries(PRICE_MAP)) {
      const products = await stripe.products.search({
        query: `name:'LAMB ${tier} Plan'`,
      });

      let product;
      if (products.data.length > 0) {
        product = products.data[0];
      } else {
        product = await stripe.products.create({
          name: `LAMB ${tier} Plan`,
          description: `${tier} subscription plan`,
        });
      }

      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
      });

      let price;
      const existingPrice = prices.data.find(p => p.unit_amount === amount && p.recurring?.interval === 'month');
      
      if (existingPrice) {
        price = existingPrice;
      } else {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: amount,
          currency: 'usd',
          recurring: { interval: 'month' },
        });
      }

      stripePriceIds[tier] = price.id;
    }
    
    console.log('Stripe prices ready:', stripePriceIds);
  } catch (error) {
    console.error('Error initializing Stripe prices:', error);
  }
}

async function getOrCreateCustomer(email, name, firebaseUser) {
  const normalized = normalizeEmail(email);
  const customers = await stripe.customers.list({ email: normalized, limit: 1 });
  if (customers.data.length > 0) {
    const existing = customers.data[0];
    // Best-effort: stamp ownership metadata if we can.
    if (firebaseUser?.uid) {
      const uid = String(firebaseUser.uid);
      const metaUid = typeof existing.metadata?.firebaseUid === 'string' ? existing.metadata.firebaseUid : '';
      if (!metaUid || metaUid !== uid) {
        try {
          await stripe.customers.update(existing.id, {
            metadata: {
              ...(existing.metadata || {}),
              firebaseUid: uid,
              firebaseEmail: normalizeEmail(firebaseUser.email) || normalized || null,
            },
          });
        } catch {
          // ignore
        }
      }
    }
    return existing;
  }

  const metadata = firebaseUser?.uid
    ? { firebaseUid: String(firebaseUser.uid), firebaseEmail: normalizeEmail(firebaseUser.email) || normalized || null }
    : undefined;

  return await stripe.customers.create({ email: normalized, name, metadata });
}

// Signup flow: runs before the user has an ID token, so this endpoint must not require Firebase auth.
app.post('/create-subscription', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const tokenEmail = normalizeEmail(req.firebaseUser?.email);
    const email = tokenEmail || normalizeEmail(req.body?.email);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'LAMB User';
    const { subscriptionTier, vaultId } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const customer = await getOrCreateCustomer(email, name, req.firebaseUser);
    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customer.id, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-11-20.acacia' }
    );

    // Collect a valid payment method up-front (no charge yet)
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: toStripeMetadata({
        tier: subscriptionTier,
        vaultId,
        firebaseUid: req.firebaseUser?.uid,
      }),
    });

    if (!setupIntent.client_secret) {
      throw new Error('Failed to create setup intent');
    }

    res.json({
      setupIntentClientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Signup flow: runs before the user has an ID token, so this endpoint must not require Firebase auth.
app.post('/start-trial-subscription', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { customerId, subscriptionTier, setupIntentId, vaultId } = req.body;
    if (!customerId || !subscriptionTier || !setupIntentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent?.customer && String(setupIntent.customer) !== String(customerId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const paymentMethodId = setupIntent.payment_method;
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'No payment method found' });
    }

    // Set default payment method for future invoices
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: stripePriceIds[subscriptionTier] }],
      trial_period_days: 14,
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      metadata: toStripeMetadata({
        tier: subscriptionTier,
        vaultId,
        firebaseUid: req.firebaseUser?.uid,
      }),
    });

    res.json({ subscriptionId: subscription.id });
  } catch (error) {
    console.error('Error starting trial subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/update-subscription', maybeRequireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, newSubscriptionTier } = req.body;
    console.log(`Updating subscription ${subscriptionId} to ${newSubscriptionTier}`);
    
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: stripePriceIds[newSubscriptionTier],
      }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'default_incomplete',
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription'
      },
      metadata: toStripeMetadata({
        ...(subscription?.metadata || {}),
        tier: newSubscriptionTier,
      }),
    });

    if (updatedSubscription.latest_invoice) {
      let invoice = await stripe.invoices.retrieve(updatedSubscription.latest_invoice, {
        expand: ['payment_intent']
      });
      
      console.log(`Invoice status: ${invoice.status}, amount_due: ${invoice.amount_due}`);
      
      if (invoice.amount_due > 0) {
        // If invoice is in draft, we need to finalize it to get a payment intent
        // But we set collection_method to prevent automatic charge attempt
        if (invoice.status === 'draft') {
          console.log('Finalizing invoice with manual collection...');
          
          // Update invoice to prevent automatic charge
          await stripe.invoices.update(invoice.id, {
            collection_method: 'charge_automatically',
            auto_advance: false  // Prevents automatic payment attempt
          });
          
          // Now finalize to create payment intent
          invoice = await stripe.invoices.finalize(invoice.id);
          
          // Re-retrieve with payment_intent expanded
          invoice = await stripe.invoices.retrieve(invoice.id, {
            expand: ['payment_intent']
          });
        }
        
        if (invoice.payment_intent) {
          console.log(`Payment intent status: ${invoice.payment_intent.status}`);
          console.log(`Payment intent client_secret exists: ${!!invoice.payment_intent.client_secret}`);
          
          const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: subscription.customer },
            { apiVersion: '2024-11-20.acacia' }
          );
          
          return res.json({
            requiresPayment: true,
            clientSecret: invoice.payment_intent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customer: subscription.customer,
            invoiceId: invoice.id,
          });
        }
      }
    }

    console.log('No payment required for subscription update');
    res.json({ requiresPayment: false, subscriptionId: updatedSubscription.id });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/confirm-payment', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { invoiceId } = req.body;
    
    // Retrieve the invoice to get the payment intent
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['payment_intent']
    });

    if (req.firebaseUser?.uid) {
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    if (!invoice.payment_intent) {
      return res.json({ success: false, status: 'no_payment' });
    }
    
    const paymentIntent = invoice.payment_intent;
    
    console.log('Payment intent status:', paymentIntent.status, 'Invoice status:', invoice.status);
    
    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      // Payment succeeded, mark invoice as paid if needed
      if (invoice.status === 'open') {
        await stripe.invoices.pay(invoiceId);
      }
      return res.json({ success: true, status: 'succeeded' });
    }
    
    // Check for other statuses
    if (paymentIntent.status === 'processing') {
      return res.json({ success: false, status: 'processing' });
    }
    
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action') {
      return res.json({ success: false, status: 'requires_payment_method' });
    }
    
    // Payment failed or cancelled
    return res.json({ success: false, status: paymentIntent.status, error: 'Payment did not complete' });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/confirm-subscription-payment', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    
    // Retrieve the subscription to get the latest invoice
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent']
    });

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    if (!subscription.latest_invoice) {
      return res.json({ success: false, status: 'no_invoice' });
    }
    
    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice.payment_intent;
    
    if (!paymentIntent) {
      return res.json({ success: false, status: 'no_payment_intent' });
    }
    
    console.log('Subscription payment intent status:', paymentIntent.status, 'Invoice status:', invoice.status);
    
    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      return res.json({ success: true, status: 'succeeded' });
    }
    
    // Check for other statuses
    if (paymentIntent.status === 'processing') {
      return res.json({ success: false, status: 'processing' });
    }
    
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action') {
      return res.json({ success: false, status: 'requires_payment_method' });
    }
    
    // Payment failed or cancelled
    return res.json({ success: false, status: paymentIntent.status, error: 'Payment did not complete' });
  } catch (error) {
    console.error('Error confirming subscription payment:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/schedule-subscription-change', maybeRequireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, newSubscriptionTier } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Missing subscriptionId' });
    }
    if (!newSubscriptionTier || !stripePriceIds[newSubscriptionTier]) {
      return res.status(400).json({ error: 'Invalid newSubscriptionTier' });
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    // Stripe allows only one schedule per subscription.
    // If the subscription already has a schedule, reuse it; otherwise create a new one.
    const existingScheduleId =
      (typeof subscription.schedule === 'string' && subscription.schedule) ||
      (typeof subscription.subscription_schedule === 'string' && subscription.subscription_schedule) ||
      null;

    const schedule = existingScheduleId
      ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
      : await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });

    const phaseStart = schedule?.phases?.[0]?.start_date || Math.floor(Date.now() / 1000);
    const currentPriceId = subscription?.items?.data?.[0]?.price?.id;
    if (!currentPriceId) {
      return res.status(500).json({ error: 'Subscription is missing price information' });
    }

    const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: [{ price: currentPriceId }],
          start_date: phaseStart,
          end_date: subscription.current_period_end,
        },
        {
          items: [{ price: stripePriceIds[newSubscriptionTier] }],
          start_date: subscription.current_period_end,
        },
      ],
      end_behavior: 'release',
    });

    res.json({
      scheduleId: updatedSchedule.id,
      changeDate: new Date(subscription.current_period_end * 1000),
    });
  } catch (error) {
    console.error('Error scheduling subscription change:', error);
    res.status(500).json({ error: error?.message || 'Failed to schedule subscription change' });
  }
});

app.post('/cancel-subscription', maybeRequireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, immediate } = req.body;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    if (immediate) {
      const canceled = await stripe.subscriptions.cancel(subscriptionId);
      res.json({ subscriptionId: canceled.id, status: 'canceled' });
    } else {
      const updated = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      res.json({ 
        subscriptionId: updated.id, 
        status: 'canceling',
        cancelAt: new Date(updated.current_period_end * 1000)
      });
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-payment-intent', maybeRequireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    const { amount, currency, subscriptionTier } = req.body;
    const tokenEmail = normalizeEmail(req.firebaseUser?.email);
    const email = tokenEmail || normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const customer = await getOrCreateCustomer(email, 'LAMB User', req.firebaseUser);
    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customer.id, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-11-20.acacia' }
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: { subscriptionTier },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    stripe: isStripeConfigured() ? 'configured' : 'not_configured',
    stripePrices: stripePriceIds,
    firebase: firebaseEnabled() ? 'enabled' : 'disabled',
    requireFirebaseAuth: String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true',
  });
});

// Server-side subscription validation/sync.
// Requires a Firebase ID token and uses Stripe as the source of truth.
app.post('/subscription-status', requireFirebaseAuth, billingRateLimiter, async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured on this server' });
    }

    const { subscriptionId, customerId } = req.body || {};
    if (!subscriptionId && !customerId) {
      return res.status(400).json({ error: 'Missing subscriptionId or customerId' });
    }

    const loadSubscription = async () => {
      if (subscriptionId) {
        return await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price', 'customer'],
        });
      }

      // Fallback: pick the most relevant subscription for the customer.
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 50,
        expand: ['data.items.data.price'],
      });

      const ranked = (subs.data || []).slice().sort((a, b) => {
        const score = (s) => {
          const status = s?.status;
          if (status === 'active') return 5;
          if (status === 'trialing') return 4;
          if (status === 'past_due') return 3;
          if (status === 'unpaid') return 2;
          if (status === 'canceled') return 1;
          return 0;
        };
        const byScore = score(b) - score(a);
        if (byScore !== 0) return byScore;
        return (b?.created || 0) - (a?.created || 0);
      });

      return ranked[0] || null;
    };

    const subscription = await loadSubscription();
    if (!subscription) {
      return res.json({
        ok: true,
        subscription: null,
      });
    }

    const derivedTier = (() => {
      const metaTier = subscription?.metadata?.tier;
      if (metaTier && typeof metaTier === 'string') return metaTier.toUpperCase();

      const priceId = subscription?.items?.data?.[0]?.price?.id || subscription?.items?.data?.[0]?.price;
      if (!priceId) return null;
      const match = Object.entries(stripePriceIds || {}).find(([, id]) => id === priceId);
      return match ? match[0] : null;
    })();

    res.json({
      ok: true,
      subscription: {
        id: subscription.id,
        customer: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        status: subscription.status,
        tier: derivedTier,
        cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
        currentPeriodStartMs: subscription.current_period_start ? subscription.current_period_start * 1000 : null,
        currentPeriodEndMs: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
      },
    });
  } catch (error) {
    console.error('Error validating subscription status:', error);
    res.status(500).json({ error: error.message });
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
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

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
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

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
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    await ensureVaultUsage(db, vaultId);
    const usageRef = getVaultUsageRef(db, vaultId);
    const assetRef = db.collection('vaults').doc(vaultId).collection('assets').doc(assetId);
    const now = Date.now();

    await db.runTransaction(async (tx) => {
      const a = await tx.get(assetRef);
      if (!a.exists) return;
      tx.delete(assetRef);

      const usageSnap = await tx.get(usageRef);
      const usage = usageSnap.exists ? (usageSnap.data() || {}) : {};
      const assetsCount = typeof usage.assetsCount === 'number' ? usage.assetsCount : 0;
      tx.set(
        usageRef,
        {
          assetsCount: Math.max(0, assetsCount - 1),
          updatedAt: now,
        },
        { merge: true }
      );
    });

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
    if (!quota.ok) return res.status(quota.status).json({ error: quota.error, tier: quota.tier, limits: quota.limits, dateKey: quota.dateKey });

    const vaultRef = db.collection('vaults').doc(vaultId);
    const colRef = vaultRef.collection('collections').doc(collectionId);
    const assetsRef = vaultRef.collection('assets');

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

// Dangerous cleanup endpoints are disabled by default.
// Use the CLI script instead: `npm run wipe-remote`.
if (String(process.env.ENABLE_STRIPE_CLEANUP_ENDPOINTS).toLowerCase() === 'true') {
  // Get all subscriptions for cleanup
  app.get('/all-subscriptions', async (req, res) => {
    try {
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        status: 'all'
      });
      
      res.json({
        total: subscriptions.data.length,
        subscriptions: subscriptions.data.map(sub => ({
          id: sub.id,
          customer: sub.customer,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000),
          items: sub.items.data.map(item => ({
            price: item.price.id,
            quantity: item.quantity
          }))
        }))
      });
    } catch (error) {
      console.error('Error listing subscriptions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel all test subscriptions
  app.post('/cleanup-subscriptions', async (req, res) => {
    try {
      console.log('Starting subscription cleanup...');
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        status: 'all'
      });
      
      const canceled = [];
      const errors = [];
      
      for (const sub of subscriptions.data) {
        try {
          if (sub.status !== 'canceled') {
            console.log(`Canceling subscription ${sub.id}...`);
            await stripe.subscriptions.cancel(sub.id);
            canceled.push(sub.id);
          }
        } catch (error) {
          errors.push({ subscriptionId: sub.id, error: error.message });
        }
      }
      
      // Delete test customers
      const customers = await stripe.customers.list({
        limit: 100
      });
      
      const deletedCustomers = [];
      for (const customer of customers.data) {
        try {
          console.log(`Deleting customer ${customer.id}...`);
          await stripe.customers.del(customer.id);
          deletedCustomers.push(customer.id);
        } catch (error) {
          // Some customers may have active subscriptions, that's okay
          console.log(`Could not delete customer ${customer.id}: ${error.message}`);
        }
      }
      
      res.json({
        message: 'Cleanup completed',
        canceledSubscriptions: canceled,
        deletedCustomers: deletedCustomers,
        errors: errors
      });
    } catch (error) {
      console.error('Error during cleanup:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

async function startServer() {
  await initializeStripePrices();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
