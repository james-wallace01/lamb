import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Image, Platform } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function SignIn({ navigation }) {
  const { login, loading, biometricUserId, biometricLogin, users, theme, backendReachable, showAlert } = useData();
  const Alert = { alert: showAlert };
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isOffline = backendReachable === false;

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
      <Text style={[styles.tagline, { color: theme.textSecondary }]}>Take Control</Text>
      <Text style={[styles.title, { color: theme.text }]}>Sign In</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Use your LAMB username or email.</Text>

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
