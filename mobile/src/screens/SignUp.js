import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchSignInMethodsForEmail } from 'firebase/auth';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { firebaseAuth, isFirebaseConfigured } from '../firebase';
import { API_URL } from '../config/stripe';
import { apiFetch } from '../utils/apiFetch';

export default function SignUp({ navigation }) {
  const { register, loading, theme, resetAllData, ensureFirebaseSignupAuth } = useData();
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);
  const [emailCheckError, setEmailCheckError] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);

  const stripInvisibleChars = (value) => String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const normalizeEmail = (value) => stripInvisibleChars(value).trim().toLowerCase();
  const normalizeUsername = (value) => stripInvisibleChars(value).trim().toLowerCase();

  const hasDisallowedControlChars = (value) => /[\u0000-\u001F\u007F]/.test(String(value || ''));

  const validateUsernameLive = (value) => {
    const v = normalizeUsername(value);
    if (!v) return 'Username is required';
    if (v.length < 3) return 'Username must be at least 3 characters';
    if (v.length > 20) return 'Username must be 20 characters or fewer';
    if (hasDisallowedControlChars(v)) return 'Username contains invalid characters';
    if (/\s/.test(v)) return 'Username cannot contain spaces';
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(v)) {
      return 'Username can only use letters, numbers, dot, underscore, and hyphen';
    }
    return null;
  };

  const passwordInvalid = useMemo(() => {
    if (!password) return false;
    if (password.length < 12) return true;
    if (password.length > 72) return true;
    if (/\s/.test(password)) return true;
    if (!/[A-Za-z]/.test(password)) return true;
    if (!/\d/.test(password)) return true;
    if (!/[^A-Za-z0-9]/.test(password)) return true;
    const lower = password.toLowerCase();
    const uname = (username || '').trim().toLowerCase();
    if (uname && lower.includes(uname)) return true;
    const emailLocal = (email || '').trim().toLowerCase().split('@')[0];
    if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) return true;
    return false;
  }, [password, username, email]);

  // Validate email format/characters
  const emailError = useMemo(() => {
    const v = normalizeEmail(email);
    if (!v) return null;
    if (v.length > 320) return 'Email is too long';
    if (hasDisallowedControlChars(v)) return 'Email contains invalid characters';
    if (/\s/.test(v)) return 'Email cannot contain spaces';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address';
    return null;
  }, [email]);

  const usernameError = useMemo(() => {
    const v = normalizeUsername(username);
    if (!v) return null;
    return validateUsernameLive(v);
  }, [username]);

  const checkEmailInUse = async (emailValue) => {
    const v = normalizeEmail(emailValue);
    if (!v || emailError) return { ok: true, taken: false };

    // Prefer server-side lookup for reliability (Firebase Admin).
    try {
      const resp = await apiFetch(`${API_URL}/email-available`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: v }),
      });
      if (resp.ok) {
        const json = await resp.json().catch(() => null);
        if (json && json.available === false) return { ok: true, taken: true };
        if (json && json.available === true) return { ok: true, taken: false };
      }
      // Fall through to client-side check if the endpoint is unavailable.
    } catch {
      // Fall through
    }

    if (!isFirebaseConfigured() || !firebaseAuth) return { ok: true, taken: false };
    try {
      const methods = await fetchSignInMethodsForEmail(firebaseAuth, v);
      const taken = Array.isArray(methods) && methods.length > 0;
      return { ok: true, taken };
    } catch (e) {
      return { ok: false, message: e?.message ? String(e.message) : 'Could not verify email' };
    }
  };

  const handleEmailBlur = async () => {
    setEmailBlurred(true);
    const v = normalizeEmail(email);
    if (!v || emailError) return;

    setEmailChecking(true);
    setEmailCheckError(null);
    try {
      const res = await checkEmailInUse(v);
      if (res.ok) {
        setEmailTaken(!!res.taken);
      } else {
        setEmailTaken(false);
        setEmailCheckError(res.message || 'Could not verify email');
      }
    } finally {
      setEmailChecking(false);
    }
  };

  // Check if form is valid
  const isFormValid =
    firstName &&
    lastName &&
    email &&
    username &&
    password &&
    !emailError &&
    !emailTaken &&
    !emailChecking &&
    !emailCheckError &&
    !usernameError &&
    !passwordInvalid;

  const handleSubmit = async () => {
    if (!firstName || !lastName || !email || !username || !password) {
      Alert.alert('Missing info', 'Please fill all fields');
      return;
    }

    if (emailError) {
      Alert.alert('Invalid email', emailError);
      return;
    }

    // If the user never unfocused the email field, run the same blur check now.
    if (!emailBlurred) {
      await handleEmailBlur();
    }

    if (emailTaken) {
      setEmailBlurred(true);
      return;
    }

    if (emailChecking) return;

    if (emailCheckError) return;

    // Safety net: re-check right before proceeding, but do not alert.
    // If the email is taken, surface it inline on the email field.
    const finalCheck = await checkEmailInUse(email);
    if (!finalCheck.ok) {
      setEmailCheckError(finalCheck.message || 'Could not verify email');
      return;
    }
    if (finalCheck.taken) {
      setEmailBlurred(true);
      setEmailTaken(true);
      return;
    }

    if (usernameError) {
      Alert.alert('Invalid username', usernameError);
      return;
    }

    if (passwordInvalid) {
      Alert.alert('Weak password', 'Use 12+ characters with a letter, number, and symbol. Avoid your username/email.');
      return;
    }

    // Authoritative check: attempt to establish Firebase Auth for this email now.
    // This prevents discovering "email already in use" only after selecting a plan.
    if (ensureFirebaseSignupAuth) {
      const authRes = await ensureFirebaseSignupAuth({
        email: normalizeEmail(email),
        password,
        username: normalizeUsername(username),
      });

      if (authRes && authRes.ok === false) {
        const msg = authRes.message || 'Unable to create account. Please try again.';
        if (/email is already in use|email-already-in-use/i.test(String(msg))) {
          setEmailBlurred(true);
          setEmailTaken(true);
          return;
        }
        Alert.alert('Sign up failed', msg);
        return;
      }
    }

    // Show free trial info before plan selection
    navigation.navigate('FreeTrial', {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizeEmail(email),
      username: normalizeUsername(username),
      password
    });
  };

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleClearLocalData = () => {
    Alert.alert(
      'Clear Local Data',
      'This removes all locally stored accounts and content on this device. Remote accounts are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetAllData?.();
              setFirstName('');
              setLastName('');
              setEmail('');
              setUsername('');
              setPassword('');
              Alert.alert('Cleared', 'Local data has been cleared.');
            } catch {
              Alert.alert('Error', 'Could not clear local data.');
            }
          },
        },
      ]
    );
  };

  const footerSpacer = 72 + (insets?.bottom || 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.container, { backgroundColor: theme.background, paddingBottom: 24 + footerSpacer }]}
      keyboardShouldPersistTaps="handled"
    >
      <LambHeader />
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={[styles.tagline, { color: theme.textSecondary }]}>Take Control</Text>
      <Text style={[styles.title, { color: theme.text }]}>Create Account</Text>
      
      <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder="First name" placeholderTextColor={theme.placeholder} value={firstName} onChangeText={setFirstName} />
      
      <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder="Last name" placeholderTextColor={theme.placeholder} value={lastName} onChangeText={setLastName} />
      
      <View>
        <TextInput 
          style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }, (emailError || emailTaken) ? styles.inputError : null]}
          placeholder="Email" 
          placeholderTextColor={theme.placeholder} 
          value={email} 
          autoCapitalize="none" 
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          inputMode="email"
          keyboardType="email-address" 
          onChangeText={(t) => {
            setEmailBlurred(false);
            setEmailTaken(false);
            setEmailCheckError(null);
            setEmail(normalizeEmail(String(t || '')));
          }}
          onBlur={handleEmailBlur}
        />
        {!!emailError && <Text style={styles.errorText}>{emailError}</Text>}
        {emailBlurred && emailTaken && <Text style={styles.errorText}>Email is already in use</Text>}
        {!emailError && !emailTaken && emailChecking && (
          <Text style={styles.errorText}>Checking email…</Text>
        )}
        {!emailError && !emailTaken && !!emailCheckError && (
          <Text style={styles.errorText}>Could not verify email right now</Text>
        )}
      </View>
      
      <View>
        <TextInput 
          style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }, usernameError ? styles.inputError : null]}
          placeholder="Username" 
          placeholderTextColor={theme.placeholder} 
          value={username} 
          autoCapitalize="none" 
          autoCorrect={false}
          onChangeText={(t) => setUsername(normalizeUsername(String(t || '')))} 
        />
        {!!usernameError && <Text style={styles.errorText}>{usernameError}</Text>}
      </View>
      
      <View>
        <TextInput
          style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }, passwordInvalid ? styles.inputError : null]}
          placeholder="Password"
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          // Apple iOS password rules hint (enforcement happens in DataContext.register)
          passwordRules="minlength: 12; required: lower; required: upper; required: digit; required: special;"
          value={password}
          onChangeText={setPassword}
        />
        {passwordInvalid && (
          <Text style={styles.errorText}>12+ chars with letter, number, symbol; no spaces; avoid username/email</Text>
        )}
      </View>
      
      <TouchableOpacity 
        style={[styles.button, (!isFormValid || loading) && styles.buttonDisabled]} 
        onPress={handleSubmit} 
        disabled={!isFormValid || loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Please wait…' : 'Continue'}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
        <Text style={[styles.link, { color: theme.link }]}>Have an account? Sign in</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleClearLocalData} disabled={loading}>
        <Text style={[styles.link, { color: theme.textSecondary, marginTop: 8, marginBottom: 24 }]}>Clear local data</Text>
      </TouchableOpacity>

      <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
        <Text style={[styles.legalTitle, { color: theme.text }]}>Legal</Text>
        {LEGAL_LINK_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.legalRow}
            onPress={() => openLegalLink(item.url)}
            accessibilityRole="link"
          >
            <Text style={[styles.legalLink, { color: theme.link }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingVertical: 24, paddingHorizontal: 24, backgroundColor: '#0b0b0f', gap: 12, justifyContent: 'center' },
  logo: { width: 96, height: 96, alignSelf: 'center', marginBottom: 4 },
  tagline: { color: '#c5c5d0', textAlign: 'center', fontWeight: '700', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff' },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  inputError: { borderColor: '#ef4444', borderWidth: 2 },
  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 4, marginLeft: 4 },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700' },
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600', textAlign: 'center', marginBottom: 32 },
  legalCard: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8 },
  legalTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  legalRow: { paddingVertical: 4 },
  legalLink: { color: '#9ab6ff', fontWeight: '600' },
});
