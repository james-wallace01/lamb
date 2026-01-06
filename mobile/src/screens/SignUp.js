import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function SignUp({ navigation }) {
  const { register, loading } = useData();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = () => {
    if (!firstName || !lastName || !email || !username || !password) {
      Alert.alert('Missing info', 'Please fill all fields');
      return;
    }
    // Navigate to subscription selection
    navigation.navigate('ChooseSubscription', {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      username: username.trim(),
      password
    });
  };

  return (
    <View style={styles.container}>
        <LambHeader />
      <Text style={styles.title}>Create Account</Text>
      <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#80869b" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Last name" placeholderTextColor="#80869b" value={lastName} onChangeText={setLastName} />
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#80869b" value={email} autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#80869b" value={username} autoCapitalize="none" onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#80869b" secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Please wait…' : 'Continue'}</Text>
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
