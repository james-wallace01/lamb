import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { createNavigationContainerRef, getStateFromPath as defaultGetStateFromPath, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import * as ExpoLinking from 'expo-linking';
import { DataProvider } from './src/context/DataContext';
import { useData } from './src/context/DataContext';
import { getItem, removeItem, setItem } from './src/storage';
import HomeScreen from './src/screens/Home';
import VaultScreen from './src/screens/Vault';
import CollectionScreen from './src/screens/Collection';
import AssetScreen from './src/screens/Asset';
import PrivateVaultsScreen from './src/screens/PrivateVaults';
import SharedVaultsScreen from './src/screens/SharedVaults';
import TrackingScreen from './src/screens/Tracking';
import MembershipScreen from './src/screens/Membership';
import SettingsScreen from './src/screens/Settings';
import ProfileScreen from './src/screens/Profile';
import EmailNotificationsScreen from './src/screens/EmailNotifications';
import SignInScreen from './src/screens/SignIn';
import SignUpScreen from './src/screens/SignUp';
import ForgotPasswordScreen from './src/screens/ForgotPassword';
import ChooseSubscriptionScreen from './src/screens/ChooseSubscription';
import VersionFooter from './src/components/VersionFooter';

enableScreens();

const Stack = createNativeStackNavigator();

const navigationRef = createNavigationContainerRef();

const PENDING_INVITE_CODE_KEY = 'lamb-mobile-pending-invite-code-v1';

const parseInviteCodeFromUrl = (url) => {
  const raw = typeof url === 'string' ? url : '';
  if (!raw) return null;

  try {
    const parsed = ExpoLinking.parse(raw);
    const path = typeof parsed?.path === 'string' ? parsed.path : '';
    const qp = parsed?.queryParams && typeof parsed.queryParams === 'object' ? parsed.queryParams : {};
    const qpCode = qp?.code != null ? String(qp.code) : '';
    if (qpCode.trim()) return qpCode.trim();

    const cleanPath = path.replace(/^\//, '');
    const m = cleanPath.match(/^(invite|invitation)\/([^/?#]+)/i);
    if (m && m[2]) return decodeURIComponent(String(m[2]));
  } catch {
    // ignore
  }
  return null;
};

const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'lamb://'],
  config: {
    screens: {
      // Auth
      SignIn: 'signin',
      SignUp: 'signup',
      ForgotPassword: 'forgot-password',
      ChooseSubscription: 'subscribe',

      // Main
      Home: '',
      PrivateVaults: 'private',
      SharedVaults: 'shared',
      Tracking: 'tracking',
      Vault: 'vault/:vaultId',
      Collection: 'collection/:collectionId',
      Asset: {
        path: 'asset/:assetId',
        parse: {
          assetId: (v) => String(v),
          vaultId: (v) => (v == null ? undefined : String(v)),
        },
      },
      Membership: 'membership',
      Settings: 'settings',
      Profile: 'profile',
      EmailNotifications: 'email-notifications',
    },
  },
  getStateFromPath(path, options) {
    // Map invite links back to Home. (The actual accept flow is handled by AppFrame listeners.)
    const p = typeof path === 'string' ? path.replace(/^\//, '') : '';
    if (/^(invite|invitation)(\/|\?|$)/i.test(p)) {
      return defaultGetStateFromPath('', options);
    }
    return defaultGetStateFromPath(path, options);
  },
};

const AuthStack = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      animation: Platform.OS === 'ios' ? 'slide_from_right' : 'default',
      gestureEnabled: true,
    }}
  >
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
    <Stack.Screen name="ChooseSubscription" component={ChooseSubscriptionScreen} />
  </Stack.Navigator>
);

const MainStack = () => {
  const { theme } = useData();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: theme.background },
        animation: Platform.OS === 'ios' ? 'slide_from_right' : 'default',
        gestureEnabled: true,
      }}
    >
    <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
    <Stack.Screen name="PrivateVaults" component={PrivateVaultsScreen} options={{ headerShown: false }} />
    <Stack.Screen name="SharedVaults" component={SharedVaultsScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Tracking" component={TrackingScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Vault" component={VaultScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Collection" component={CollectionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Asset" component={AssetScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Membership" component={MembershipScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    <Stack.Screen name="ChooseSubscription" component={ChooseSubscriptionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
    <Stack.Screen name="EmailNotifications" component={EmailNotificationsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

function RootNavigator() {
  const { currentUser, loading } = useData();
  if (loading) return null;

  // Keyed navigators ensure we don't preserve route state across auth transitions.
  // This fixes cases where a screen name exists in both stacks (e.g. ChooseSubscription)
  // and the user remains on that screen after signup.
  if (!currentUser) return <AuthStack key="auth" />;
  return <MainStack key="main" />;
}

function ThemedStatusBar() {
  const { theme } = useData();
  return <StatusBar style={theme.statusBar} />;
}

function SessionTimeoutBoundary({ children }) {
  const { currentUser, recordActivity, enforceSessionTimeout } = useData();
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!currentUser) return;
    recordActivity?.();
  }, [currentUser?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (!currentUser) return;
      if ((prev === 'inactive' || prev === 'background') && nextState === 'active') {
        enforceSessionTimeout?.();
      }
    });

    return () => sub.remove();
  }, [currentUser?.id, enforceSessionTimeout]);

  useEffect(() => {
    if (!currentUser) return;
    const id = setInterval(() => {
      enforceSessionTimeout?.();
    }, 30 * 1000);
    return () => clearInterval(id);
  }, [currentUser?.id, enforceSessionTimeout]);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordActivity?.();
        return false;
      }}
    >
      {children}
    </View>
  );
}

