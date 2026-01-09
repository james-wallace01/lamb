import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider } from '@stripe/stripe-react-native';
import { DataProvider } from './src/context/DataContext';
import { useData } from './src/context/DataContext';
import { STRIPE_PUBLISHABLE_KEY, STRIPE_MERCHANT_NAME } from './src/config/stripe';
import HomeScreen from './src/screens/Home';
import VaultScreen from './src/screens/Vault';
import CollectionScreen from './src/screens/Collection';
import AssetScreen from './src/screens/Asset';
import MembershipScreen from './src/screens/Settings';
import ProfileScreen from './src/screens/Profile';
import SignInScreen from './src/screens/SignIn';
import SignUpScreen from './src/screens/SignUp';
import ChooseSubscriptionScreen from './src/screens/ChooseSubscription';
import VersionFooter from './src/components/VersionFooter';

enableScreens();

const Stack = createNativeStackNavigator();

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
    <Stack.Screen name="ChooseSubscription" component={ChooseSubscriptionScreen} />
  </Stack.Navigator>
);

const MainStack = () => (
  <Stack.Navigator
    screenOptions={{ headerStyle: { backgroundColor: '#0b0b0f' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '700' } }}
  >
    <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Vault" component={VaultScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Collection" component={CollectionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Asset" component={AssetScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Membership" component={MembershipScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
  </Stack.Navigator>
);

function RootNavigator() {
  const { currentUser, loading } = useData();
  if (loading) return null;
  return currentUser ? <MainStack /> : <AuthStack />;
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
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} merchantIdentifier={STRIPE_MERCHANT_NAME}>
        <DataProvider>
          <NavigationContainer>
            <SessionTimeoutBoundary>
              <RootNavigator />
            </SessionTimeoutBoundary>
          </NavigationContainer>
          <VersionFooter />
          <StatusBar style="light" />
        </DataProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}
