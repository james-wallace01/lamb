import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_CONFIG } from './config/firebase';

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
        return initializeAuth(firebaseApp, {
          persistence: getReactNativePersistence(AsyncStorage),
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
