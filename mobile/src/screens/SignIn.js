import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Image, Platform } from 'react-native';
import { AntDesign, FontAwesome } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useData } from '../context/DataContext';
import { getItem, setItem, removeItem } from '../storage';
import LambHeader from '../components/LambHeader';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, isGoogleOAuthConfigured } from '../config/oauth';

WebBrowser.maybeCompleteAuthSession();

const REMEMBER_ME_ENABLED_KEY = 'lamb-mobile-remember-me-enabled-v1';
const REMEMBERED_IDENTIFIER_KEY = 'lamb-mobile-remembered-identifier-v1';

export default function SignIn({ navigation }) {
  const { login, loginWithApple, loginWithGoogleIdToken, loading, biometricUserId, biometricLogin, users, theme, backendReachable, showNotice } = useData();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isOffline = backendReachable === false;

  const notifyError = (message) => showNotice?.(message, { variant: 'error', durationMs: 2600 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const enabled = await getItem(REMEMBER_ME_ENABLED_KEY, null);
      const savedIdentifier = await getItem(REMEMBERED_IDENTIFIER_KEY, '');
      if (cancelled) return;

      const nextRememberMe = enabled == null ? !!savedIdentifier : !!enabled;
      setRememberMe(nextRememberMe);
      if (nextRememberMe && savedIdentifier) setIdentifier(String(savedIdentifier));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
      notifyError('Google sign-in failed. Please try again.');
      return;
    }

    let cancelled = false;
    (async () => {
      if (submitting || loading || isOffline) return;
      setSubmitting(true);
      try {
        const res = await loginWithGoogleIdToken?.({ idToken });
        if (!cancelled && res && res.ok === false) {
          notifyError(res.message || 'Google sign-in failed');
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
      notifyError('Internet connection required. Please reconnect and try again.');
      return;
    }
    if (!identifier || !password) {
      notifyError('Please enter username/email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await login(identifier.trim(), password);
      if (!res.ok) {
        notifyError(res.message || 'Check your credentials.');
        return;
      }

       await setItem(REMEMBER_ME_ENABLED_KEY, rememberMe);
       if (rememberMe) {
         await setItem(REMEMBERED_IDENTIFIER_KEY, identifier.trim());
       } else {
         await removeItem(REMEMBERED_IDENTIFIER_KEY);
       }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRememberMe = async () => {
    const next = !rememberMe;
    setRememberMe(next);
    await setItem(REMEMBER_ME_ENABLED_KEY, next);
    if (!next) {
      await removeItem(REMEMBERED_IDENTIFIER_KEY);
      return;
    }
    const trimmed = identifier.trim();
    if (trimmed) await setItem(REMEMBERED_IDENTIFIER_KEY, trimmed);
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
            styles.socialButton,
            styles.appleButton,
            (submitting || loading || isOffline) && styles.buttonDisabled,
          ]}
          onPress={async () => {
            if (submitting || loading || isOffline) return;
            setSubmitting(true);
            try {
              const res = await loginWithApple?.();
              if (!res?.ok && res?.message && res.message !== 'Canceled') {
                notifyError(res.message);
              }
            } finally {
              setSubmitting(false);
            }
          }}
          disabled={submitting || loading || isOffline}
        >
          <View style={styles.socialButtonIconWrap}>
            <FontAwesome name="apple" size={18} color="#ffffff" />
          </View>
          <Text style={[styles.socialButtonText, styles.appleButtonText]}>Continue with Apple</Text>
          <View style={styles.socialButtonSpacer} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.socialButton,
          styles.googleButton,
          (submitting || loading || isOffline) && styles.buttonDisabled,
        ]}
        onPress={async () => {
          if (submitting || loading || isOffline) return;
          if (!isGoogleOAuthConfigured()) {
            notifyError('Google sign-in is not configured for this build.');
            return;
          }
          if (!googleDiscovery) {
            notifyError('Google sign-in is not ready yet. Please try again.');
            return;
          }
          try {
            await googlePromptAsync?.({ useProxy: true });
          } catch {
            notifyError('Google sign-in failed. Please try again.');
          }
        }}
        disabled={submitting || loading || isOffline || !googleRequest || !googleDiscovery}
      >
        <View style={styles.socialButtonIconWrap}>
          <AntDesign name="google" size={18} color="#111827" />
        </View>
        <Text style={[styles.socialButtonText, styles.googleButtonText]}>Continue with Google</Text>
        <View style={styles.socialButtonSpacer} />
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
                notifyError(res?.message || 'Could not sign in with Face ID');
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
        style={styles.rememberRow}
        onPress={toggleRememberMe}
        disabled={submitting || loading}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: rememberMe }}
      >
        <View
          style={[
            styles.rememberBox,
            {
              borderColor: theme.border,
              backgroundColor: rememberMe ? theme.surface : 'transparent',
            },
          ]}
        >
          {rememberMe && <FontAwesome name="check" size={12} color={theme.text} />}
        </View>
        <Text style={[styles.rememberText, { color: theme.textSecondary }]}>Remember me</Text>
      </TouchableOpacity>

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
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  socialButtonIconWrap: { width: 22, alignItems: 'center' },
  socialButtonSpacer: { width: 22 },
  socialButtonText: { flex: 1, textAlign: 'center', fontWeight: '700' },
  appleButton: { backgroundColor: '#000000', borderColor: '#ffffff' },
  appleButtonText: { color: '#ffffff' },
  googleButton: { backgroundColor: '#ffffff', borderColor: '#e5e7eb' },
  googleButtonText: { color: '#111827' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  rememberBox: { width: 20, height: 20, borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  rememberText: { fontWeight: '600' },
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600' },
});
