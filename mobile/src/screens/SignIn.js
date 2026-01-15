import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Image, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, isGoogleOAuthConfigured } from '../config/oauth';

WebBrowser.maybeCompleteAuthSession();

export default function SignIn({ navigation }) {
  const { login, loginWithApple, loginWithGoogleIdToken, loading, biometricUserId, biometricLogin, users, theme, backendReachable, showAlert } = useData();
  const Alert = { alert: showAlert };
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isOffline = backendReachable === false;

  const googleDiscovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const googleClientId = Platform.OS === 'ios'
    ? (GOOGLE_IOS_CLIENT_ID || GOOGLE_WEB_CLIENT_ID)
    : Platform.OS === 'android'
      ? (GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID)
      : GOOGLE_WEB_CLIENT_ID;

  const [googleRequest, googleResponse, googlePromptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClientId || 'MISSING_CLIENT_ID',
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'lamb' }),
    },
    googleDiscovery
  );

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type !== 'success') return;
    const idToken = googleResponse?.params?.id_token;
    if (!idToken) {
      Alert.alert('Google Sign In', 'Google sign-in failed. Please try again.');
      return;
    }

    let cancelled = false;
    (async () => {
      if (submitting || loading || isOffline) return;
      setSubmitting(true);
      try {
        const res = await loginWithGoogleIdToken?.({ idToken });
        if (!cancelled && res && res.ok === false) {
          Alert.alert('Google Sign In', res.message || 'Google sign-in failed');
        }
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  const biometricUserLabel = (() => {
    if (!biometricUserId) return null;
    const match = (users || []).find((u) => u?.id === biometricUserId);
    return match?.username || match?.email || null;
  })();

  const handleSubmit = async () => {
    if (isOffline) {
      Alert.alert('Offline', 'Internet connection required. Please reconnect and try again.');
      return;
    }
    if (!identifier || !password) {
      Alert.alert('Missing info', 'Please enter username/email and password');
      return;
    }
    setSubmitting(true);
    try {
      const res = await login(identifier.trim(), password);
      if (!res.ok) {
        Alert.alert('Sign in failed', res.message || 'Check your credentials');
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LambHeader />
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={[styles.tagline, { color: theme.textSecondary }]}>Simple Asset Management</Text>
      <Text style={[styles.title, { color: theme.text }]}>Sign In</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Use your LAMB username or email.</Text>

      {Platform.OS === 'ios' && (
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
            (submitting || loading || isOffline) && styles.buttonDisabled,
          ]}
          onPress={async () => {
            if (submitting || loading || isOffline) return;
            setSubmitting(true);
            try {
              const res = await loginWithApple?.();
              if (!res?.ok && res?.message && res.message !== 'Canceled') {
                Alert.alert('Apple Sign In', res.message);
              }
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting || loading || isOffline}
        >
          <Text style={styles.secondaryButtonText}>Continue with Apple</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.secondaryButton,
          { backgroundColor: theme.surface, borderColor: theme.border },
          (submitting || loading || isOffline) && styles.buttonDisabled,
        ]}
        onPress={async () => {
          if (submitting || loading || isOffline) return;
          if (!isGoogleOAuthConfigured()) {
            Alert.alert('Google Sign In', 'Google sign-in is not configured for this build.');
            return;
          }
          if (!googleDiscovery) {
            Alert.alert('Google Sign In', 'Google sign-in is not ready yet. Please try again.');
            return;
          }
          try {
            await googlePromptAsync?.({ useProxy: true });
          } catch {
            Alert.alert('Google Sign In', 'Google sign-in failed. Please try again.');
          }
        }}
        disabled={submitting || loading || isOffline || !googleRequest || !googleDiscovery}
      >
        <Text style={styles.secondaryButtonText}>Continue with Google</Text>
      </TouchableOpacity>

      {Platform.OS === 'ios' && !!biometricUserId && (
        <TouchableOpacity
          style={[
            styles.secondaryButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
            (submitting || loading || isOffline) && styles.buttonDisabled,
          ]}
          onPress={async () => {
            if (submitting || loading || isOffline) return;
            setSubmitting(true);
            try {
              const res = await biometricLogin?.();
              if (!res?.ok) {
                Alert.alert('Face ID Sign In', res?.message || 'Could not sign in with Face ID');
              }
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting || loading || isOffline}
        >
          <Text style={styles.secondaryButtonText}>
            {biometricUserLabel ? `Sign in with Face ID (${biometricUserLabel})` : 'Sign in with Face ID'}
          </Text>
        </TouchableOpacity>
      )}

      <TextInput
        style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
        placeholder="Username or email"
        placeholderTextColor={theme.placeholder}
        autoCapitalize="none"
        autoComplete="username"
        textContentType="username"
        value={identifier}
        onChangeText={setIdentifier}
      />
      <TextInput
        style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
        placeholder="Password"
        placeholderTextColor={theme.placeholder}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity
        style={[styles.button, (submitting || loading || isOffline) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting || loading || isOffline}
      >
        <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign In'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          const prefillEmail = identifier.includes('@') ? identifier.trim() : '';
          navigation.navigate('ForgotPassword', { prefillEmail });
        }}
        disabled={submitting || loading || isOffline}
      >
        <Text style={[styles.link, { color: theme.link, marginTop: 6 }]}>Forgot password?</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
        <Text style={[styles.link, { color: theme.link }]}>Need an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0b0b0f', gap: 12, justifyContent: 'center' },
  logo: { width: 96, height: 96, alignSelf: 'center', marginBottom: 4 },
  tagline: { color: '#c5c5d0', textAlign: 'center', fontWeight: '700', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff' },
  subtitle: { color: '#c5c5d0', marginBottom: 8 },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  secondaryButtonText: { color: '#e5e7f0', fontWeight: '700' },
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600' },
});
