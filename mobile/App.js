import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
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
import ForgotPasswordScreen from './src/screens/ForgotPassword';
import FreeTrialScreen from './src/screens/FreeTrial';
import ChooseSubscriptionScreen from './src/screens/ChooseSubscription';
import VersionFooter from './src/components/VersionFooter';

enableScreens();

const Stack = createNativeStackNavigator();

const navigationRef = createNavigationContainerRef();

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
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
    <Stack.Screen name="ChooseSubscription" component={ChooseSubscriptionScreen} options={{ headerShown: false }} />
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
      <Stack.Screen name="ChooseSubscription" component={ChooseSubscriptionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EmailNotifications" component={EmailNotificationsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
};

function RootNavigator() {
  const { currentUser, loading, membershipAccess } = useData();
  if (loading) return null;

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
        <NavigationContainer ref={navigationRef}>
          <SessionTimeoutBoundary>
            <RootNavigator />
          </SessionTimeoutBoundary>
        </NavigationContainer>
        <VersionFooter navigationRef={navigationRef} />
        <ThemedStatusBar />
      </DataProvider>
    </SafeAreaProvider>
  );
}
