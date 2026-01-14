import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { AppState, View, Text, TouchableOpacity, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import { DataProvider } from './src/context/DataContext';
import { useData } from './src/context/DataContext';
import HomeScreen from './src/screens/Home';
import VaultScreen from './src/screens/Vault';
import CollectionScreen from './src/screens/Collection';
import AssetScreen from './src/screens/Asset';
import MembershipScreen from './src/screens/Settings';
import ProfileScreen from './src/screens/Profile';
import EmailNotificationsScreen from './src/screens/EmailNotifications';
import SignInScreen from './src/screens/SignIn';
import SignUpScreen from './src/screens/SignUp';
import FreeTrialScreen from './src/screens/FreeTrial';
import ChooseSubscriptionScreen from './src/screens/ChooseSubscription';
import VersionFooter from './src/components/VersionFooter';

enableScreens();

const Stack = createNativeStackNavigator();

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
    <Stack.Screen name="FreeTrial" component={FreeTrialScreen} />
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
      }}
    >
    <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Vault" component={VaultScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Collection" component={CollectionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Asset" component={AssetScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Membership" component={MembershipScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
    <Stack.Screen name="EmailNotifications" component={EmailNotificationsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

const LimitedStack = () => {
  const { theme } = useData();
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Membership" component={MembershipScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EmailNotifications" component={EmailNotificationsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

function RootNavigator() {
  const { currentUser, loading, backendReachable, membershipAccess } = useData();
  if (loading) return null;

  if (backendReachable === false) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>Internet required</Text>
        <Text style={{ textAlign: 'center', opacity: 0.8, marginBottom: 16 }}>
          LAMB is running in staging-only mode and needs an active internet connection.
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://lamb-backend-staging.onrender.com/health').catch(() => {})}
          style={{ paddingVertical: 10, paddingHorizontal: 14 }}
        >
          <Text style={{ fontWeight: '700' }}>Check server status</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!currentUser) return <AuthStack />;
  if (!membershipAccess) return <LimitedStack />;
  return <MainStack />;
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

export default function App() {
  return (
    <SafeAreaProvider>
      <DataProvider>
        <NavigationContainer>
          <SessionTimeoutBoundary>
            <RootNavigator />
          </SessionTimeoutBoundary>
        </NavigationContainer>
        <VersionFooter />
        <ThemedStatusBar />
      </DataProvider>
    </SafeAreaProvider>
  );
}
