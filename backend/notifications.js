const crypto = require('crypto');
const { sendEmail, isEmailEnabled } = require('./email');

const NOTIFICATION_CATEGORIES = Object.freeze({
  billing: 'billing',
  accessChanges: 'accessChanges',
  destructiveActions: 'destructiveActions',
  structuralChanges: 'structuralChanges',
  activityDigest: 'activityDigest',
  security: 'security',
});

const ROLE_OWNER = 'OWNER';
const ROLE_DELEGATE = 'DELEGATE';

const isCategoryMandatory = (category) => {
  return category === NOTIFICATION_CATEGORIES.billing || category === NOTIFICATION_CATEGORIES.security;
};

const defaultCategoryForRole = ({ category, role }) => {
  const r = role === ROLE_OWNER ? ROLE_OWNER : ROLE_DELEGATE;

  if (category === NOTIFICATION_CATEGORIES.billing) return r === ROLE_OWNER;
  if (category === NOTIFICATION_CATEGORIES.security) return true;

  if (category === NOTIFICATION_CATEGORIES.accessChanges) return r === ROLE_OWNER;
  if (category === NOTIFICATION_CATEGORIES.destructiveActions) return r === ROLE_OWNER;
  if (category === NOTIFICATION_CATEGORIES.structuralChanges) return false;
  if (category === NOTIFICATION_CATEGORIES.activityDigest) return false;

  return false;
};

const getRoleDefaults = (role) => {
  const r = role === ROLE_OWNER ? ROLE_OWNER : ROLE_DELEGATE;
  return {
    emailEnabled: true,
    categories: {
      [NOTIFICATION_CATEGORIES.billing]: r === ROLE_OWNER,
      [NOTIFICATION_CATEGORIES.accessChanges]: r === ROLE_OWNER,
      [NOTIFICATION_CATEGORIES.destructiveActions]: r === ROLE_OWNER,
      [NOTIFICATION_CATEGORIES.structuralChanges]: false,
      [NOTIFICATION_CATEGORIES.activityDigest]: false,
      [NOTIFICATION_CATEGORIES.security]: true,
    },
    digestFrequency: 'weekly',
  };
};

const normalizeSettingsDoc = (raw) => {
  const d = raw && typeof raw === 'object' ? raw : {};
  const emailEnabled = d.emailEnabled !== false;
  const digestFrequency = d.digestFrequency === 'daily' ? 'daily' : 'weekly';

  const categories = d.categories && typeof d.categories === 'object' ? d.categories : {};
  const outCats = {};
  for (const k of Object.values(NOTIFICATION_CATEGORIES)) {
    if (typeof categories[k] === 'boolean') outCats[k] = categories[k];
  }

  return {
    emailEnabled,
    categories: outCats,
    digestFrequency,
  };
};

const ensureNotificationSettings = async (db, uid) => {
  if (!db || !uid) return null;
  const ref = db.collection('notificationSettings').doc(String(uid));

  const snap = await ref.get();
  if (snap.exists) {
    return { id: snap.id, ...(snap.data() || {}) };
  }

  const base = {
    emailEnabled: true,
    categories: {},
    digestFrequency: 'weekly',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await ref.set(base, { merge: false });
  return { id: String(uid), ...base };
};

const getNotificationSettings = async (db, uid) => {
  if (!db || !uid) return null;
  const snap = await db.collection('notificationSettings').doc(String(uid)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() || {}) };
};

const updateNotificationSettings = async (db, uid, patch) => {
  if (!db || !uid) return null;
  const ref = db.collection('notificationSettings').doc(String(uid));

  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'emailEnabled')) {
    next.emailEnabled = patch.emailEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'digestFrequency')) {
    next.digestFrequency = patch.digestFrequency === 'daily' ? 'daily' : 'weekly';
  }

  if (patch && typeof patch.categories === 'object' && patch.categories) {
    const cats = {};
    for (const [k, v] of Object.entries(patch.categories)) {
      if (!Object.values(NOTIFICATION_CATEGORIES).includes(k)) continue;
      if (k === NOTIFICATION_CATEGORIES.billing || k === NOTIFICATION_CATEGORIES.security) continue; // enforced server-side
      if (typeof v === 'boolean') cats[k] = v;
    }
    next.categories = cats;
  }

  next.updatedAt = Date.now();

  await ref.set(next, { merge: true });
  return await getNotificationSettings(db, uid);
};

