import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView, Image } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function SignUp({ navigation }) {
  const { register, loading, users, theme } = useData();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Check for duplicate username
  const usernameTaken = useMemo(() => 
    username.trim().length > 0 && users.some(u => u.username === username.trim()),
    [username, users]
  );

  // Check for duplicate email
  const emailTaken = useMemo(() => 
    email.trim().length > 0 && users.some(u => u.email === email.trim()),
    [email, users]
  );

  // Validate email format
  const emailInvalid = useMemo(() => 
    email.trim().length > 0 && !emailRegex.test(email.trim()),
    [email]
  );

  // Check if form is valid
  const isFormValid = firstName && lastName && email && username && password && !usernameTaken && !emailTaken && !emailInvalid && !passwordInvalid;

  const handleSubmit = () => {
    if (!firstName || !lastName || !email || !username || !password) {
      Alert.alert('Missing info', 'Please fill all fields');
      return;
    }

    if (emailInvalid) {
      Alert.alert('Invalid email', 'Please enter a valid email address');
      return;
    }

    if (emailTaken) {
      Alert.alert('Email taken', 'This email is already in use');
      return;
    }

    if (usernameTaken) {
      Alert.alert('Username taken', 'This username is already taken');
      return;
    }

    if (passwordInvalid) {
      Alert.alert('Weak password', 'Use 12+ characters with a letter, number, and symbol. Avoid your username/email.');
      return;
    }

    // Show free trial info before plan selection
    navigation.navigate('FreeTrial', {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      username: username.trim(),
      password
    });
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
      <LambHeader />
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={[styles.tagline, { color: theme.textSecondary }]}>Take Control</Text>
      <Text style={[styles.title, { color: theme.text }]}>Create Account</Text>
      
      <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder="First name" placeholderTextColor={theme.placeholder} value={firstName} onChangeText={setFirstName} />
      
      <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder="Last name" placeholderTextColor={theme.placeholder} value={lastName} onChangeText={setLastName} />
      
      <View>
        <TextInput 
          style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }, emailInvalid || emailTaken ? styles.inputError : null]}
          placeholder="Email" 
          placeholderTextColor={theme.placeholder} 
          value={email} 
          autoCapitalize="none" 
          keyboardType="email-address" 
          onChangeText={setEmail} 
        />
        {emailInvalid && <Text style={styles.errorText}>Please enter a valid email address</Text>}
        {emailTaken && <Text style={styles.errorText}>Email is already in use</Text>}
      </View>
      
      <View>
        <TextInput 
          style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }, usernameTaken ? styles.inputError : null]}
          placeholder="Username" 
          placeholderTextColor={theme.placeholder} 
          value={username} 
          autoCapitalize="none" 
          onChangeText={setUsername} 
        />
        {usernameTaken && <Text style={styles.errorText}>Username is already in use</Text>}
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
});
