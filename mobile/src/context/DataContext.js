import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getItem, setItem, removeItem } from '../storage';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_DARK_MODE_ENABLED, getTheme } from '../theme';
import { getAssetCapabilities, getCollectionCapabilities, getVaultCapabilities } from '../policies/capabilities';
import { firebaseAuth, firestore, isFirebaseConfigured } from '../firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as firebaseUpdatePassword,
} from 'firebase/auth';
import { collection, collectionGroup, deleteDoc, doc, documentId, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { API_URL } from '../config/api';
import NetInfo from '@react-native-community/netinfo';
import { apiFetch } from '../utils/apiFetch';

const DATA_KEY = 'lamb-mobile-data-v6';
const LAST_ACTIVITY_KEY = 'lamb-mobile-last-activity-v1';
const BIOMETRIC_SECURE_USER_ID_KEY = 'lamb-mobile-biometric-userid-secure-v1';
const BIOMETRIC_ENABLED_USER_ID_KEY = 'lamb-mobile-biometric-userid-enabled-v1';
const STORAGE_VERSION = 6;
// Do not hardcode a remote default avatar URL.
// Avatar fallback is rendered in the UI when profileImage is missing or fails to load.
const DEFAULT_PROFILE_IMAGE = null;
const DEFAULT_MEDIA_IMAGE = null;
const DEFAULT_HERO_IMAGE = require('../../assets/default-hero.jpg');

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const TRIAL_DAYS = 14;

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

const NAME_MAX_LENGTH = 50;
const ITEM_TITLE_MAX_LENGTH = 35;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const EMAIL_MAX_LENGTH = 254;

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'qwerty',
  'qwerty123',
  '123456',
  '12345678',
  '123456789',
  '111111',
  'letmein',
  'admin',
  'welcome',
  'iloveyou',
  'changeme',
]);