const computeEffectiveCategorySetting = ({
  storedSettings,
  category,
  recipientRole,
  defaultOptInIfNoSettings = false,
}) => {
  const role = recipientRole === ROLE_OWNER ? ROLE_OWNER : ROLE_DELEGATE;

  // Hard rules first.
  if (category === NOTIFICATION_CATEGORIES.billing) {
    // Delegates never receive billing emails.
    return { enabled: role === ROLE_OWNER, reason: role === ROLE_OWNER ? 'mandatory' : 'delegates_no_billing' };
  }

  if (category === NOTIFICATION_CATEGORIES.security) {
    // Security is mandatory for everyone.
    return { enabled: true, reason: 'mandatory' };
  }

  const stored = storedSettings ? normalizeSettingsDoc(storedSettings) : null;

  // If the user has opted out globally, only mandatory categories can be sent.
  if (stored && stored.emailEnabled === false) {
    return { enabled: false, reason: 'email_disabled' };
  }

  const explicit = stored && stored.categories && typeof stored.categories[category] === 'boolean' ? stored.categories[category] : null;
  if (explicit !== null) return { enabled: explicit, reason: 'user_setting' };

  if (!stored && defaultOptInIfNoSettings) {
    return { enabled: true, reason: 'no_settings_default_opt_in' };
  }

  return { enabled: defaultCategoryForRole({ category, role }), reason: 'default' };
};

const makeEmailEventDocId = (dedupeKey) => {
  const key = String(dedupeKey || '');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return `em_${hash}`;
};

const sendNotificationEmailIdempotent = async ({
  db,
  dedupeKey,
  category,
  to,
  recipientUid,
  recipientRole,
  vaultId,
  auditEventId,
  subject,
  text,
  html,
  defaultOptInIfNoSettings,
}) => {
  if (!db) throw new Error('Missing Firestore db');

  const safeCategory = Object.values(NOTIFICATION_CATEGORIES).includes(category) ? category : NOTIFICATION_CATEGORIES.security;
  const safeTo = typeof to === 'string' ? to.trim().toLowerCase() : '';

  const docId = makeEmailEventDocId(dedupeKey);
  const ref = db.collection('emailEvents').doc(docId);

  const existing = await ref.get();
  if (existing.exists) {
    return { ok: true, deduped: true, status: (existing.data() || {}).status || 'UNKNOWN' };
  }

  const storedSettings = recipientUid ? await getNotificationSettings(db, recipientUid) : null;
  const decision = computeEffectiveCategorySetting({
    storedSettings,
    category: safeCategory,
    recipientRole,
    defaultOptInIfNoSettings: !!defaultOptInIfNoSettings,
  });

  const canSend = !!safeTo && isEmailEnabled() && decision.enabled;

  const baseEvent = {
    id: docId,
    dedupeKey: String(dedupeKey || ''),
    category: safeCategory,
    to: safeTo,
    recipient_uid: recipientUid ? String(recipientUid) : null,
    recipient_role: recipientRole ? String(recipientRole) : null,
    vault_id: vaultId ? String(vaultId) : null,
    audit_event_id: auditEventId ? String(auditEventId) : null,
    createdAt: Date.now(),
    status: 'PENDING',
    reason: null,
    provider: null,
    sentAt: null,
    error: null,
  };

  // Write the email event first to guarantee idempotency.
  await ref.set(baseEvent, { merge: false });

  if (!safeTo) {
    await ref.set({ status: 'SKIPPED', reason: 'missing_recipient' }, { merge: true });
    return { ok: true, skipped: true, reason: 'missing_recipient' };
  }

  if (!isEmailEnabled()) {
    await ref.set({ status: 'SKIPPED', reason: 'email_provider_disabled' }, { merge: true });
    return { ok: true, skipped: true, reason: 'email_provider_disabled' };
  }

  if (!decision.enabled) {
    await ref.set({ status: 'SKIPPED', reason: decision.reason || 'user_pref' }, { merge: true });
    return { ok: true, skipped: true, reason: decision.reason || 'user_pref' };
  }

  try {
    const resp = await sendEmail({ to: safeTo, subject, text, html });
    await ref.set(
      {
        status: resp?.ok ? 'SENT' : 'SKIPPED',
        provider: resp?.provider || null,
        sentAt: resp?.ok ? Date.now() : null,
        reason: resp?.ok ? null : 'provider_skipped',
      },
      { merge: true }
    );
    return { ok: true, sent: !!resp?.ok, provider: resp?.provider || null };
  } catch (err) {
    await ref.set({ status: 'ERROR', error: err?.message ? String(err.message) : String(err) }, { merge: true });
    return { ok: false, error: err?.message ? String(err.message) : String(err) };
  }
};

module.exports = {
  NOTIFICATION_CATEGORIES,
  ROLE_OWNER,
  ROLE_DELEGATE,
  isCategoryMandatory,
  getRoleDefaults,
  ensureNotificationSettings,
  getNotificationSettings,
  updateNotificationSettings,
  computeEffectiveCategorySetting,
  sendNotificationEmailIdempotent,
};
