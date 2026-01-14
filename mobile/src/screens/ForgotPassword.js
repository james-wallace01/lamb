import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { firebaseAuth, isFirebaseConfigured } from '../firebase';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export default function ForgotPassword({ navigation, route }) {
  const { theme, showAlert } = useData();
  const Alert = { alert: showAlert };
  const initial = normalizeEmail(route?.params?.prefillEmail);
  const [email, setEmail] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  const emailError = useMemo(() => {
    const v = normalizeEmail(email);
    if (!v) return null;
    if (v.length > 320) return 'Email is too long';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address';
    return null;
  }, [email]);

  const handleSend = async () => {
    const v = normalizeEmail(email);
    if (!v) {
      Alert.alert('Missing info', 'Please enter your email address.');
      return;
    }
    if (emailError) {
      Alert.alert('Invalid email', emailError);
      return;
    }
    if (!isFirebaseConfigured() || !firebaseAuth) {
      Alert.alert('Unavailable', 'Password reset is not available right now.');
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, v);
    } catch {
      // Intentionally do not reveal whether the email exists.
    } finally {
      setSubmitting(false);
    }

    Alert.alert('Check your email', 'If an account exists for that email, you will receive a reset link shortly.', [
      { text: 'OK', onPress: () => navigation.navigate('SignIn') },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}
    >
      <LambHeader />
      <Text style={[styles.title, { color: theme.text }]}>Reset Password</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Enter the email address for your account.</Text>

      <TextInput
        style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
        placeholder="Email"
        placeholderTextColor={theme.placeholder}
        autoCapitalize="none"
        autoComplete="email"
        inputMode="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />

      {!!emailError && <Text style={[styles.errorText, { color: theme.danger }]}>{emailError}</Text>}

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSend}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send reset link'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('SignIn')} disabled={submitting}>
        <Text style={[styles.link, { color: theme.link }]}>Back to sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12 },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '700' },
  link: { marginTop: 12, fontWeight: '600' },
  errorText: { marginTop: -4, fontWeight: '600' },
});