const validatePasswordStrength = (password, { username, email } = {}) => {
  const raw = (password || '').toString();
  if (!raw) return { ok: false, message: 'Password is required' };

  if (raw.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer` };
  }
  if (/\s/.test(raw)) {
    return { ok: false, message: 'Password cannot contain spaces' };
  }

  const lower = raw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, message: 'Password is too common' };
  }

  const hasLetter = /[A-Za-z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  const hasSymbol = /[^A-Za-z0-9]/.test(raw);
  if (!hasLetter || !hasNumber || !hasSymbol) {
    return { ok: false, message: 'Password must include a letter, a number, and a symbol' };
  }

  const uname = (username || '').toString().trim().toLowerCase();
  if (uname && lower.includes(uname)) {
    return { ok: false, message: 'Password must not contain your username' };
  }

  const emailLocal = (email || '').toString().trim().toLowerCase().split('@')[0];
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return { ok: false, message: 'Password must not contain your email' };
  }

  return { ok: true };
};

const clampItemTitle = (value) => String(value || '').slice(0, ITEM_TITLE_MAX_LENGTH);

const stripInvisibleChars = (value) => {
  const raw = (value || '').toString();
  // Common zero-width/invisible chars that sometimes sneak in via copy/paste or autofill.
  return raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
};

const hasDisallowedControlChars = (value) => {
  const raw = (value || '').toString();
  // ASCII control chars + DEL. (Zero-width chars are stripped during normalization.)
  return /[\u0000-\u001F\u007F]/.test(raw);
};

const normalizeName = (value) => stripInvisibleChars(value).toString().trim().replace(/\s+/g, ' ');
const validateName = (value, label) => {
  const v = normalizeName(value);
  if (!v) return { ok: false, message: `${label} is required` };
  if (v.length > NAME_MAX_LENGTH) return { ok: false, message: `${label} must be ${NAME_MAX_LENGTH} characters or fewer` };
  if (hasDisallowedControlChars(v)) return { ok: false, message: `${label} contains invalid characters` };
  return { ok: true, value: v };
};

const normalizeUsername = (value) => stripInvisibleChars(value).toString().trim().toLowerCase();
const validateUsername = (value) => {
  const v = normalizeUsername(value);
  if (!v) return { ok: false, message: 'Username is required' };
  if (v.length < USERNAME_MIN_LENGTH) return { ok: false, message: `Username must be at least ${USERNAME_MIN_LENGTH} characters` };
  if (v.length > USERNAME_MAX_LENGTH) return { ok: false, message: `Username must be ${USERNAME_MAX_LENGTH} characters or fewer` };
  if (hasDisallowedControlChars(v)) return { ok: false, message: 'Username contains invalid characters' };
  if (/\s/.test(v)) return { ok: false, message: 'Username cannot contain spaces' };
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(v)) {
    return { ok: false, message: 'Username can only use letters, numbers, dot, underscore, and hyphen' };
  }
  return { ok: true, value: v };
};

const normalizeEmail = (value) => stripInvisibleChars(value).toString().trim().toLowerCase();
const validateEmail = (value) => {
  const v = normalizeEmail(value);
  if (!v) return { ok: false, message: 'Email is required' };
  if (v.length > EMAIL_MAX_LENGTH) return { ok: false, message: 'Email is too long' };
  if (hasDisallowedControlChars(v)) return { ok: false, message: 'Email contains invalid characters' };
  if (/\s/.test(v)) return { ok: false, message: 'Email cannot contain spaces' };
  // Practical (not fully RFC) validation; matches common Apple/UX expectations.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, message: 'Please enter a valid email address' };
  return { ok: true, value: v };
};

const isFirebaseAuthEnabled = () => !!firebaseAuth && isFirebaseConfigured();

const mapFirestoreError = (error) => {
  const code = error?.code ? String(error.code) : '';
  if (code === 'permission-denied') return 'Not allowed. Your permissions do not allow this action.';
  if (code === 'unauthenticated') return 'You are signed out. Please sign in again.';
  if (code === 'unavailable') return 'Network unavailable. Try again when you are back online.';
  return error?.message || 'Request failed';
};

const mapFirebaseAuthError = (error) => {
  const code = error?.code ? String(error.code) : '';
  if (code === 'auth/email-already-in-use') return 'This email is already in use';
  if (code === 'auth/invalid-email') return 'Please enter a valid email address';
  if (code === 'auth/weak-password') return 'Password is too weak';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Invalid credentials';
  }
  if (code === 'auth/user-disabled') return 'This account is disabled';
  if (code === 'auth/network-request-failed') return 'Network error. Please try again.';
  return error?.message || 'Authentication failed';
};

const generateStrongPassword = (length = 16) => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*()-_=+[]{};:,.?';
  const all = `${letters}${digits}${symbols}`;

  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(letters), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));

  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

const withoutPasswordSecrets = (user) => {
  if (!user) return user;
  const next = { ...user };
  delete next.password;
  delete next.passwordHash;
  return next;
};

const withoutPasswordForStorage = (user) => {
  if (!user) return user;
  const next = { ...user };
  delete next.password;
  delete next.passwordHash;
  return next;
};

const sanitizeUsersOnLoad = (inputUsers) => {
  const list = Array.isArray(inputUsers) ? inputUsers : [];
  return list.map((user) => {
    if (!user) return user;
    const next = { ...user };
    delete next.password;
    delete next.passwordHash;
    if (typeof next.prefersDarkMode !== 'boolean') {
      next.prefersDarkMode = DEFAULT_DARK_MODE_ENABLED;
    }
    return next;
  });
};

const normalizeRole = (role) => {
  if (!role) return null;
  const raw = role.toString().trim().toLowerCase();
  if (raw === 'viewer' || raw === 'reviewer') return 'reviewer';
  if (raw === 'editor') return 'editor';
  if (raw === 'manager') return 'manager';
  if (raw === 'owner') return 'owner';
  return raw;
};

// Subscription tiers with features
const SUBSCRIPTION_TIERS = {
  BASIC: { 
    id: 'BASIC', 
    name: 'Basic', 
    price: 4.99, 
    period: 'month', 
    annualPrice: 49.99,
    annualPeriod: 'year',
    description: 'Get started with LAMB',
    features: [
      'Up to 5 vaults',
      'Basic organization tools',
      'Email support',
      'Mobile app access'
    ]
  },
  PREMIUM: { 
    id: 'PREMIUM', 
    name: 'Premium', 
    price: 9.99, 
    period: 'month', 
    annualPrice: 99.99,
    annualPeriod: 'year',
    description: 'Advanced features',
    features: [
      'Unlimited vaults',
      'Advanced analytics',
      'Priority email support',
      'API access',
      'Custom metadata'
    ]
  },
  PRO: { 
    id: 'PRO', 
    name: 'Pro', 
    price: 19.99, 
    period: 'month', 
    annualPrice: 199.99,
    annualPeriod: 'year',
    description: 'Full access',
    features: [
      'Unlimited everything',
      'Advanced analytics & reports',
      'Priority 24/7 support',
      'API access + webhooks',
      'Custom workflows',
      'Team collaboration',
      'Advanced security'
    ]
  }
};

const withProfileImage = (user) => user;

// NOTE: Subscription gating is being refactored to be Vault-based.
// For back-compat during migration, we keep the legacy helpers.
const hasMembershipStillActive = (user) => {
  const tier = user?.subscription?.tier;
  if (!tier) return false;
  const renewalDate = user?.subscription?.renewalDate;
  if (typeof renewalDate === 'number') {
    if (Date.now() >= renewalDate) return false;
  }
  return true;
};

// Product rule: delegates never require a paid membership.
// Until subscriptions are fully vault-based in-app, owners still use legacy local subscription gating.
const hasMembershipAccess = (user, vaultMemberships = []) => {
  const uid = user?.id ? String(user.id) : null;
  if (uid) {
    const activeMembership = (vaultMemberships || []).some(
      (m) => m?.user_id === uid && m?.status === MEMBERSHIP_STATUS.ACTIVE
    );
    if (activeMembership) return true;
  }

  if (!hasMembershipStillActive(user)) return false;
  if (user?.subscription?.cancelAtPeriodEnd === true) return false;
  return true;
};

const hasActiveMembership = (user) => {
  // Back-compat: treat "active" as "still active until period end".
  return hasMembershipStillActive(user);
};

const VAULT_ROLE = {
  OWNER: 'OWNER',
  DELEGATE: 'DELEGATE',
};

const MEMBERSHIP_STATUS = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
};

const SCOPE_TYPE = {
  VAULT: 'VAULT',
  COLLECTION: 'COLLECTION',
  ASSET: 'ASSET',
};

const PERM = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  MOVE: 'Move',
  CLONE: 'Clone',
  DELETE: 'Delete',
};

const emptyPerms = () => ({
  [PERM.VIEW]: false,
  [PERM.CREATE]: false,
  [PERM.EDIT]: false,
  [PERM.MOVE]: false,
  [PERM.CLONE]: false,
  [PERM.DELETE]: false,
});

const mergePerms = (base, patch) => ({
  ...(base || emptyPerms()),
  ...(patch || {}),
});

const legacyRoleToPerms = ({ role, canCreate = false } = {}) => {
  const r = normalizeRole(role);
  if (!r) return mergePerms(emptyPerms(), { [PERM.VIEW]: true });
  if (r === 'reviewer') return mergePerms(emptyPerms(), { [PERM.VIEW]: true });
  if (r === 'editor') return mergePerms(emptyPerms(), { [PERM.VIEW]: true, [PERM.EDIT]: true, [PERM.CREATE]: !!canCreate });
  if (r === 'manager') {
    return mergePerms(emptyPerms(), {
      [PERM.VIEW]: true,
      [PERM.EDIT]: true,
      [PERM.MOVE]: true,
      [PERM.CLONE]: true,
      [PERM.CREATE]: true,
    });
  }
  // Legacy "owner" in a share list is treated as a delegate with broad permissions (but not true ownership).
  if (r === 'owner') {
    return mergePerms(emptyPerms(), {
      [PERM.VIEW]: true,
      [PERM.CREATE]: true,
      [PERM.EDIT]: true,
      [PERM.MOVE]: true,
      [PERM.CLONE]: true,
      [PERM.DELETE]: true,
    });
  }
  return mergePerms(emptyPerms(), { [PERM.VIEW]: true });
};
const withMedia = (item) => {
  if (!item) return item;
  const images = Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 4) : [];
  const heroImage = item.heroImage && images.includes(item.heroImage)
    ? item.heroImage
    : images[0] || null;
  return { ...item, images, heroImage };
};

const migrateData = (data) => {
  if (!data) return data;
  const migrated = { ...data };
  migrated.vaults = (data.vaults || []).map((v) => withMedia(v));
  migrated.collections = (data.collections || []).map((c) => withMedia(c));
  migrated.assets = (data.assets || []).map((a) => withMedia(a));
  migrated.users = (data.users || []).map((u) => withProfileImage(u));
  migrated.currentUser = withoutPasswordSecrets(withProfileImage(data.currentUser));

  // New model stores roles/permissions via vaultMemberships + permissionGrants.
  const existingMemberships = Array.isArray(data.vaultMemberships) ? data.vaultMemberships : [];
  const existingGrants = Array.isArray(data.permissionGrants) ? data.permissionGrants : [];
  const existingAudit = Array.isArray(data.auditEvents) ? data.auditEvents : [];

  // If already migrated, keep as-is.
  if (existingMemberships.length || existingGrants.length || existingAudit.length) {
    migrated.vaultMemberships = existingMemberships;
    migrated.permissionGrants = existingGrants;
    migrated.auditEvents = existingAudit;
    return migrated;
  }

  const now = Date.now();
  const vaults = migrated.vaults || [];
  const collections = migrated.collections || [];
  const assets = migrated.assets || [];

  const memberships = [];
  const grants = [];

  const upsertMembership = ({ userId, vaultId, role, permissions }) => {
    if (!userId || !vaultId) return;
    const id = `${vaultId}:${userId}`;
    const existing = memberships.find((m) => m.id === id);
    if (existing) {
      // Prefer OWNER over DELEGATE, and prefer broader permissions.
      if (existing.role !== VAULT_ROLE.OWNER && role === VAULT_ROLE.OWNER) {
        existing.role = VAULT_ROLE.OWNER;
        existing.permissions = null;
      } else if (existing.role === VAULT_ROLE.DELEGATE && role === VAULT_ROLE.DELEGATE && permissions) {
        existing.permissions = mergePerms(existing.permissions, permissions);
      }
      return;
    }

    memberships.push({
      id,
      user_id: String(userId),
      vault_id: String(vaultId),
      role,
      permissions: role === VAULT_ROLE.OWNER ? null : (permissions || mergePerms(emptyPerms(), { [PERM.VIEW]: true })),
      status: MEMBERSHIP_STATUS.ACTIVE,
      assigned_at: now,
      revoked_at: null,
    });
  };

  const upsertGrant = ({ userId, vaultId, scopeType, scopeId, permissions }) => {
    if (!userId || !vaultId || !scopeType || !scopeId) return;
    const id = `${scopeType}:${scopeId}:${userId}`;
    const existing = grants.find((g) => g.id === id);
    if (existing) {
      existing.permissions = mergePerms(existing.permissions, permissions);
      return;
    }
    grants.push({
      id,
      user_id: String(userId),
      vault_id: String(vaultId),
      scope_type: scopeType,
      scope_id: String(scopeId),
      permissions: permissions || mergePerms(emptyPerms(), { [PERM.VIEW]: true }),
      assigned_at: now,
    });
  };

  // Vault owners become OWNER memberships.
  vaults.forEach((v) => {
    if (v?.id && v?.ownerId) {
      upsertMembership({ userId: v.ownerId, vaultId: v.id, role: VAULT_ROLE.OWNER });
    }

    // Vault-level shares become DELEGATE memberships (vault-scope permissions).
    (v?.sharedWith || []).forEach((s) => {
      const perms = legacyRoleToPerms({ role: s?.role, canCreate: !!s?.canCreateCollections });
      upsertMembership({ userId: s?.userId, vaultId: v.id, role: VAULT_ROLE.DELEGATE, permissions: perms });
    });
  });

  // Collection shares become collection-scope grants (and imply vault membership).
  collections.forEach((c) => {
    if (!c?.id || !c?.vaultId) return;
    if (c?.ownerId) upsertMembership({ userId: c.ownerId, vaultId: c.vaultId, role: VAULT_ROLE.OWNER });
    (c?.sharedWith || []).forEach((s) => {
      const perms = legacyRoleToPerms({ role: s?.role, canCreate: !!s?.canCreateAssets });
      upsertMembership({ userId: s?.userId, vaultId: c.vaultId, role: VAULT_ROLE.DELEGATE, permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }) });
      upsertGrant({ userId: s?.userId, vaultId: c.vaultId, scopeType: SCOPE_TYPE.COLLECTION, scopeId: c.id, permissions: perms });
    });
  });

  // Asset shares become asset-scope grants (and imply vault membership).
  assets.forEach((a) => {
    if (!a?.id || !a?.vaultId) return;
    if (a?.ownerId) upsertMembership({ userId: a.ownerId, vaultId: a.vaultId, role: VAULT_ROLE.OWNER });
    (a?.sharedWith || []).forEach((s) => {
      const perms = legacyRoleToPerms({ role: s?.role, canCreate: false });
      upsertMembership({ userId: s?.userId, vaultId: a.vaultId, role: VAULT_ROLE.DELEGATE, permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }) });
      upsertGrant({ userId: s?.userId, vaultId: a.vaultId, scopeType: SCOPE_TYPE.ASSET, scopeId: a.id, permissions: perms });
    });
  });

  // Strip legacy share arrays to avoid dual sources of truth.
  migrated.vaults = vaults.map((v) => ({ ...v, ownerId: v.ownerId || null, sharedWith: [] }));
  migrated.collections = collections.map((c) => ({ ...c, ownerId: c.ownerId || null, sharedWith: [] }));
  migrated.assets = assets.map((a) => ({ ...a, ownerId: a.ownerId || null, sharedWith: [] }));
  migrated.vaultMemberships = memberships;
  migrated.permissionGrants = grants;
  migrated.auditEvents = [];
  return migrated;
};

const normalizeUsersArray = (input) => (Array.isArray(input) ? input : []);

const seedUsers = [];

const seedVaults = [];

const seedCollections = [];

const seedAssets = [];

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [backendReachable, setBackendReachable] = useState(null);
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [biometricUserId, setBiometricUserId] = useState(null);
  const [vaults, setVaults] = useState([]);
  const [collections, setCollections] = useState([]);
  const [assets, setAssets] = useState([]);
  const [vaultMemberships, setVaultMemberships] = useState([]);
  const [permissionGrants, setPermissionGrants] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [lastActivityAt, setLastActivityAt] = useState(Date.now());
  const lastActivityWriteAtRef = useRef(0);
  const lastSubscriptionSyncAtRef = useRef(0);
  const ownerMembershipUnsubsRef = useRef([]);
  const vaultDocUnsubsRef = useRef([]);
  const vaultCollectionsUnsubsRef = useRef(new Map());
  const vaultAssetsUnsubsRef = useRef(new Map());
  const vaultGrantUnsubsRef = useRef([]);
  const dynamicVaultCollectionRefCountsRef = useRef(new Map());
  const dynamicVaultAssetRefCountsRef = useRef(new Map());
  const ownerVaultIdsRef = useRef([]);
  const reconcileVaultCollectionListenersRef = useRef(null);
  const reconcileVaultAssetListenersRef = useRef(null);

  const membershipRequiredResult = useMemo(
    () => ({ ok: false, message: 'Active membership required. Please renew your membership to continue.' }),
    []
  );

  const recordActivity = () => {
    if (!currentUser) return;
    const now = Date.now();
    setLastActivityAt(now);

    // Throttle writes to storage to avoid excessive IO.
    if (now - lastActivityWriteAtRef.current < 15000) return;
    lastActivityWriteAtRef.current = now;
    setItem(LAST_ACTIVITY_KEY, now);
  };

  const offlineResult = useMemo(
    () => ({ ok: false, message: 'Internet connection required. Please reconnect and try again.' }),
    []
  );

  const membershipActive = hasActiveMembership(currentUser);
  const membershipAccess = hasMembershipAccess(currentUser, vaultMemberships);

  const wrapOnline = (fn) =>
    (...args) => {
      if (backendReachable === false) return offlineResult;
      return fn(...args);
    };

  const wrapOnlineAsync = (fn) =>
    async (...args) => {
      if (backendReachable === false) return offlineResult;
      return await fn(...args);
    };

  const wrapFirestoreAsync = (fn) =>
    async (...args) => {
      if (backendReachable === false) return offlineResult;
      if (!currentUser?.id) return { ok: false, message: 'Not signed in' };
      if (!firestore) return { ok: false, message: 'Firestore is not configured' };
      if (!isFirebaseAuthEnabled() || !firebaseAuth?.currentUser?.uid) {
        return { ok: false, message: 'Authentication is unavailable' };
      }
      if (String(firebaseAuth.currentUser.uid) !== String(currentUser.id)) {
        return { ok: false, message: 'Session mismatch. Please sign in again.' };
      }
      try {
        return await fn(...args);
      } catch (error) {
        return { ok: false, message: mapFirestoreError(error) };
      }
    };

  const wrapOnlineAndMembership = (fn) =>
    (...args) => {
      if (backendReachable === false) return offlineResult;
      if (!membershipAccess) return membershipRequiredResult;
      return fn(...args);
    };

  const wrapOnlineAndMembershipAsync = (fn) =>
    async (...args) => {
      if (backendReachable === false) return offlineResult;
      if (!membershipAccess) return membershipRequiredResult;
      return await fn(...args);
    };

  const checkBackend = async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = setTimeout(() => controller?.abort?.(), 8000);
    try {
      const res = await apiFetch(`${API_URL}/health`, {
        method: 'GET',
        signal: controller?.signal,
        headers: { Accept: 'application/json' },
      });
      setBackendReachable(!!res.ok);
      return { ok: !!res.ok };
    } catch {
      setBackendReachable(false);
      return { ok: false };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Subscription state is managed by Apple IAP verification. The app can refresh app data
  // and/or prompt the user to restore purchases, but there is no backend subscription sync endpoint.

  const acceptInvitationCode = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return { ok: false, message: 'Enter an invite code' };

    try {
      const resp = await apiFetch(`${API_URL}/invitations/accept`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: raw }),
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        return { ok: false, message: (json && json.error) ? String(json.error) : 'Invite accept failed' };
      }

      const vault = json?.vault || null;
      const vaultId = json?.vaultId || vault?.id || null;
      if (!vaultId) return { ok: false, message: 'Invite accepted but vault was missing' };

      // Best-effort: store a local vault shell so it appears immediately.
      if (vault && vault.id) {
        setVaults((prev) => {
          const exists = (prev || []).some((v) => v?.id === vault.id);
          if (exists) return prev;
          const shell = {
            id: String(vault.id),
            name: vault.name || 'Shared Vault',
            ownerId: vault.activeOwnerId || vault.ownerId || null,
            sharedWith: [],
            createdAt: typeof vault.createdAt === 'number' ? vault.createdAt : Date.now(),
            viewedAt: Date.now(),
            editedAt: Date.now(),
            heroImage: DEFAULT_MEDIA_IMAGE,
            images: [],
          };
          return [shell, ...(prev || [])];
        });
      }

      if (currentUser?.id) {
        upsertMembership({ userId: currentUser.id, vaultId, role: VAULT_ROLE.DELEGATE, permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }) });
      }

      return { ok: true, vaultId };
    } catch (error) {
      return { ok: false, message: error?.message || 'Invite accept failed' };
    }
  };

  const enforceSessionTimeout = async () => {
    if (!currentUser) return { ok: true };
    try {
      const stored = await getItem(LAST_ACTIVITY_KEY, null);
      const storedMs = typeof stored === 'number' ? stored : null;
      // Prefer the freshest of (persisted) and (in-memory) timestamps.
      const last = Math.max(storedMs || 0, lastActivityAt || 0);
      if (Date.now() - last >= SESSION_TIMEOUT_MS) {
        setCurrentUser(null);
        await removeItem(LAST_ACTIVITY_KEY);
        return { ok: false, expired: true };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || 'Session check failed' };
    }
  };

  const refreshData = async () => {
    try {
      const stored = await getItem(DATA_KEY, null);
      if (!stored) return { ok: false, message: 'No stored data' };

      const migrated = migrateData(stored);
      const hydratedUsers = sanitizeUsersOnLoad(normalizeUsersArray(migrated.users));

      setUsers(hydratedUsers);

      const storedCurrent = migrated.currentUser || null;
      const matchingUser = storedCurrent
        ? hydratedUsers.find((u) => u?.id && u.id === storedCurrent.id)
        : null;
      const nextCurrentUser = matchingUser
        ? withoutPasswordSecrets(withProfileImage(matchingUser))
        : storedCurrent;

      setCurrentUser(nextCurrentUser);
      setVaults(migrated.vaults || []);
      setCollections(migrated.collections || []);
      setAssets(migrated.assets || []);
      setVaultMemberships(migrated.vaultMemberships || []);
      setPermissionGrants(migrated.permissionGrants || []);
      setAuditEvents(migrated.auditEvents || []);

      await setItem(DATA_KEY, {
        ...migrated,
        version: STORAGE_VERSION,
        users: hydratedUsers.map(withoutPasswordForStorage),
        currentUser: nextCurrentUser,
      });

      return { ok: true };
    } catch (error) {
      console.error('Error refreshing data:', error);
      return { ok: false, message: error?.message || 'Refresh failed' };
    }
  };

    useEffect(() => {
      (async () => {
        // Enforce online-only behavior by verifying the staging backend is reachable.
        await checkBackend();

        await removeItem('lamb-mobile-data-v1'); // clean legacy
        await removeItem('lamb-mobile-data-v2'); // clean previous version

        // Legacy cleanup: biometric enabled marker used to live in AsyncStorage.
        await removeItem('lamb-mobile-biometric-user-id-v1');

        const storedBiometricUserId = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_USER_ID_KEY).catch(() => null);
        if (typeof storedBiometricUserId === 'string' && storedBiometricUserId) {
          setBiometricUserId(storedBiometricUserId);
        } else {
          setBiometricUserId(null);
        }

        const last = await getItem(LAST_ACTIVITY_KEY, null);
        if (typeof last === 'number' && Number.isFinite(last)) {
          setLastActivityAt(last);
          lastActivityWriteAtRef.current = last;
        } else {
          const now = Date.now();
          setLastActivityAt(now);
          lastActivityWriteAtRef.current = now;
          await setItem(LAST_ACTIVITY_KEY, now);
        }
        const stored = await getItem(DATA_KEY, null);
        if (stored && stored.version === STORAGE_VERSION) {
          const migrated = migrateData(stored);
          const hydratedUsers = sanitizeUsersOnLoad(normalizeUsersArray(migrated.users));
          setUsers(hydratedUsers);
          setCurrentUser(migrated.currentUser || null);
          setVaults(migrated.vaults || []);
          setCollections(migrated.collections || []);
          setAssets(migrated.assets || []);
          setVaultMemberships(migrated.vaultMemberships || []);
          setPermissionGrants(migrated.permissionGrants || []);
          setAuditEvents(migrated.auditEvents || []);
          await setItem(DATA_KEY, { ...migrated, users: hydratedUsers.map(withoutPasswordForStorage), version: STORAGE_VERSION });
        } else {
          // Migrate from legacy key (v5) if present.
          const legacyStored = await getItem('lamb-mobile-data-v5', null);
          if (legacyStored) {
            const migrated = migrateData(legacyStored);
            const hydratedUsers = sanitizeUsersOnLoad(normalizeUsersArray(migrated.users));
            setUsers(hydratedUsers);
            setCurrentUser(migrated.currentUser || null);
            setVaults(migrated.vaults || []);
            setCollections(migrated.collections || []);
            setAssets(migrated.assets || []);
            setVaultMemberships(migrated.vaultMemberships || []);
            setPermissionGrants(migrated.permissionGrants || []);
            setAuditEvents(migrated.auditEvents || []);
            await setItem(DATA_KEY, { ...migrated, users: hydratedUsers.map(withoutPasswordForStorage), version: STORAGE_VERSION });
            await removeItem('lamb-mobile-data-v5');
          } else {
          // Start with an empty local state (no seeded users or content).
          const seedData = { users: [], vaults: [], collections: [], assets: [], currentUser: null };
          const migratedSeed = migrateData(seedData);
          const hydratedUsers = sanitizeUsersOnLoad(normalizeUsersArray(migratedSeed.users));
          setUsers(hydratedUsers);
          setCurrentUser(migratedSeed.currentUser);
          setVaults(migratedSeed.vaults);
          setCollections(migratedSeed.collections);
          setAssets(migratedSeed.assets);
          setVaultMemberships(migratedSeed.vaultMemberships || []);
          setPermissionGrants(migratedSeed.permissionGrants || []);
          setAuditEvents(migratedSeed.auditEvents || []);
          await setItem(DATA_KEY, {
            version: STORAGE_VERSION,
            users: hydratedUsers.map(withoutPasswordForStorage),
            currentUser: migratedSeed.currentUser,
            vaults: migratedSeed.vaults,
            collections: migratedSeed.collections,
            assets: migratedSeed.assets,
            vaultMemberships: migratedSeed.vaultMemberships || [],
            permissionGrants: migratedSeed.permissionGrants || [],
            auditEvents: migratedSeed.auditEvents || [],
          });
          }
        }

        setLoading(false);
      })();
    }, []);

    useEffect(() => {
      if (loading) return;
      if (!currentUser) return;
    }, [
      loading,
      currentUser?.id,
      currentUser?.subscription?.tier,
      currentUser?.subscription?.cancelAtPeriodEnd,
      backendReachable,
    ]);

    useEffect(() => {
      // Near-instant offline detection: if the device loses internet, immediately block writes.
      const unsub = NetInfo.addEventListener((state) => {
        const internetReachable = state.isInternetReachable;
        const online = !!state.isConnected && internetReachable !== false;
        if (!online) {
          setBackendReachable(false);
          return;
        }
        // When coming back online, verify the backend is reachable.
        checkBackend();
      });

      // Lightweight backend liveness check (covers "internet is up but backend is down").
      const id = setInterval(() => {
        checkBackend();
      }, 10 * 1000);

      return () => {
        unsub?.();
        clearInterval(id);
      };
    }, []);

    useEffect(() => {
      if (loading) return;
      if (!firestore) return;
      if (!currentUser?.id) return;

      const uid = String(currentUser.id);

      const cleanupOwnerMembershipListeners = () => {
        const unsubs = ownerMembershipUnsubsRef.current || [];
        unsubs.forEach((fn) => {
          try {
            fn?.();
          } catch {
            // ignore
          }
        });
        ownerMembershipUnsubsRef.current = [];
      };

      const cleanupVaultDocListeners = () => {
        const unsubs = vaultDocUnsubsRef.current || [];
        unsubs.forEach((fn) => {
          try {
            fn?.();
          } catch {
            // ignore
          }
        });
        vaultDocUnsubsRef.current = [];
      };

      const cleanupVaultCollectionListeners = () => {
        const map = vaultCollectionsUnsubsRef.current;
        if (map && typeof map.forEach === 'function') {
          map.forEach((fn) => {
            try {
              fn?.();
            } catch {
              // ignore
            }
          });
          try {
            map.clear?.();
          } catch {
            // ignore
          }
        }
        vaultCollectionsUnsubsRef.current = new Map();
      };

      const cleanupVaultAssetListeners = () => {
        const map = vaultAssetsUnsubsRef.current;
        if (map && typeof map.forEach === 'function') {
          map.forEach((fn) => {
            try {
              fn?.();
            } catch {
              // ignore
            }
          });
          try {
            map.clear?.();
          } catch {
            // ignore
          }
        }
        vaultAssetsUnsubsRef.current = new Map();
      };

      const cleanupVaultGrantListeners = () => {
        const unsubs = vaultGrantUnsubsRef.current || [];
        unsubs.forEach((fn) => {
          try {
            fn?.();
          } catch {
            // ignore
          }
        });
        vaultGrantUnsubsRef.current = [];
      };

      const chunk = (arr, size) => {
        const list = Array.isArray(arr) ? arr : [];
        if (!list.length) return [];
        const s = Math.max(1, Number(size) || 10);
        const out = [];
        for (let i = 0; i < list.length; i += s) out.push(list.slice(i, i + s));
        return out;
      };

      const mergeById = (prev, items) => {
        const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
        if (!nextItems.length) return prev;
        const base = Array.isArray(prev) ? [...prev] : [];
        const idxById = new Map(base.map((x, idx) => [x?.id, idx]));
        for (const it of nextItems) {
          if (!it?.id) continue;
          const existingIdx = idxById.get(it.id);
          if (typeof existingIdx === 'number') {
            base[existingIdx] = { ...base[existingIdx], ...it };
          } else {
            idxById.set(it.id, base.length);
            base.push(it);
          }
        }
        return base;
      };

      const replaceForVault = ({ prev, vaultId, vaultField, items }) => {
        const base = Array.isArray(prev) ? prev : [];
        const vId = String(vaultId);
        const nextItems = Array.isArray(items) ? items.filter(Boolean) : [];
        return [...base.filter((x) => String(x?.[vaultField]) !== vId), ...nextItems];
      };

      const getDynamicCollectionVaultIds = () => {
        const out = [];
        const map = dynamicVaultCollectionRefCountsRef.current;
        if (!map || typeof map.entries !== 'function') return out;
        for (const [vId, count] of map.entries()) {
          const n = Number(count) || 0;
          if (n > 0 && vId) out.push(String(vId));
        }
        return out;
      };

      const reconcileVaultCollectionListeners = ({ baseVaultIds = [] } = {}) => {
        const base = Array.isArray(baseVaultIds) ? baseVaultIds.map((x) => String(x)).filter(Boolean) : [];
        const desired = new Set([...base, ...getDynamicCollectionVaultIds()]);

        if (!(vaultCollectionsUnsubsRef.current instanceof Map)) {
          vaultCollectionsUnsubsRef.current = new Map();
        }

        for (const [vId, unsub] of vaultCollectionsUnsubsRef.current.entries()) {
          if (desired.has(vId)) continue;
          try {
            unsub?.();
          } catch {
            // ignore
          }
          vaultCollectionsUnsubsRef.current.delete(vId);
          setCollections((prev) => (prev || []).filter((c) => String(c?.vaultId || '') !== String(vId)));
        }

        desired.forEach((vId) => {
          if (!vId) return;
          if (vaultCollectionsUnsubsRef.current.has(vId)) return;

          const colRef = collection(firestore, 'vaults', String(vId), 'collections');
          const unsub = onSnapshot(
            colRef,
            (csnap) => {
              const remoteCollections = csnap.docs
                .map((d) => ({ id: String(d.id), vaultId: String(vId), ...(d.data() || {}) }))
                .filter((c) => c?.id);
              setCollections((prev) => replaceForVault({ prev, vaultId: vId, vaultField: 'vaultId', items: remoteCollections }));
            },
            () => {
              // ignore
            }
          );

          vaultCollectionsUnsubsRef.current.set(vId, unsub);
        });
      };

      const getDynamicAssetVaultIds = () => {
        const out = [];
        const map = dynamicVaultAssetRefCountsRef.current;
        if (!map || typeof map.entries !== 'function') return out;
        for (const [vId, count] of map.entries()) {
          const n = Number(count) || 0;
          if (n > 0 && vId) out.push(String(vId));
        }
        return out;
      };

      const reconcileVaultAssetListeners = ({ baseVaultIds = [] } = {}) => {
        const base = Array.isArray(baseVaultIds) ? baseVaultIds.map((x) => String(x)).filter(Boolean) : [];
        const desired = new Set([...base, ...getDynamicAssetVaultIds()]);

        if (!(vaultAssetsUnsubsRef.current instanceof Map)) {
          vaultAssetsUnsubsRef.current = new Map();
        }

        for (const [vId, unsub] of vaultAssetsUnsubsRef.current.entries()) {
          if (desired.has(vId)) continue;
          try {
            unsub?.();
          } catch {
            // ignore
          }
          vaultAssetsUnsubsRef.current.delete(vId);
          setAssets((prev) => (prev || []).filter((a) => String(a?.vaultId || '') !== String(vId)));
        }

        desired.forEach((vId) => {
          if (!vId) return;
          if (vaultAssetsUnsubsRef.current.has(vId)) return;

          const assetsRef = collection(firestore, 'vaults', String(vId), 'assets');
          const unsub = onSnapshot(
            assetsRef,
            (asnap) => {
              const remoteAssets = asnap.docs
                .map((d) => ({ id: String(d.id), vaultId: String(vId), ...(d.data() || {}) }))
                .filter((a) => a?.id);
              setAssets((prev) => replaceForVault({ prev, vaultId: vId, vaultField: 'vaultId', items: remoteAssets }));
            },
            () => {
              // ignore
            }
          );

          vaultAssetsUnsubsRef.current.set(vId, unsub);
        });
      };

      reconcileVaultAssetListenersRef.current = reconcileVaultAssetListeners;
      reconcileVaultCollectionListenersRef.current = reconcileVaultCollectionListeners;

      const normalizeMembershipDoc = ({ vaultId, docId, data }) => {
        const raw = data || {};
        const vId = raw.vault_id ? String(raw.vault_id) : (vaultId ? String(vaultId) : null);
        const uId = raw.user_id ? String(raw.user_id) : (docId ? String(docId) : null);
        if (!vId || !uId) return null;
        return {
          ...raw,
          id: `${vId}:${uId}`,
          vault_id: vId,
          user_id: uId,
        };
      };

      const normalizeVaultDoc = ({ docId, data }) => {
        const raw = data || {};
        const id = String(docId);
        return {
          ...raw,
          id,
          ownerId: raw.activeOwnerId || raw.ownerId || null,
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : (raw.createdAt?.toMillis ? raw.createdAt.toMillis() : raw.createdAt) || Date.now(),
        };
      };

      cleanupOwnerMembershipListeners();
      cleanupVaultDocListeners();
      cleanupVaultCollectionListeners();
      cleanupVaultAssetListeners();
      cleanupVaultGrantListeners();

      let delegateMemberships = [];
      let ownedVaultMemberships = [];

      const recomputeMemberships = () => {
        const combined = [...delegateMemberships, ...ownedVaultMemberships];
        // Deduplicate by id.
        const seen = new Set();
        const deduped = [];
        for (const m of combined) {
          if (!m?.id) continue;
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          deduped.push(m);
        }
        setVaultMemberships((prev) => mergeById(prev, deduped));
      };

      const myMembershipsQuery = query(
        collectionGroup(firestore, 'memberships'),
        where('user_id', '==', uid),
        where('status', '==', 'ACTIVE')
      );

      const unsubMyMemberships = onSnapshot(
        myMembershipsQuery,
        (snap) => {
          const myMemberships = snap.docs
            .map((d) => normalizeMembershipDoc({ vaultId: d.data()?.vault_id || d.ref?.parent?.parent?.id, docId: d.id, data: d.data() }))
            .filter(Boolean);

          const ownerVaultIds = myMemberships
            .filter((m) => m.role === VAULT_ROLE.OWNER)
            .map((m) => String(m.vault_id));

          delegateMemberships = myMemberships.filter((m) => m.role !== VAULT_ROLE.OWNER);
          ownedVaultMemberships = [];
          cleanupOwnerMembershipListeners();
          recomputeMemberships();

          // If I'm an owner of a vault, also load *all* memberships in that vault.
          ownerMembershipUnsubsRef.current = ownerVaultIds.map((vaultId) => {
            const membershipsCol = collection(firestore, 'vaults', String(vaultId), 'memberships');
            return onSnapshot(
              membershipsCol,
              (msnap) => {
                const members = msnap.docs
                  .map((d) => normalizeMembershipDoc({ vaultId, docId: d.id, data: d.data() }))
                  .filter(Boolean);

                ownedVaultMemberships = [
                  ...ownedVaultMemberships.filter((m) => m.vault_id !== String(vaultId)),
                  ...members,
                ];
                recomputeMemberships();
              },
              () => {
                // ignore snapshot errors; local data still works.
              }
            );
          });

          // Hydrate vault docs for any vault where I'm an active delegate.
          const vaultIds = Array.from(new Set(myMemberships.map((m) => String(m.vault_id)).filter(Boolean)));
          cleanupVaultDocListeners();
          vaultDocUnsubsRef.current = chunk(vaultIds, 10).map((ids) => {
            const vaultsQuery = query(collection(firestore, 'vaults'), where(documentId(), 'in', ids));
            return onSnapshot(
              vaultsQuery,
              (vsnap) => {
                const remoteVaults = vsnap.docs.map((d) => normalizeVaultDoc({ docId: d.id, data: d.data() })).filter(Boolean);
                setVaults((prev) => mergeById(prev, remoteVaults));
              },
              () => {
                // ignore
              }
            );
          });

          // Collections + assets are scoped to owned vaults by default, plus any vault retained by a screen.
          cleanupVaultCollectionListeners();
          cleanupVaultGrantListeners();

          ownerVaultIdsRef.current = ownerVaultIds;
          reconcileVaultCollectionListeners({ baseVaultIds: ownerVaultIds });
          reconcileVaultAssetListeners({ baseVaultIds: ownerVaultIds });

          vaultGrantUnsubsRef.current = vaultIds.map((vaultId) => {
            const grantsRef = collection(firestore, 'vaults', String(vaultId), 'permissionGrants');
            return onSnapshot(
              grantsRef,
              (gsnap) => {
                const remoteGrants = gsnap.docs
                  .map((d) => ({ id: String(d.id), vault_id: String(vaultId), ...(d.data() || {}) }))
                  .filter((g) => g?.id);
                setPermissionGrants((prev) => replaceForVault({ prev, vaultId, vaultField: 'vault_id', items: remoteGrants }));
              },
              () => {
                // ignore
              }
            );
          });
        },
        () => {
          // ignore snapshot errors; local data still works.
        }
      );

      return () => {
        try {
          unsubMyMemberships?.();
        } catch {
          // ignore
        }
        cleanupOwnerMembershipListeners();
        cleanupVaultDocListeners();
        cleanupVaultCollectionListeners();
        cleanupVaultAssetListeners();
        cleanupVaultGrantListeners();
      };
    }, [loading, currentUser?.id]);

    useEffect(() => {
      if (loading) return;
      setItem(DATA_KEY, {
        version: STORAGE_VERSION,
        users: users.map(withoutPasswordForStorage),
        currentUser,
        vaults,
        collections,
        assets,
        vaultMemberships,
        permissionGrants,
        auditEvents,
      });
    }, [users, currentUser, vaults, collections, assets, vaultMemberships, permissionGrants, auditEvents, loading]);

  const appendAuditEvent = ({ actorId, actorRole, action, target, before_state, after_state }) => {
    const evt = {
      id: `ae_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      actor_id: actorId || null,
      actor_role: actorRole || null,
      action: action || 'UNKNOWN',
      target: target || null,
      before_state: before_state ?? null,
      after_state: after_state ?? null,
      timestamp: Date.now(),
    };
    setAuditEvents((prev) => [evt, ...(prev || [])]);
  };

  const getMembership = (vaultId, userId) => {
    if (!vaultId || !userId) return null;
    return (vaultMemberships || []).find(
      (m) => m?.vault_id === String(vaultId) && m?.user_id === String(userId) && m?.status === MEMBERSHIP_STATUS.ACTIVE
    ) || null;
  };

  const getActiveOwnerMembership = (vaultId) => {
    if (!vaultId) return null;
    const owners = (vaultMemberships || []).filter(
      (m) => m?.vault_id === String(vaultId) && m?.status === MEMBERSHIP_STATUS.ACTIVE && m?.role === VAULT_ROLE.OWNER
    );
    if (owners.length === 1) return owners[0];
    return owners[0] || null;
  };

  const isOwnerForVault = (vaultId, userId) => {
    const m = getMembership(vaultId, userId);
    return !!m && m.role === VAULT_ROLE.OWNER;
  };

  const getVaultPerms = (vaultId, userId) => {
    const m = getMembership(vaultId, userId);
    if (!m) return null;
    if (m.role === VAULT_ROLE.OWNER) {
      return mergePerms(emptyPerms(), {
        [PERM.VIEW]: true,
        [PERM.CREATE]: true,
        [PERM.EDIT]: true,
        [PERM.MOVE]: true,
        [PERM.CLONE]: true,
        [PERM.DELETE]: true,
      });
    }
    return mergePerms(emptyPerms(), m.permissions || { [PERM.VIEW]: true });
  };

  const getGrantPerms = ({ vaultId, scopeType, scopeId, userId }) => {
    if (!vaultId || !scopeType || !scopeId || !userId) return null;
    const g = (permissionGrants || []).find(
      (x) => x?.vault_id === String(vaultId) && x?.scope_type === scopeType && x?.scope_id === String(scopeId) && x?.user_id === String(userId)
    );
    if (!g) return null;
    return mergePerms(emptyPerms(), g.permissions || { [PERM.VIEW]: true });
  };

  const canDo = ({ vaultId, collectionId, assetId, userId, permission }) => {
    if (!vaultId || !userId || !permission) return false;
    if (isOwnerForVault(vaultId, userId)) return true;

    // Most specific scope wins.
    if (assetId) {
      const assetPerms = getGrantPerms({ vaultId, scopeType: SCOPE_TYPE.ASSET, scopeId: assetId, userId });
      if (assetPerms && assetPerms[permission]) return true;
      if (assetPerms) return false;
    }

    if (collectionId) {
      const colPerms = getGrantPerms({ vaultId, scopeType: SCOPE_TYPE.COLLECTION, scopeId: collectionId, userId });
      if (colPerms && colPerms[permission]) return true;
      if (colPerms) return false;
    }

    const vPerms = getVaultPerms(vaultId, userId);
    return !!vPerms && !!vPerms[permission];
  };

    const setDarkModeEnabled = (enabled) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };

      const merged = { ...currentUser, prefersDarkMode: !!enabled };
      setCurrentUser(merged);
      setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? { ...u, prefersDarkMode: !!enabled } : u)));
      return { ok: true };
    };

    const login = async (identifier, password) => {
      const id = (identifier || '').toString().trim().toLowerCase();
      if (!id || !password) return { ok: false, message: 'Invalid credentials' };

      const found = users.find((u) => {
        const uname = u?.username ? normalizeUsername(u.username) : null;
        const em = u?.email ? normalizeEmail(u.email) : null;
        return (uname && uname === id) || (em && em === id);
      });

      const emailForFirebase = id.includes('@') ? id : normalizeEmail(found?.email || '');
      if (!isFirebaseAuthEnabled() || !emailForFirebase) {
        return { ok: false, message: 'Authentication is unavailable' };
      }

      try {
        await signInWithEmailAndPassword(firebaseAuth, emailForFirebase, String(password));
      } catch (error) {
        return { ok: false, message: mapFirebaseAuthError(error) };
      }

      const fbUser = firebaseAuth?.currentUser || null;
      const uid = fbUser?.uid ? String(fbUser.uid) : null;
      const email = fbUser?.email ? normalizeEmail(fbUser.email) : emailForFirebase;
      if (!uid) return { ok: false, message: 'Authentication failed' };

      const local =
        users.find((u) => u?.firebaseUid && String(u.firebaseUid) === uid) ||
        users.find((u) => u?.email && normalizeEmail(u.email) === email) ||
        null;

      if (!local) {
        const now = Date.now();
        const newUser = {
          id: uid,
          firstName: '',
          lastName: '',
          email,
          username: email.split('@')[0] || 'user',
          prefersDarkMode: DEFAULT_DARK_MODE_ENABLED,
          profileImage: null,
          firebaseUid: uid,
          subscription: null,
        };
        setUsers((prev) => [...prev, newUser]);
        setCurrentUser(withoutPasswordSecrets(withProfileImage(newUser)));
        const nowMs = now;
        setLastActivityAt(nowMs);
        lastActivityWriteAtRef.current = nowMs;
        setItem(LAST_ACTIVITY_KEY, nowMs);
        return { ok: true };
      }

      const ensured = withProfileImage({ ...local, id: local.id || uid, firebaseUid: uid, email });
      setCurrentUser(withoutPasswordSecrets(ensured));
      const now = Date.now();
      setLastActivityAt(now);
      lastActivityWriteAtRef.current = now;
      setItem(LAST_ACTIVITY_KEY, now);
      return { ok: true };
    };

    const loginByUserId = (userId) => {
      const found = users.find((u) => u?.id === userId);
      if (!found) return { ok: false, message: 'Account not found' };

      // With server-side auth enforced, Face ID can only unlock the app if Firebase Auth
      // already has an active session for this user (we do not store passwords).
      if (isFirebaseAuthEnabled()) {
        const fbUid = firebaseAuth?.currentUser?.uid ? String(firebaseAuth.currentUser.uid) : null;
        if (!fbUid) {
          return { ok: false, message: 'Session expired. Please sign in with your password.' };
        }
        if (fbUid !== String(userId)) {
          return { ok: false, message: 'Please sign in with your password.' };
        }
      }

      const ensured = withProfileImage(found);
      setCurrentUser(withoutPasswordSecrets(ensured));
      const now = Date.now();
      setLastActivityAt(now);
      lastActivityWriteAtRef.current = now;
      setItem(LAST_ACTIVITY_KEY, now);
      return { ok: true };
    };

    const enableBiometricSignInForCurrentUser = async () => {
      if (!currentUser?.id) return { ok: false, message: 'Not signed in' };
      try {
        const available = await SecureStore.isAvailableAsync();
        if (!available) return { ok: false, message: 'Secure storage is not available on this device' };

        await SecureStore.setItemAsync(BIOMETRIC_SECURE_USER_ID_KEY, String(currentUser.id), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          requireAuthentication: true,
          authenticationPrompt: 'Enable Face ID to sign in',
        });

        await SecureStore.setItemAsync(BIOMETRIC_ENABLED_USER_ID_KEY, String(currentUser.id), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });

        setBiometricUserId(String(currentUser.id));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error?.message || 'Face ID setup failed' };
      }
    };

    const disableBiometricSignIn = async () => {
      try {
        setBiometricUserId(null);
        try {
          await SecureStore.deleteItemAsync(BIOMETRIC_SECURE_USER_ID_KEY);
          await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_USER_ID_KEY);
        } catch {
          // ignore
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error?.message || 'Could not disable Face ID' };
      }
    };

    const biometricLogin = async () => {
      try {
        const available = await SecureStore.isAvailableAsync();
        if (!available) return { ok: false, message: 'Secure storage is not available on this device' };

        const userId = await SecureStore.getItemAsync(BIOMETRIC_SECURE_USER_ID_KEY, {
          requireAuthentication: true,
          authenticationPrompt: 'Sign in with Face ID',
        });

        if (!userId) return { ok: false, message: 'Face ID is not enabled' };
        return loginByUserId(String(userId));
      } catch (error) {
        // Covers user cancel, missing biometry, etc.
        return { ok: false, message: 'Face ID sign in failed' };
      }
    };

  const logout = () => {
    setCurrentUser(null);
    removeItem(LAST_ACTIVITY_KEY);

    if (isFirebaseAuthEnabled()) {
      signOut(firebaseAuth).catch(() => {});
    }
  };

  const ensureFirebaseSignupAuth = async ({ email: rawEmail, password: rawPassword, username: rawUsername } = {}) => {
    const em = validateEmail(rawEmail);
    if (!em.ok) return { ok: false, message: em.message };

    const un = validateUsername(rawUsername || 'user');
    if (!un.ok) return { ok: false, message: un.message };

    const pw = validatePasswordStrength(rawPassword, { username: un.value, email: em.value });
    if (!pw.ok) return { ok: false, message: pw.message };

    if (!isFirebaseAuthEnabled()) {
      return { ok: false, message: 'Authentication is unavailable' };
    }

    const signedInEmail = firebaseAuth?.currentUser?.email ? normalizeEmail(String(firebaseAuth.currentUser.email)) : null;
    if (signedInEmail && signedInEmail === em.value) {
      return { ok: true };
    }

    if (signedInEmail && signedInEmail !== em.value) {
      await signOut(firebaseAuth).catch(() => {});
    }

    try {
      await createUserWithEmailAndPassword(firebaseAuth, em.value, String(rawPassword));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: mapFirebaseAuthError(error) };
    }
  };

  const register = async ({ firstName, lastName, email, username, password, subscriptionTier, initialVaultId }) => {
    const first = validateName(firstName, 'First name');
    if (!first.ok) return { ok: false, message: first.message };
    const last = validateName(lastName, 'Last name');
    if (!last.ok) return { ok: false, message: last.message };
    const em = validateEmail(email);
    if (!em.ok) return { ok: false, message: em.message };
    const un = validateUsername(username);
    if (!un.ok) return { ok: false, message: un.message };

    const exists = users.find(u =>
      (u?.username && normalizeUsername(u.username) === un.value) ||
      (u?.email && normalizeEmail(u.email) === em.value)
    );
    if (exists) return { ok: false, message: 'User already exists' };

    const pw = validatePasswordStrength(password, { username: un.value, email: em.value });
    if (!pw.ok) return { ok: false, message: pw.message };

    // Delegates may need to create an account without purchasing a membership.

    if (!isFirebaseAuthEnabled()) {
      return { ok: false, message: 'Authentication is unavailable' };
    }

    const signedInEmail = firebaseAuth?.currentUser?.email ? normalizeEmail(String(firebaseAuth.currentUser.email)) : null;
    if (signedInEmail && signedInEmail !== em.value) {
      return { ok: false, message: 'You are signed in as a different user. Please sign out and try again.' };
    }

    if (!firebaseAuth?.currentUser?.uid) {
      try {
        await createUserWithEmailAndPassword(firebaseAuth, em.value, String(password));
      } catch (error) {
        return { ok: false, message: mapFirebaseAuthError(error) };
      }
    }

    const now = Date.now();
    const uid = firebaseAuth?.currentUser?.uid ? String(firebaseAuth.currentUser.uid) : null;
    if (!uid) return { ok: false, message: 'Authentication failed' };

    const tier = subscriptionTier ? String(subscriptionTier).toUpperCase() : null;
    const trialEndsAt = tier ? (now + (TRIAL_DAYS * 24 * 60 * 60 * 1000)) : null;

    const newUser = {
      id: uid,
      firstName: first.value,
      lastName: last.value,
      email: em.value,
      username: un.value,
      prefersDarkMode: DEFAULT_DARK_MODE_ENABLED,
      profileImage: null,
      firebaseUid: uid,
      subscription: tier
        ? {
            tier,
            startDate: now,
            trialEndsAt,
            renewalDate: trialEndsAt,
            cancelAtPeriodEnd: false,
          }
        : null,
    };

    // Firestore is canonical: write user + initial vault/collection/asset to Firestore.
    if (!firestore) return { ok: false, message: 'Firestore is not configured' };

    const shouldCreateExampleContent = !!tier;
    const vaultId = shouldCreateExampleContent
      ? (initialVaultId ? String(initialVaultId) : `v${Date.now()}`)
      : null;
    const collectionId = shouldCreateExampleContent ? `c${Date.now() + 1}` : null;
    const assetId = shouldCreateExampleContent ? `a${Date.now() + 2}` : null;

    const batch = writeBatch(firestore);
    batch.set(doc(firestore, 'users', uid), {
      user_id: uid,
      email: newUser.email,
      username: newUser.username,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      prefersDarkMode: newUser.prefersDarkMode,
      createdAt: now,
    }, { merge: true });

    if (shouldCreateExampleContent) {
      batch.set(doc(firestore, 'vaults', vaultId), {
        id: vaultId,
        name: 'Example Vault',
        activeOwnerId: uid,
        ownerId: uid,
        createdBy: uid,
        createdAt: now,
        editedAt: now,
        viewedAt: now,
      }, { merge: true });
      batch.set(doc(firestore, 'vaults', vaultId, 'memberships', uid), {
        user_id: uid,
        vault_id: vaultId,
        role: 'OWNER',
        permissions: null,
        status: 'ACTIVE',
        assigned_at: now,
        revoked_at: null,
      }, { merge: true });

      batch.set(doc(firestore, 'vaults', vaultId, 'collections', collectionId), {
        id: collectionId,
        vaultId,
        name: 'Example Collection',
        createdAt: now,
        editedAt: now,
        viewedAt: now,
      }, { merge: true });

      batch.set(doc(firestore, 'vaults', vaultId, 'assets', assetId), {
        id: assetId,
        vaultId,
        collectionId,
        title: 'Example Asset',
        type: 'Asset',
        category: 'Example',
        manager: newUser.username,
        quantity: 1,
        createdAt: now,
        editedAt: now,
        viewedAt: now,
      }, { merge: true });
    }

    await batch.commit();

    // Local cache (will reconcile from listeners).
    setUsers(prev => [...prev, newUser]);
    setCurrentUser(withoutPasswordSecrets(newUser));
    return { ok: true, vaultId: vaultId || null };
  };

    const updateCurrentUser = (patch) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };

      const prevUsername = currentUser?.username ? String(currentUser.username) : '';

      const nextPatch = { ...patch };

      if (Object.prototype.hasOwnProperty.call(nextPatch, 'firstName')) {
        const first = validateName(nextPatch.firstName, 'First name');
        if (!first.ok) return { ok: false, message: first.message };
        nextPatch.firstName = first.value;
      }

      if (Object.prototype.hasOwnProperty.call(nextPatch, 'lastName')) {
        const last = validateName(nextPatch.lastName, 'Last name');
        if (!last.ok) return { ok: false, message: last.message };
        nextPatch.lastName = last.value;
      }

      if (Object.prototype.hasOwnProperty.call(nextPatch, 'email')) {
        const em = validateEmail(nextPatch.email);
        if (!em.ok) return { ok: false, message: em.message };
        nextPatch.email = em.value;
      }

      if (Object.prototype.hasOwnProperty.call(nextPatch, 'username')) {
        const un = validateUsername(nextPatch.username);
        if (!un.ok) return { ok: false, message: un.message };
        nextPatch.username = un.value;
      }

      const requestedUsername = Object.prototype.hasOwnProperty.call(nextPatch, 'username') ? nextPatch.username : null;
      const nextEmail = Object.prototype.hasOwnProperty.call(nextPatch, 'email') ? nextPatch.email : null;

      if (requestedUsername && users.some(u => u.id !== currentUser.id && u?.username && normalizeUsername(u.username) === normalizeUsername(requestedUsername))) {
        return { ok: false, message: 'Username already taken' };
      }
      if (nextEmail && users.some(u => u.id !== currentUser.id && u?.email && normalizeEmail(u.email) === normalizeEmail(nextEmail))) {
        return { ok: false, message: 'Email already taken' };
      }

      const merged = withProfileImage({ ...currentUser, ...nextPatch });
      setCurrentUser(merged);
      setUsers(prev => prev.map(u => u.id === currentUser.id ? merged : u));

      // Best-effort notification email.
      const mergedUsername = merged?.username ? String(merged.username) : '';
      if (API_URL && mergedUsername && normalizeUsername(prevUsername) !== normalizeUsername(mergedUsername)) {
        apiFetch(`${API_URL}/notifications/username-changed`, {
          method: 'POST',
          body: JSON.stringify({
            eventId: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            oldUsername: prevUsername,
            newUsername: mergedUsername,
          }),
        }).catch(() => {});
      }
      return { ok: true };
    };

      const resetPassword = async ({ currentPassword, newPassword }) => {
        if (!currentUser) return { ok: false, message: 'Not signed in' };

        if (!currentPassword || !String(currentPassword).trim()) {
          return { ok: false, message: 'Please enter your current password' };
        }

        if (!newPassword || !String(newPassword).trim()) {
          return { ok: false, message: 'Please enter a new password' };
        }

        if (!isFirebaseAuthEnabled() || !firebaseAuth?.currentUser?.email) {
          return { ok: false, message: 'Authentication is unavailable' };
        }

        const pw = validatePasswordStrength(newPassword, { username: currentUser?.username, email: currentUser?.email });
        if (!pw.ok) return { ok: false, message: pw.message };

        try {
          const credential = EmailAuthProvider.credential(String(firebaseAuth.currentUser.email), String(currentPassword));
          await reauthenticateWithCredential(firebaseAuth.currentUser, credential);
          await firebaseUpdatePassword(firebaseAuth.currentUser, String(newPassword));

          // Best-effort notification email.
          if (API_URL) {
            apiFetch(`${API_URL}/notifications/password-changed`, {
              method: 'POST',
              body: JSON.stringify({ eventId: `${Date.now()}_${Math.random().toString(36).slice(2)}` }),
            }).catch(() => {});
          }
          return { ok: true };
        } catch (error) {
          return { ok: false, message: mapFirebaseAuthError(error) };
        }
      };

      const validatePassword = (password) => {
        if (!currentUser) return { ok: false, message: 'Not signed in' };
        return validatePasswordStrength(password, { username: currentUser?.username, email: currentUser?.email });
      };

      const deleteAccount = () => {
        if (!currentUser) return { ok: false, message: 'Not signed in' };
        const userId = currentUser.id;

        if (biometricUserId && biometricUserId === userId) {
          setBiometricUserId(null);
          SecureStore.deleteItemAsync(BIOMETRIC_SECURE_USER_ID_KEY).catch(() => {});
          SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_USER_ID_KEY).catch(() => {});
        }

        setUsers(prev => prev.filter(u => u.id !== userId));
        setVaults(prev => prev.filter(v => v.ownerId !== userId));
        setCollections(prev => prev.filter(c => c.ownerId !== userId));
        setAssets(prev => prev.filter(a => a.ownerId !== userId));
        setVaultMemberships((prev) => (prev || []).filter((m) => m?.user_id !== String(userId)));
        setPermissionGrants((prev) => (prev || []).filter((g) => g?.user_id !== String(userId)));
        setCurrentUser(null);
        return { ok: true };
      };

    const addVault = async ({ name, images = [], heroImage }) => {
      const uid = String(currentUser.id);
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const vaultId = `v${Date.now()}`;
      const vaultName = clampItemTitle((name || 'Untitled').trim());

      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'vaults', vaultId), {
        id: vaultId,
        name: vaultName,
        activeOwnerId: uid,
        ownerId: uid,
        createdBy: uid,
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || null,
      }, { merge: true });
      batch.set(doc(firestore, 'vaults', vaultId, 'memberships', uid), {
        user_id: uid,
        vault_id: vaultId,
        role: 'OWNER',
        permissions: null,
        status: 'ACTIVE',
        assigned_at: createdAt,
        revoked_at: null,
      }, { merge: true });

      await batch.commit();
      return { ok: true, vaultId };
    };

    const canCreateCollectionsInVault = (vaultId, userId) => {
      return canDo({ vaultId, userId, permission: PERM.CREATE });
    };

    const addCollection = async ({ vaultId, name, images = [], heroImage }) => {
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const vId = String(vaultId);
      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vId)}/collections`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clampItemTitle((name || 'Untitled').trim()),
          images: normalizedImages,
          heroImage: heroImage || normalizedImages[0] || null,
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, message: json?.error || 'Unable to create collection' };
      return { ok: true, collectionId: json?.collectionId || null };
    };

    const canCreateAssetsInCollection = (collectionId, userId) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return false;
      return canDo({ vaultId: collection.vaultId, collectionId, userId, permission: PERM.CREATE });
    };

    const addAsset = async ({ vaultId, collectionId, title, type, category, images = [], heroImage }) => {
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const vId = String(vaultId);
      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vId)}/assets`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: vId,
          collectionId: String(collectionId),
          title: clampItemTitle((title || 'Untitled').trim()),
          type: type || '',
          category: category || '',
          images: normalizedImages,
          heroImage: heroImage || normalizedImages[0] || null,
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, message: json?.error || 'Unable to create asset' };
      return { ok: true, assetId: json?.assetId || null };
    };

    const shareVault = async ({ vaultId, userId, role = 'reviewer', canCreateCollections = false }) => {
      const uid = String(userId);
      const vId = String(vaultId);
      const perms = legacyRoleToPerms({ role, canCreate: !!canCreateCollections });
      await setDoc(doc(firestore, 'vaults', vId, 'memberships', uid), {
        user_id: uid,
        vault_id: vId,
        role: 'DELEGATE',
        permissions: perms,
        status: 'ACTIVE',
        assigned_at: Date.now(),
        revoked_at: null,
      }, { merge: true });
      return { ok: true };
    };

    const shareCollection = async ({ collectionId, userId, role = 'reviewer', canCreateAssets = false }) => {
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return { ok: false, message: 'Collection not found' };
      const vId = String(col.vaultId);
      const uId = String(userId);
      const perms = legacyRoleToPerms({ role, canCreate: !!canCreateAssets });

      const membershipRef = doc(firestore, 'vaults', vId, 'memberships', uId);
      const existing = await getDoc(membershipRef);
      if (!existing.exists()) {
        await setDoc(membershipRef, {
          user_id: uId,
          vault_id: vId,
          role: 'DELEGATE',
          permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }),
          status: 'ACTIVE',
          assigned_at: Date.now(),
          revoked_at: null,
        }, { merge: true });
      }

      const grantId = `${SCOPE_TYPE.COLLECTION}:${String(collectionId)}:${uId}`;
      await setDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId), {
        id: grantId,
        user_id: uId,
        vault_id: vId,
        scope_type: SCOPE_TYPE.COLLECTION,
        scope_id: String(collectionId),
        permissions: perms,
        assigned_at: Date.now(),
      }, { merge: true });
      return { ok: true };
    };

    const shareAsset = async ({ assetId, userId, role = 'reviewer' }) => {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return { ok: false, message: 'Asset not found' };
      const vId = String(asset.vaultId);
      const uId = String(userId);
      const perms = legacyRoleToPerms({ role, canCreate: false });

      const membershipRef = doc(firestore, 'vaults', vId, 'memberships', uId);
      const existing = await getDoc(membershipRef);
      if (!existing.exists()) {
        await setDoc(membershipRef, {
          user_id: uId,
          vault_id: vId,
          role: 'DELEGATE',
          permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }),
          status: 'ACTIVE',
          assigned_at: Date.now(),
          revoked_at: null,
        }, { merge: true });
      }

      const grantId = `${SCOPE_TYPE.ASSET}:${String(assetId)}:${uId}`;
      await setDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId), {
        id: grantId,
        user_id: uId,
        vault_id: vId,
        scope_type: SCOPE_TYPE.ASSET,
        scope_id: String(assetId),
        permissions: perms,
        assigned_at: Date.now(),
      }, { merge: true });
      return { ok: true };
    };

    const updateVaultShare = async ({ vaultId, userId, role, canCreateCollections }) => {
      const vId = String(vaultId);
      const uId = String(userId);
      const perms = legacyRoleToPerms({ role: role || 'reviewer', canCreate: !!canCreateCollections });
      await updateDoc(doc(firestore, 'vaults', vId, 'memberships', uId), { permissions: perms });
      return { ok: true };
    };

    const updateCollectionShare = async ({ collectionId, userId, role, canCreateAssets }) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return { ok: false, message: 'Collection not found' };
      const vId = String(collection.vaultId);
      const uId = String(userId);
      const perms = legacyRoleToPerms({ role: role || 'reviewer', canCreate: !!canCreateAssets });
      const grantId = `${SCOPE_TYPE.COLLECTION}:${String(collectionId)}:${uId}`;
      await setDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId), { permissions: perms }, { merge: true });
      return { ok: true };
    };

    const updateAssetShare = async ({ assetId, userId, role }) => {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return { ok: false, message: 'Asset not found' };
      const vId = String(asset.vaultId);
      const uId = String(userId);
      const perms = legacyRoleToPerms({ role: role || 'reviewer', canCreate: false });
      const grantId = `${SCOPE_TYPE.ASSET}:${String(assetId)}:${uId}`;
      await setDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId), { permissions: perms }, { merge: true });
      return { ok: true };
    };

    const removeVaultShare = async ({ vaultId, userId }) => {
      const vId = String(vaultId);
      const uId = String(userId);
      await updateDoc(doc(firestore, 'vaults', vId, 'memberships', uId), {
        status: 'REVOKED',
        revoked_at: Date.now(),
      });
      return { ok: true };
    };

    const removeCollectionShare = async ({ collectionId, userId }) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return { ok: false, message: 'Collection not found' };
      const vId = String(collection.vaultId);
      const grantId = `${SCOPE_TYPE.COLLECTION}:${String(collectionId)}:${String(userId)}`;
      await deleteDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId));
      return { ok: true };
    };

    const removeAssetShare = async ({ assetId, userId }) => {
      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return { ok: false, message: 'Asset not found' };
      const vId = String(asset.vaultId);
      const grantId = `${SCOPE_TYPE.ASSET}:${String(assetId)}:${String(userId)}`;
      await deleteDoc(doc(firestore, 'vaults', vId, 'permissionGrants', grantId));
      return { ok: true };
    };

    const transferVaultOwnership = async ({ vaultId, toUserId }) => {
      if (!vaultId || !toUserId) return { ok: false, message: 'Missing vault or user' };
      const vault = vaults.find((v) => v.id === vaultId);
      if (!vault) return { ok: false, message: 'Vault not found' };
      if (String(toUserId) === String(currentUser.id)) return { ok: false, message: 'You already own this vault' };

      const vId = String(vaultId);
      const fromUid = String(currentUser.id);
      const toUid = String(toUserId);
      const now = Date.now();
      const batch = writeBatch(firestore);

      // Update vault owner.
      batch.update(doc(firestore, 'vaults', vId), { activeOwnerId: toUid, ownerId: toUid, editedAt: now });

      // New owner membership.
      batch.set(doc(firestore, 'vaults', vId, 'memberships', toUid), {
        user_id: toUid,
        vault_id: vId,
        role: 'OWNER',
        permissions: null,
        status: 'ACTIVE',
        assigned_at: now,
        revoked_at: null,
      }, { merge: true });

      // Demote previous owner to DELEGATE.
      batch.set(doc(firestore, 'vaults', vId, 'memberships', fromUid), {
        user_id: fromUid,
        vault_id: vId,
        role: 'DELEGATE',
        permissions: mergePerms(emptyPerms(), { [PERM.VIEW]: true }),
        status: 'ACTIVE',
      }, { merge: true });

      await batch.commit();
      return { ok: true };
    };

  const updateVault = async (vaultId, patch) => {
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'name')) {
      nextPatch.name = clampItemTitle(String(nextPatch.name || '').trim());
    }
    await updateDoc(doc(firestore, 'vaults', String(vaultId)), { ...nextPatch, editedAt });
    return { ok: true };
  };

  const updateCollection = async (collectionId, patch) => {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return { ok: false, message: 'Collection not found' };
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'name')) {
      nextPatch.name = clampItemTitle(String(nextPatch.name || '').trim());
    }
    await updateDoc(doc(firestore, 'vaults', String(collection.vaultId), 'collections', String(collectionId)), { ...nextPatch, editedAt });
    return { ok: true };
  };

  const updateAsset = async (assetId, patch) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return { ok: false, message: 'Asset not found' };
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'title')) {
      nextPatch.title = clampItemTitle(String(nextPatch.title || '').trim());
    }
    await updateDoc(doc(firestore, 'vaults', String(asset.vaultId), 'assets', String(assetId)), { ...nextPatch, editedAt });
    return { ok: true };
  };

  const moveCollection = async ({ collectionId, targetVaultId }) => {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return { ok: false, message: 'Collection not found' };
    const fromVaultId = String(collection.vaultId);
    const toVaultId = String(targetVaultId);
    if (!toVaultId) return { ok: false, message: 'Missing target vault' };
    if (toVaultId === fromVaultId) return { ok: true, skipped: true };

    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(fromVaultId)}/collections/${encodeURIComponent(String(collectionId))}/move`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetVaultId: toVaultId }),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, message: json?.error || 'Unable to move collection' };
    return { ok: true, collectionId: json?.collectionId || null };
  };

  const moveAsset = async ({ assetId, targetVaultId, targetCollectionId }) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return { ok: false, message: 'Asset not found' };
    const fromVaultId = String(asset.vaultId);
    const toVaultId = String(targetVaultId);
    const toCollectionId = String(targetCollectionId);
    if (!toVaultId || !toCollectionId) return { ok: false, message: 'Missing target vault or collection' };

    if (toVaultId === fromVaultId) {
      await updateDoc(doc(firestore, 'vaults', fromVaultId, 'assets', String(assetId)), {
        collectionId: toCollectionId,
        editedAt: Date.now(),
      });
      return { ok: true };
    }

    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(fromVaultId)}/assets/${encodeURIComponent(String(assetId))}/move`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetVaultId: toVaultId, targetCollectionId: toCollectionId }),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, message: json?.error || 'Unable to move asset' };
    return { ok: true, assetId: json?.assetId || null };
  };

  const deleteVault = async (vaultId) => {
    const vId = String(vaultId);
    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vId)}/delete`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, message: json?.error || 'Unable to delete vault' };
    return { ok: true };
  };

  const deleteCollection = async (collectionId) => {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return { ok: false, message: 'Collection not found' };
    const vId = String(collection.vaultId);
    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vId)}/collections/${encodeURIComponent(String(collectionId))}/delete`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, message: json?.error || 'Unable to delete collection' };
    return { ok: true, deletedAssets: json?.deletedAssets || 0 };
  };

  const deleteAsset = async (assetId) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return { ok: false, message: 'Asset not found' };
    const vId = String(asset.vaultId);
    const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vId)}/assets/${encodeURIComponent(String(assetId))}/delete`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, message: json?.error || 'Unable to delete asset' };
    return { ok: true };
  };

  // Legacy helper: some screens still ask for a "role" string.
  // We now derive this from VaultMembership.
  const getRoleForVault = (vaultId, userId) => {
    const m = getMembership(vaultId, userId);
    if (!m) return null;
    if (m.role === VAULT_ROLE.OWNER) return 'owner';
    const perms = getVaultPerms(vaultId, userId) || {};
    if (perms[PERM.MOVE] || perms[PERM.CLONE]) return 'manager';
    if (perms[PERM.EDIT] || perms[PERM.CREATE]) return 'editor';
    return 'reviewer';
  };

  const getRoleForCollection = (collectionId, userId) => {
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return null;
    const m = getMembership(collection.vaultId, userId);
    if (!m) return null;
    if (m.role === VAULT_ROLE.OWNER) return 'owner';
    const perms =
      getGrantPerms({ vaultId: collection.vaultId, scopeType: SCOPE_TYPE.COLLECTION, scopeId: collectionId, userId }) ||
      getVaultPerms(collection.vaultId, userId) ||
      {};
    if (perms[PERM.MOVE] || perms[PERM.CLONE]) return 'manager';
    if (perms[PERM.EDIT] || perms[PERM.CREATE]) return 'editor';
    return 'reviewer';
  };

  const getRoleForAsset = (assetId, userId) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const m = getMembership(asset.vaultId, userId);
    if (!m) return null;
    if (m.role === VAULT_ROLE.OWNER) return 'owner';
    const perms =
      getGrantPerms({ vaultId: asset.vaultId, scopeType: SCOPE_TYPE.ASSET, scopeId: assetId, userId }) ||
      (asset.collectionId
        ? getGrantPerms({ vaultId: asset.vaultId, scopeType: SCOPE_TYPE.COLLECTION, scopeId: asset.collectionId, userId })
        : null) ||
      getVaultPerms(asset.vaultId, userId) ||
      {};
    if (perms[PERM.MOVE] || perms[PERM.CLONE]) return 'manager';
    if (perms[PERM.EDIT] || perms[PERM.CREATE]) return 'editor';
    return 'reviewer';
  };

  const updateSubscription = (subscriptionTier) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    if (!subscriptionTier) return { ok: false, message: 'Invalid membership tier' };
    
    const tierUpper = subscriptionTier.toUpperCase();
    if (!SUBSCRIPTION_TIERS[tierUpper]) {
      return { ok: false, message: 'Invalid membership tier' };
    }
    
    const updated = {
      ...currentUser,
      subscription: {
        ...currentUser.subscription,
        tier: tierUpper,
        cancelAtPeriodEnd: false
      }
    };
    
    setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
    return { ok: true };
  };

  // Set membership cancellation flag
  const setCancelAtPeriodEnd = (cancelAtPeriodEnd) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    
    const updated = {
      ...currentUser,
      subscription: {
        ...currentUser.subscription,
        cancelAtPeriodEnd: cancelAtPeriodEnd
      }
    };
    
    setCurrentUser(updated);
    setUsers(prev => prev.map(u => u.id === currentUser.id ? updated : u));
    return { ok: true };
  };

  // Calculate proration for membership changes
  const calculateProration = (fromTier, toTier) => {
    const now = Date.now();
    const renewalDate = new Date(currentUser?.subscription?.renewalDate || now);
    const daysRemaining = Math.max(1, Math.ceil((renewalDate - now) / (1000 * 60 * 60 * 24)));
    const totalDaysInMonth = 30; // Approximate
    
    const currentPlan = SUBSCRIPTION_TIERS[fromTier.toUpperCase()];
    const newPlan = SUBSCRIPTION_TIERS[toTier.toUpperCase()];
    
    // Calculate daily rates
    const currentDailyRate = currentPlan.price / totalDaysInMonth;
    const newDailyRate = newPlan.price / totalDaysInMonth;
    
    // Calculate remaining value of current membership
    const remainingValue = currentDailyRate * daysRemaining;
    
    // Calculate cost of new membership for remaining period
    const costForRemaining = newDailyRate * daysRemaining;
    
    // Difference owed (positive = upgrade charge, negative = credit but no refund per user spec)
    const differenceOwed = Math.max(0, costForRemaining - remainingValue);
    
    // Next bill amount (full price of new membership)
    const nextBillAmount = newPlan.price;
    
    // Next bill date (renewal date)
    const nextBillDate = new Date(renewalDate);
    
    return {
      daysRemaining,
      remainingValue: parseFloat(remainingValue.toFixed(2)),
      costForRemaining: parseFloat(costForRemaining.toFixed(2)),
      chargeNow: parseFloat(differenceOwed.toFixed(2)),
      nextBillAmount: nextBillAmount,
      nextBillDate: nextBillDate,
      isUpgrade: newPlan.price > currentPlan.price
    };
  };

  // Get features comparison
  const getFeaturesComparison = (fromTier, toTier) => {
    const from = SUBSCRIPTION_TIERS[fromTier.toUpperCase()];
    const to = SUBSCRIPTION_TIERS[toTier.toUpperCase()];
    
    const isUpgrade = to.price > from.price;
    
    // When upgrading: only gain features (no losses)
    // When downgrading: only lose features (no gains)
    const featuresLost = isUpgrade ? [] : from.features.filter(f => !to.features.includes(f));
    const featuresGained = isUpgrade ? to.features.filter(f => !from.features.includes(f)) : [];
    
    return { featuresLost, featuresGained };
  };

  // LAMB pricing is defined in AUD. (If/when we add localization, App Store price objects
  // should be used instead of hard-coded FX rates.)
  const getCurrencyInfo = () => ({ code: 'AUD', rate: 1.0 });

  const convertPrice = (audPrice) => {
    const amountNum = Number(audPrice);
    const safe = Number.isFinite(amountNum) ? amountNum : 0;
    return { amount: safe.toFixed(2), currency: 'AUD', symbol: 'A$' };
  };

  const retainVaultAssets = useCallback((vaultId) => {
    const vId = String(vaultId || '');
    if (!vId) return;
    const map = dynamicVaultAssetRefCountsRef.current;
    const next = (Number(map.get(vId)) || 0) + 1;
    map.set(vId, next);
    reconcileVaultAssetListenersRef.current?.({ baseVaultIds: ownerVaultIdsRef.current || [] });
  }, []);

  const releaseVaultAssets = useCallback((vaultId) => {
    const vId = String(vaultId || '');
    if (!vId) return;
    const map = dynamicVaultAssetRefCountsRef.current;
    const prev = Number(map.get(vId)) || 0;
    const next = prev - 1;
    if (next > 0) map.set(vId, next);
    else map.delete(vId);
    reconcileVaultAssetListenersRef.current?.({ baseVaultIds: ownerVaultIdsRef.current || [] });
  }, []);

  const retainVaultCollections = useCallback((vaultId) => {
    const vId = String(vaultId || '');
    if (!vId) return;
    const map = dynamicVaultCollectionRefCountsRef.current;
    const next = (Number(map.get(vId)) || 0) + 1;
    map.set(vId, next);
    reconcileVaultCollectionListenersRef.current?.({ baseVaultIds: ownerVaultIdsRef.current || [] });
  }, []);

  const releaseVaultCollections = useCallback((vaultId) => {
    const vId = String(vaultId || '');
    if (!vId) return;
    const map = dynamicVaultCollectionRefCountsRef.current;
    const prev = Number(map.get(vId)) || 0;
    const next = prev - 1;
    if (next > 0) map.set(vId, next);
    else map.delete(vId);
    reconcileVaultCollectionListenersRef.current?.({ baseVaultIds: ownerVaultIdsRef.current || [] });
  }, []);

  const value = useMemo(() => ({
    loading,
    backendReachable,
    checkBackend,
    users,
    currentUser,
    setCurrentUser,
    membershipActive,
    membershipAccess,
    isDarkMode: (currentUser?.prefersDarkMode ?? DEFAULT_DARK_MODE_ENABLED) !== false,
    theme: getTheme(currentUser?.prefersDarkMode ?? DEFAULT_DARK_MODE_ENABLED),
    defaultHeroImage: DEFAULT_HERO_IMAGE,
    setDarkModeEnabled,
    biometricUserId,
    biometricEnabledForCurrentUser: !!(currentUser?.id && biometricUserId === currentUser.id),
    enableBiometricSignInForCurrentUser,
    disableBiometricSignIn,
    biometricLogin,
    refreshData,
    acceptInvitationCode: wrapOnlineAsync(acceptInvitationCode),
    recordActivity,
    enforceSessionTimeout,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    vaults,
    collections,
    assets,
    vaultMemberships,
    permissionGrants,
    auditEvents,
    setVaults,
    setCollections,
    setAssets,
    // Read-only / session ops
    login: wrapOnlineAsync(login),
    logout,
    // Auth / profile
    ensureFirebaseSignupAuth: wrapOnlineAsync(ensureFirebaseSignupAuth),
    register: wrapOnlineAsync(register),
    updateCurrentUser: wrapOnline(updateCurrentUser),
    resetPassword: wrapOnlineAsync(resetPassword),
    deleteAccount: wrapOnlineAsync(deleteAccount),

    // Subscription
    // Subscription management must remain available even when access is locked.
    updateSubscription: wrapOnline(updateSubscription),
    setCancelAtPeriodEnd: wrapOnline(setCancelAtPeriodEnd),
    validatePassword,

    // Mutations (online-only)
    addVault: wrapFirestoreAsync(addVault),
    addCollection: wrapFirestoreAsync(addCollection),
    addAsset: wrapFirestoreAsync(addAsset),
    updateVault: wrapFirestoreAsync(updateVault),
    updateCollection: wrapFirestoreAsync(updateCollection),
    updateAsset: wrapFirestoreAsync(updateAsset),
    moveCollection: wrapFirestoreAsync(moveCollection),
    moveAsset: wrapFirestoreAsync(moveAsset),
    deleteVault: wrapFirestoreAsync(deleteVault),
    deleteCollection: wrapFirestoreAsync(deleteCollection),
    deleteAsset: wrapFirestoreAsync(deleteAsset),

    // Sharing (online-only)
    shareVault: wrapFirestoreAsync(shareVault),
    shareCollection: wrapFirestoreAsync(shareCollection),
    shareAsset: wrapFirestoreAsync(shareAsset),
    updateVaultShare: wrapFirestoreAsync(updateVaultShare),
    updateCollectionShare: wrapFirestoreAsync(updateCollectionShare),
    updateAssetShare: wrapFirestoreAsync(updateAssetShare),
    removeVaultShare: wrapFirestoreAsync(removeVaultShare),
    removeCollectionShare: wrapFirestoreAsync(removeCollectionShare),
    removeAssetShare: wrapFirestoreAsync(removeAssetShare),
    transferVaultOwnership: wrapFirestoreAsync(transferVaultOwnership),
    getRoleForVault,
    getRoleForCollection,
    getRoleForAsset,
    canCreateCollectionsInVault,
    canCreateAssetsInCollection,
    calculateProration,
    getFeaturesComparison,
    convertPrice,
    getCurrencyInfo,
    retainVaultAssets,
    releaseVaultAssets,
    retainVaultCollections,
    releaseVaultCollections,
  }), [
    loading,
    backendReachable,
    membershipActive,
    membershipAccess,
    users,
    currentUser,
    biometricUserId,
    vaults,
    collections,
    assets,
    vaultMemberships,
    permissionGrants,
    auditEvents,
    offlineResult,
    membershipRequiredResult,
    retainVaultAssets,
    releaseVaultAssets,
    retainVaultCollections,
    releaseVaultCollections,
  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
