import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function SignUp({ navigation }) {
  const { register, loading, users } = useData();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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
  const isFormValid = firstName && lastName && email && username && password && !usernameTaken && !emailTaken && !emailInvalid;

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
    <ScrollView contentContainerStyle={styles.container}>
      <LambHeader />
      <Text style={styles.title}>Create Account</Text>
      
      <TextInput style={styles.input} placeholder="First name" placeholderTextColor="#80869b" value={firstName} onChangeText={setFirstName} />
      
      <TextInput style={styles.input} placeholder="Last name" placeholderTextColor="#80869b" value={lastName} onChangeText={setLastName} />
      
      <View>
        <TextInput 
          style={[styles.input, emailInvalid || emailTaken ? styles.inputError : null]}
          placeholder="Email" 
          placeholderTextColor="#80869b" 
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
          style={[styles.input, usernameTaken ? styles.inputError : null]}
          placeholder="Username" 
          placeholderTextColor="#80869b" 
          value={username} 
          autoCapitalize="none" 
          onChangeText={setUsername} 
        />
        {usernameTaken && <Text style={styles.errorText}>Username is already in use</Text>}
      </View>
      
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#80869b" secureTextEntry value={password} onChangeText={setPassword} />
      
      <TouchableOpacity 
        style={[styles.button, (!isFormValid || loading) && styles.buttonDisabled]} 
        onPress={handleSubmit} 
        disabled={!isFormValid || loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Please wait…' : 'Continue'}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
        <Text style={styles.link}>Have an account? Sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 24, paddingHorizontal: 24, paddingBottom: 40, backgroundColor: '#0b0b0f', gap: 12, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#fff' },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  inputError: { borderColor: '#ef4444', borderWidth: 2 },
  errorText: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 4, marginLeft: 4 },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700' },
  link: { color: '#9ab6ff', marginTop: 12, fontWeight: '600', textAlign: 'center', paddingBottom: 32 },
});
