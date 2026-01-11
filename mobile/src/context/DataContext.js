import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getItem, setItem, removeItem } from '../storage';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_DARK_MODE_ENABLED, getTheme } from '../theme';
import { getAssetCapabilities, getCollectionCapabilities, getVaultCapabilities } from '../policies/capabilities';
import { firebaseAuth, isFirebaseConfigured } from '../firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as firebaseUpdatePassword,
} from 'firebase/auth';
import { API_URL } from '../config/stripe';
import NetInfo from '@react-native-community/netinfo';
import { apiFetch } from '../utils/apiFetch';

const DATA_KEY = 'lamb-mobile-data-v5';
const LAST_ACTIVITY_KEY = 'lamb-mobile-last-activity-v1';
const BIOMETRIC_SECURE_USER_ID_KEY = 'lamb-mobile-biometric-userid-secure-v1';
const BIOMETRIC_ENABLED_USER_ID_KEY = 'lamb-mobile-biometric-userid-enabled-v1';
const STORAGE_VERSION = 5;
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
    price: 2.49, 
    period: 'month', 
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
    price: 4.99, 
    period: 'month', 
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
    price: 9.99, 
    period: 'month', 
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

const hasMembershipStillActive = (user) => {
  const tier = user?.subscription?.tier;
  if (!tier) return false;
  const renewalDate = user?.subscription?.renewalDate;
  if (typeof renewalDate === 'number') {
    if (Date.now() >= renewalDate) return false;
  }
  return true;
};

// Product rule: if the user cancels, lock access immediately.
const hasMembershipAccess = (user) => {
  if (!hasMembershipStillActive(user)) return false;
  if (user?.subscription?.cancelAtPeriodEnd === true) return false;
  return true;
};

