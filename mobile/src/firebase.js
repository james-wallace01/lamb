import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import * as SecureStore from 'expo-secure-store';
import { FIREBASE_CONFIG } from './config/firebase';

const isValidSecureStoreKey = (key) => /^[A-Za-z0-9._-]+$/.test(key);

// expo-secure-store restricts keys to: non-empty and only alphanumeric, '.', '-', '_'.
// Firebase persistence keys can include other characters, so we deterministically map them.
const fnv1a32Hex = (input) => {
  const str = String(input ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV-1a prime multiplication
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const toSecureStoreKey = (key) => {
  const raw = String(key ?? '');
  if (raw && isValidSecureStoreKey(raw)) return raw;
  // Always non-empty and valid.
  return `fb_${fnv1a32Hex(raw)}`;
};

const looksConfigured = (cfg) => {
  if (!cfg) return false;
  const required = ['apiKey', 'projectId', 'appId'];
  return required.every((k) => typeof cfg[k] === 'string' && cfg[k] && cfg[k] !== 'REPLACE_ME');
};

export const isFirebaseConfigured = () => looksConfigured(FIREBASE_CONFIG);

export const firebaseApp = (() => {
  if (!isFirebaseConfigured()) return null;
  return getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
})();

export const firebaseAuth = firebaseApp
  ? (() => {
      try {
        const secureStoreAdapter = {
          setItem: async (key, value) => {
            await SecureStore.setItemAsync(toSecureStoreKey(key), String(value), {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
          },
          getItem: async (key) => {
            return await SecureStore.getItemAsync(toSecureStoreKey(key));
          },
          removeItem: async (key) => {
            await SecureStore.deleteItemAsync(toSecureStoreKey(key));
          },
        };

        return initializeAuth(firebaseApp, {
          persistence: getReactNativePersistence(secureStoreAdapter),
        });
      } catch {
        // If Auth was already initialized, just reuse it.
        return getAuth(firebaseApp);
      }
    })()
  : null;
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null;

export const getFirebaseIdToken = async () => {
  if (!firebaseAuth) return null;
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
};