function AppFrame() {
  const { theme, currentUser, acceptInvitationCode, backendReachable, showNotice } = useData();
  const [routeName, setRouteName] = useState(null);

  const updateRouteName = () => {
    try {
      if (!navigationRef?.isReady?.()) return;
      const name = navigationRef.getCurrentRoute?.()?.name || null;
      setRouteName(name);
    } catch {
      // ignore
    }
  };

  const acceptInviteIfPossible = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return { ok: false, skipped: true };

    if (!currentUser?.id) {
      await setItem(PENDING_INVITE_CODE_KEY, raw);
      return { ok: false, queued: true };
    }

    if (backendReachable === false) {
      await setItem(PENDING_INVITE_CODE_KEY, raw);
      return { ok: false, queued: true };
    }

    const res = await acceptInvitationCode?.(raw);
    if (!res || res.ok === false) {
      showNotice?.(res?.message || 'Unable to accept invitation.', { variant: 'error', durationMs: 2600 });
      return { ok: false };
    }

    await removeItem(PENDING_INVITE_CODE_KEY);
    showNotice?.('Invitation accepted.', { durationMs: 1600 });
    if (res?.vaultId) {
      try {
        navigationRef?.navigate?.('SharedVaults', { selectedVaultId: String(res.vaultId) });
      } catch {
        // ignore
      }
    }
    return { ok: true };
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const initialUrl = await ExpoLinking.getInitialURL().catch(() => null);
      if (!mounted) return;
      const code = parseInviteCodeFromUrl(initialUrl);
      if (code) {
        await acceptInviteIfPossible(code);
      }
    })();

    const sub = ExpoLinking.addEventListener('url', async ({ url }) => {
      const code = parseInviteCodeFromUrl(url);
      if (!code) return;
      await acceptInviteIfPossible(code);
    });

    return () => {
      mounted = false;
      try {
        sub?.remove?.();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, backendReachable]);

  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    (async () => {
      const queued = await getItem(PENDING_INVITE_CODE_KEY, null);
      if (cancelled) return;
      const raw = typeof queued === 'string' ? queued.trim() : '';
      if (!raw) return;
      await acceptInviteIfPossible(raw);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <NavigationContainer
        key={currentUser?.id ? String(currentUser.id) : 'anon'}
        ref={navigationRef}
        linking={linking}
        onReady={updateRouteName}
        onStateChange={updateRouteName}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top']}>
          <SessionTimeoutBoundary>
            <RootNavigator />
          </SessionTimeoutBoundary>
        </SafeAreaView>
      </NavigationContainer>
      <VersionFooter navigationRef={navigationRef} currentRouteName={routeName} />
      <ThemedStatusBar />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DataProvider>
        <AppFrame />
      </DataProvider>
    </SafeAreaProvider>
  );
}