const hasActiveMembership = (user) => {
  // Back-compat: treat "active" as "still active until period end".
  return hasMembershipStillActive(user);
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
  migrated.users = (data.users || []).map(u => withProfileImage(u));
  migrated.currentUser = withoutPasswordSecrets(withProfileImage(data.currentUser));
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
  const [lastActivityAt, setLastActivityAt] = useState(Date.now());
  const lastActivityWriteAtRef = useRef(0);
  const lastSubscriptionSyncAtRef = useRef(0);

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
  const membershipAccess = hasMembershipAccess(currentUser);

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

  const applySubscriptionSync = (subscription) => {
    if (!currentUser || !subscription) return;

    const nextSub = {
      ...(currentUser.subscription || {}),
      tier: subscription.tier || currentUser.subscription?.tier,
      stripeSubscriptionId: subscription.id || currentUser.subscription?.stripeSubscriptionId,
      stripeCustomerId: subscription.customer || currentUser.subscription?.stripeCustomerId,
      cancelAtPeriodEnd: !!subscription.cancelAtPeriodEnd,
      startDate:
        typeof subscription.currentPeriodStartMs === 'number'
          ? subscription.currentPeriodStartMs
          : currentUser.subscription?.startDate,
      renewalDate:
        typeof subscription.currentPeriodEndMs === 'number'
          ? subscription.currentPeriodEndMs
          : currentUser.subscription?.renewalDate,
    };

    const prevSub = currentUser.subscription || {};
    const changed =
      prevSub.tier !== nextSub.tier ||
      prevSub.stripeSubscriptionId !== nextSub.stripeSubscriptionId ||
      prevSub.stripeCustomerId !== nextSub.stripeCustomerId ||
      prevSub.cancelAtPeriodEnd !== nextSub.cancelAtPeriodEnd ||
      prevSub.startDate !== nextSub.startDate ||
      prevSub.renewalDate !== nextSub.renewalDate;

    if (!changed) return;

    const updatedUser = { ...currentUser, subscription: nextSub };
    setCurrentUser(updatedUser);
    setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? updatedUser : u)));
  };

  const syncSubscriptionFromServer = async ({ force = false } = {}) => {
    if (!currentUser?.subscription) return { ok: true, skipped: true };
    if (backendReachable === false) return { ok: false, message: 'Offline' };

    const subscriptionId = currentUser.subscription?.stripeSubscriptionId || null;
    const customerId = currentUser.subscription?.stripeCustomerId || null;
    if (!subscriptionId && !customerId) return { ok: true, skipped: true };

    // Throttle to avoid spamming the backend.
    const now = Date.now();
    if (!force && now - lastSubscriptionSyncAtRef.current < 15000) return { ok: true, skipped: true };
    lastSubscriptionSyncAtRef.current = now;

    try {
      const resp = await apiFetch(`${API_URL}/subscription-status`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId, customerId }),
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        return { ok: false, message: json?.error || 'Subscription sync failed' };
      }

      if (json?.subscription) {
        applySubscriptionSync(json.subscription);
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || 'Subscription sync failed' };
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
          await setItem(DATA_KEY, { ...migrated, users: hydratedUsers.map(withoutPasswordForStorage), version: STORAGE_VERSION });
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
          await setItem(DATA_KEY, {
            version: STORAGE_VERSION,
            users: hydratedUsers.map(withoutPasswordForStorage),
            currentUser: migratedSeed.currentUser,
            vaults: migratedSeed.vaults,
            collections: migratedSeed.collections,
            assets: migratedSeed.assets,
          });
        }

        // Best-effort: sync subscription state from the server.
        // This keeps cancelAtPeriodEnd/renewalDate aligned with Stripe.
        try {
          await syncSubscriptionFromServer();
        } catch {
          // ignore
        }
        setLoading(false);
      })();
    }, []);

    useEffect(() => {
      if (loading) return;
      if (!currentUser) return;
      // Keep membership state in sync with Stripe when online.
      syncSubscriptionFromServer();
    }, [
      loading,
      currentUser?.id,
      currentUser?.subscription?.stripeSubscriptionId,
      currentUser?.subscription?.stripeCustomerId,
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
      setItem(DATA_KEY, { version: STORAGE_VERSION, users: users.map(withoutPasswordForStorage), currentUser, vaults, collections, assets });
    }, [users, currentUser, vaults, collections, assets, loading]);

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

      if (!found.subscription || !found.subscription.tier) {
        return { ok: false, message: 'No active membership. Please purchase a membership to continue.' };
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

  // Reset all local data - useful for testing
  const resetAllData = async () => {
    try {
      setCurrentUser(null);
      setUsers([]);
      setVaults([]);
      setCollections([]);
      setAssets([]);
      await removeItem(LAST_ACTIVITY_KEY);
      try {
        await SecureStore.deleteItemAsync(BIOMETRIC_SECURE_USER_ID_KEY);
        await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_USER_ID_KEY);
      } catch {
        // ignore
      }
      if (isFirebaseAuthEnabled()) {
        await signOut(firebaseAuth).catch(() => {});
      }
      await removeItem(DATA_KEY);
      console.log('All data cleared successfully');
      return { ok: true, message: 'All data cleared' };
    } catch (error) {
      console.error('Error clearing data:', error);
      return { ok: false, message: error.message };
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

  const register = async ({ firstName, lastName, email, username, password, subscriptionTier, stripeSubscriptionId, stripeCustomerId }) => {
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

    if (!subscriptionTier) return { ok: false, message: 'You must select a membership' };

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
    const trialEndsAt = now + (TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const uid = firebaseAuth?.currentUser?.uid ? String(firebaseAuth.currentUser.uid) : null;
    if (!uid) return { ok: false, message: 'Authentication failed' };

    const newUser = {
      id: uid,
      firstName: first.value,
      lastName: last.value,
      email: em.value,
      username: un.value,
      prefersDarkMode: DEFAULT_DARK_MODE_ENABLED,
      profileImage: null,
      firebaseUid: uid,
      subscription: {
        tier: subscriptionTier,
        startDate: now,
        trialEndsAt,
        renewalDate: trialEndsAt,
        stripeSubscriptionId: stripeSubscriptionId || null,
        stripeCustomerId: stripeCustomerId || null,
        cancelAtPeriodEnd: false,
      },
    };

    const newVault = { id: `v${Date.now()}`, name: 'Example Vault', ownerId: newUser.id, sharedWith: [], createdAt: now, viewedAt: now, editedAt: now, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };
    const newCollection = { id: `c${Date.now() + 1}`, vaultId: newVault.id, name: 'Example Collection', ownerId: newUser.id, sharedWith: [], createdAt: now, viewedAt: now, editedAt: now, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };
    const newAsset = { id: `a${Date.now() + 2}`, vaultId: newVault.id, collectionId: newCollection.id, title: 'Example Asset', type: 'Asset', category: 'Example', ownerId: newUser.id, manager: newUser.username, createdAt: now, viewedAt: now, editedAt: now, quantity: 1, heroImage: DEFAULT_MEDIA_IMAGE, images: [] };

    setUsers(prev => [...prev, newUser]);
    setVaults(prev => [newVault, ...prev]);
    setCollections(prev => [newCollection, ...prev]);
    setAssets(prev => [newAsset, ...prev]);
    setCurrentUser(withoutPasswordSecrets(newUser));
    return { ok: true };
  };

    const updateCurrentUser = (patch) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };

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

      const nextUsername = Object.prototype.hasOwnProperty.call(nextPatch, 'username') ? nextPatch.username : null;
      const nextEmail = Object.prototype.hasOwnProperty.call(nextPatch, 'email') ? nextPatch.email : null;

      if (nextUsername && users.some(u => u.id !== currentUser.id && u?.username && normalizeUsername(u.username) === normalizeUsername(nextUsername))) {
        return { ok: false, message: 'Username already taken' };
      }
      if (nextEmail && users.some(u => u.id !== currentUser.id && u?.email && normalizeEmail(u.email) === normalizeEmail(nextEmail))) {
        return { ok: false, message: 'Email already taken' };
      }

      const merged = withProfileImage({ ...currentUser, ...nextPatch });
      setCurrentUser(merged);
      setUsers(prev => prev.map(u => u.id === currentUser.id ? merged : u));
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
        setVaults(prev => prev
          .filter(v => v.ownerId !== userId)
          .map(v => ({ ...v, sharedWith: (v.sharedWith || []).filter(s => s.userId !== userId) }))
        );
        setCollections(prev => prev
          .filter(c => c.ownerId !== userId)
          .map(c => ({ ...c, sharedWith: (c.sharedWith || []).filter(s => s.userId !== userId) }))
        );
        setAssets(prev => prev.filter(a => a.ownerId !== userId));
        setCurrentUser(null);
        return { ok: true };
      };

    const addVault = ({ name, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const vault = withMedia({
        id: `v${Date.now()}`,
        name: clampItemTitle((name || 'Untitled').trim()),
        ownerId: currentUser.id,
        sharedWith: [],
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || null,
      });
      setVaults(prev => [vault, ...prev]);
      return { ok: true, vault };
    };

    const canCreateCollectionsInVault = (vaultId, userId) => {
      if (!vaultId || !userId) return false;
      const vault = vaults.find(v => v.id === vaultId);
      if (!vault) return false;
      if (vault.ownerId === userId) return true;
      const match = (vault.sharedWith || []).find(s => s.userId === userId);
      if (!match) return false;
      if (normalizeRole(match.role) === 'manager') return true;
      return !!match.canCreateCollections;
    };

    const addCollection = ({ vaultId, name, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      if (!canCreateCollectionsInVault(vaultId, currentUser.id)) return { ok: false, message: 'No permission to add collections' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const collection = withMedia({
        id: `c${Date.now()}`,
        vaultId,
        name: clampItemTitle((name || 'Untitled').trim()),
        ownerId: currentUser.id,
        sharedWith: [],
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || null,
      });
      setCollections(prev => [collection, ...prev]);
      return { ok: true, collection };
    };

    const canCreateAssetsInCollection = (collectionId, userId) => {
      if (!collectionId || !userId) return false;
      const collection = collections.find(c => c.id === collectionId);
      if (!collection) return false;
      if (collection.ownerId === userId) return true;
      const match = (collection.sharedWith || []).find(s => s.userId === userId);
      if (!match) return false;
      if (normalizeRole(match.role) === 'manager') return true;
      return !!match.canCreateAssets;
    };

    const addAsset = ({ vaultId, collectionId, title, type, category, images = [], heroImage }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      if (!canCreateAssetsInCollection(collectionId, currentUser.id)) return { ok: false, message: 'No permission to add assets' };
      const createdAt = Date.now();
      const normalizedImages = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];
      const asset = withMedia({
        id: `a${Date.now()}`,
        vaultId,
        collectionId,
        title: clampItemTitle((title || 'Untitled').trim()),
        type: type || '',
        category: category || '',
        ownerId: currentUser.id,
        manager: currentUser.username,
        createdAt,
        viewedAt: createdAt,
        editedAt: createdAt,
        quantity: 1,
        images: normalizedImages,
        heroImage: heroImage || normalizedImages[0] || null,
      });
      setAssets(prev => [asset, ...prev]);
      return { ok: true, asset };
    };

    const shareVault = ({ vaultId, userId, role = 'reviewer', canCreateCollections = false }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getVaultCapabilities({
        role: getRoleForVault(vaultId, currentUser.id),
        canCreateCollections: canCreateCollectionsInVault(vaultId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share vaults' };
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = v.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return v;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...v, sharedWith: [...sharedWith, { userId, role: normalizedRole, canCreateCollections }] };
      }));
      return { ok: true };
    };

    const shareCollection = ({ collectionId, userId, role = 'reviewer', canCreateAssets = false }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getCollectionCapabilities({
        role: getRoleForCollection(collectionId, currentUser.id),
        canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share collections' };
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = c.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return c;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...c, sharedWith: [...sharedWith, { userId, role: normalizedRole, canCreateAssets }] };
      }));
      return { ok: true };
    };

    const shareAsset = ({ assetId, userId, role = 'reviewer' }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
      if (!caps.canShare) return { ok: false, message: 'No permission to share assets' };
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = a.sharedWith || [];
        if (sharedWith.find(s => s.userId === userId)) return a;
        const normalizedRole = normalizeRole(role) || 'reviewer';
        return { ...a, sharedWith: [...sharedWith, { userId, role: normalizedRole }] };
      }));
      return { ok: true };
    };

    const updateVaultShare = ({ vaultId, userId, role, canCreateCollections }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getVaultCapabilities({
        role: getRoleForVault(vaultId, currentUser.id),
        canCreateCollections: canCreateCollectionsInVault(vaultId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share vaults' };
      setVaults(prev => prev.map(v => {
        if (v.id !== vaultId) return v;
        const sharedWith = (v.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return {
            ...s,
            role: normalizedRole,
            canCreateCollections: typeof canCreateCollections === 'boolean' ? canCreateCollections : s.canCreateCollections,
          };
        });
        return { ...v, sharedWith };
      }));
      return { ok: true };
    };

    const updateCollectionShare = ({ collectionId, userId, role, canCreateAssets }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getCollectionCapabilities({
        role: getRoleForCollection(collectionId, currentUser.id),
        canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share collections' };
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        const sharedWith = (c.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return {
            ...s,
            role: normalizedRole,
            canCreateAssets: typeof canCreateAssets === 'boolean' ? canCreateAssets : s.canCreateAssets,
          };
        });
        return { ...c, sharedWith };
      }));
      return { ok: true };
    };

    const updateAssetShare = ({ assetId, userId, role }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
      if (!caps.canShare) return { ok: false, message: 'No permission to share assets' };
      setAssets(prev => prev.map(a => {
        if (a.id !== assetId) return a;
        const sharedWith = (a.sharedWith || []).map(s => {
          if (s.userId !== userId) return s;
          const normalizedRole = normalizeRole(role || s.role) || 'reviewer';
          return { ...s, role: normalizedRole };
        });
        return { ...a, sharedWith };
      }));
      return { ok: true };
    };

    const removeVaultShare = ({ vaultId, userId }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getVaultCapabilities({
        role: getRoleForVault(vaultId, currentUser.id),
        canCreateCollections: canCreateCollectionsInVault(vaultId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share vaults' };
      setVaults(prev => prev.map(v => v.id === vaultId ? { ...v, sharedWith: (v.sharedWith || []).filter(s => s.userId !== userId) } : v));
      return { ok: true };
    };

    const removeCollectionShare = ({ collectionId, userId }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getCollectionCapabilities({
        role: getRoleForCollection(collectionId, currentUser.id),
        canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
      });
      if (!caps.canShare) return { ok: false, message: 'No permission to share collections' };
      setCollections(prev => prev.map(c => c.id === collectionId ? { ...c, sharedWith: (c.sharedWith || []).filter(s => s.userId !== userId) } : c));
      return { ok: true };
    };

    const removeAssetShare = ({ assetId, userId }) => {
      if (!currentUser) return { ok: false, message: 'Not signed in' };
      const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
      if (!caps.canShare) return { ok: false, message: 'No permission to share assets' };
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, sharedWith: (a.sharedWith || []).filter(s => s.userId !== userId) } : a));
      return { ok: true };
    };

  const updateVault = (vaultId, patch) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getVaultCapabilities({
      role: getRoleForVault(vaultId, currentUser.id),
      canCreateCollections: canCreateCollectionsInVault(vaultId, currentUser.id),
    });
    if (!caps.canEdit) return { ok: false, message: 'No permission to edit vault' };
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'name')) {
      nextPatch.name = clampItemTitle(String(nextPatch.name || '').trim());
    }
    setVaults(prev => prev.map(v => v.id === vaultId ? withMedia({ ...v, ...nextPatch, editedAt }) : v));
    return { ok: true };
  };

  const updateCollection = (collectionId, patch) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getCollectionCapabilities({
      role: getRoleForCollection(collectionId, currentUser.id),
      canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
    });
    if (!caps.canEdit) return { ok: false, message: 'No permission to edit collection' };
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'name')) {
      nextPatch.name = clampItemTitle(String(nextPatch.name || '').trim());
    }
    setCollections(prev => prev.map(c => c.id === collectionId ? withMedia({ ...c, ...nextPatch, editedAt }) : c));
    return { ok: true };
  };

  const updateAsset = (assetId, patch) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
    if (!caps.canEdit) return { ok: false, message: 'No permission to edit asset' };
    const editedAt = Date.now();
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'title')) {
      nextPatch.title = clampItemTitle(String(nextPatch.title || '').trim());
    }
    setAssets(prev => prev.map(a => a.id === assetId ? withMedia({ ...a, ...nextPatch, editedAt }) : a));
    return { ok: true };
  };

  const moveCollection = ({ collectionId, targetVaultId }) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getCollectionCapabilities({
      role: getRoleForCollection(collectionId, currentUser.id),
      canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
    });
    if (!caps.canMove) return { ok: false, message: 'No permission to move collection' };
    setCollections(prev => prev.map(c => c.id === collectionId ? { ...c, vaultId: targetVaultId } : c));
    setAssets(prev => prev.map(a => a.collectionId && a.collectionId === collectionId ? { ...a, vaultId: targetVaultId } : a));
    return { ok: true };
  };

  const moveAsset = ({ assetId, targetVaultId, targetCollectionId }) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
    if (!caps.canMove) return { ok: false, message: 'No permission to move asset' };
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, vaultId: targetVaultId, collectionId: targetCollectionId } : a));
    return { ok: true };
  };

  const deleteVault = (vaultId) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getVaultCapabilities({
      role: getRoleForVault(vaultId, currentUser.id),
      canCreateCollections: canCreateCollectionsInVault(vaultId, currentUser.id),
    });
    if (!caps.canDelete) return { ok: false, message: 'No permission to delete vault' };
    setVaults(prev => prev.filter(v => v.id !== vaultId));
    setCollections(prev => prev.filter(c => c.vaultId !== vaultId));
    setAssets(prev => prev.filter(a => a.vaultId !== vaultId));
    return { ok: true };
  };

  const deleteCollection = (collectionId) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getCollectionCapabilities({
      role: getRoleForCollection(collectionId, currentUser.id),
      canCreateAssets: canCreateAssetsInCollection(collectionId, currentUser.id),
    });
    if (!caps.canDelete) return { ok: false, message: 'No permission to delete collection' };
    setCollections(prev => prev.filter(c => c.id !== collectionId));
    setAssets(prev => prev.filter(a => a.collectionId !== collectionId));
    return { ok: true };
  };

  const deleteAsset = (assetId) => {
    if (!currentUser) return { ok: false, message: 'Not signed in' };
    const caps = getAssetCapabilities({ role: getRoleForAsset(assetId, currentUser.id) });
    if (!caps.canDelete) return { ok: false, message: 'No permission to delete asset' };
    setAssets(prev => prev.filter(a => a.id !== assetId));
    return { ok: true };
  };

  const getRoleForVault = (vaultId, userId) => {
    const vault = vaults.find(v => v.id === vaultId);
    if (!vault) return null;
    if (vault.ownerId === userId) return 'owner';
    const match = (vault.sharedWith || []).find(s => s.userId === userId);
    return normalizeRole(match?.role) || null;
  };

    const getRoleForCollection = (collectionId, userId) => {
      const collection = collections.find(c => c.id === collectionId);
      if (!collection) return null;
      if (collection.ownerId === userId) return 'owner';
      const match = (collection.sharedWith || []).find(s => s.userId === userId);
      return normalizeRole(match?.role) || null;
    };

  const getRoleForAsset = (assetId, userId) => {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return null;
    if (asset.ownerId === userId) return 'owner';
    const match = (asset.sharedWith || []).find(s => s.userId === userId);
    return normalizeRole(match?.role) || null;
  };

  const updateSubscription = (subscriptionTier, stripeSubscriptionId) => {
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
        stripeSubscriptionId: stripeSubscriptionId || currentUser.subscription?.stripeSubscriptionId,
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

  // Get currency and exchange rate based on locale
  const getCurrencyInfo = () => {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const currencyMap = {
      'en-AU': { code: 'AUD', rate: 1.50 },
      'en-GB': { code: 'GBP', rate: 0.79 },
      'en-NZ': { code: 'NZD', rate: 1.65 },
      'en-CA': { code: 'CAD', rate: 1.35 },
      'en-US': { code: 'USD', rate: 1.00 },
    };
    
    // Check for exact match first
    if (currencyMap[locale]) {
      return currencyMap[locale];
    }
    
    // Check for country match (e.g., 'en-AU' or 'en_AU')
    const country = locale.split(/[-_]/)[1]?.toUpperCase();
    const match = Object.keys(currencyMap).find(key => key.includes(country));
    
    return match ? currencyMap[match] : { code: 'USD', rate: 1.00 };
  };

  // Convert price to local currency
  const convertPrice = (usdPrice) => {
    const { code, rate } = getCurrencyInfo();
    return {
      amount: (usdPrice * rate).toFixed(2),
      currency: code,
      symbol: code === 'USD' ? '$' : code === 'AUD' ? 'A$' : code === 'GBP' ? '£' : code === 'CAD' ? 'C$' : code === 'NZD' ? 'NZ$' : '$'
    };
  };

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
    syncSubscriptionFromServer,
    recordActivity,
    enforceSessionTimeout,
    subscriptionTiers: SUBSCRIPTION_TIERS,
    vaults,
    collections,
    assets,
    setVaults,
    setCollections,
    setAssets,
    // Read-only / session ops
    login: wrapOnlineAsync(login),
    logout,
    resetAllData,
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
    addVault: wrapOnlineAndMembership(addVault),
    addCollection: wrapOnlineAndMembership(addCollection),
    addAsset: wrapOnlineAndMembership(addAsset),
    updateVault: wrapOnlineAndMembership(updateVault),
    updateCollection: wrapOnlineAndMembership(updateCollection),
    updateAsset: wrapOnlineAndMembership(updateAsset),
    moveCollection: wrapOnlineAndMembership(moveCollection),
    moveAsset: wrapOnlineAndMembership(moveAsset),
    deleteVault: wrapOnlineAndMembership(deleteVault),
    deleteCollection: wrapOnlineAndMembership(deleteCollection),
    deleteAsset: wrapOnlineAndMembership(deleteAsset),

    // Sharing (online-only)
    shareVault: wrapOnlineAndMembershipAsync(shareVault),
    shareCollection: wrapOnlineAndMembershipAsync(shareCollection),
    shareAsset: wrapOnlineAndMembershipAsync(shareAsset),
    updateVaultShare: wrapOnlineAndMembershipAsync(updateVaultShare),
    updateCollectionShare: wrapOnlineAndMembershipAsync(updateCollectionShare),
    updateAssetShare: wrapOnlineAndMembershipAsync(updateAssetShare),
    // Revoking shares is allowed without membership.
    removeVaultShare: wrapOnlineAsync(removeVaultShare),
    removeCollectionShare: wrapOnlineAsync(removeCollectionShare),
    removeAssetShare: wrapOnlineAsync(removeAssetShare),
    getRoleForVault,
    getRoleForCollection,
    getRoleForAsset,
    canCreateCollectionsInVault,
    canCreateAssetsInCollection,
    calculateProration,
    getFeaturesComparison,
    convertPrice,
    getCurrencyInfo,
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
    offlineResult,
    membershipRequiredResult,
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
