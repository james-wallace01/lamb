import 'react-native-gesture-handler';
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
import SettingsScreen from './src/screens/Settings';
import ProfileScreen from './src/screens/Profile';
import SignInScreen from './src/screens/SignIn';
import SignUpScreen from './src/screens/SignUp';

enableScreens();

const Stack = createNativeStackNavigator();

const AuthStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
  </Stack.Navigator>
);

const MainStack = () => (
  <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#0b0b0f' }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '700' } }}>
    <Stack.Screen name="Home" component={HomeScreen} />
    <Stack.Screen name="Vault" component={VaultScreen} />
    <Stack.Screen name="Collection" component={CollectionScreen} />
    <Stack.Screen name="Asset" component={AssetScreen} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="Profile" component={ProfileScreen} />
  </Stack.Navigator>
);

function RootNavigator() {
  const { currentUser, loading } = useData();
  if (loading) return null;
  return currentUser ? <MainStack /> : <AuthStack />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DataProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="light" />
      </DataProvider>
    </SafeAreaProvider>
  );
}
