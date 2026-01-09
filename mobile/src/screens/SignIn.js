import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Image } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function SignIn({ navigation }) {
  const { login, loading } = useData();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!identifier || !password) {
      Alert.alert('Missing info', 'Please enter username/email and password');
      return;
    }
    setSubmitting(true);
    const res = login(identifier.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      Alert.alert('Sign in failed', res.message || 'Check your credentials');
      return;
    }
  };

  return (
    <View style={styles.container}>
      <LambHeader />
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.tagline}>Take Control</Text>
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.subtitle}>Use your LAMB username or email.</Text>
      <TextInput
        style={styles.input}
        placeholder="Username or email"
        placeholderTextColor="#80869b"
        autoCapitalize="none"
        value={identifier}
        onChangeText={setIdentifier}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#80869b"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={submitting || loading}>
        <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign In'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
        <Text style={styles.link}>Need an account? Sign up</Text>
      </TouchableOpacity>
      <View style={styles.helperBox}>
        <Text style={styles.helperText}>Demo users: alex/demo123 or sam/demo123</Text>
      </View>
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
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600' },
  helperBox: { marginTop: 16, padding: 12, backgroundColor: '#11121a', borderRadius: 10, borderWidth: 1, borderColor: '#1f2738' },
  helperText: { color: '#9aa1b5', fontSize: 13 },
});
