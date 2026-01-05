import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useData } from '../context/DataContext';

export default function SignUp({ navigation }) {
  const { register, loading } = useData();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!firstName || !lastName || !email || !username || !password) {
      Alert.alert('Missing info', 'Please fill all fields');
      return;
    }
    setSubmitting(true);
    const res = register({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), username: username.trim(), password });
    setSubmitting(false);
    if (!res.ok) {
      Alert.alert('Sign up failed', res.message || 'Try a different username/email');
      return;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#80869b" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Last name" placeholderTextColor="#80869b" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#80869b" value={email} autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#80869b" value={username} autoCapitalize="none" onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#80869b" secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={submitting || loading}>
        <Text style={styles.buttonText}>{submitting ? 'Signing up…' : 'Sign Up'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
        <Text style={styles.link}>Have an account? Sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0b0b0f', gap: 12, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#fff' },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '700' },
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600' },
});
