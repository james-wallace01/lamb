import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import { useData } from '../context/DataContext';

export default function Settings() {
  const { resetPassword, deleteAccount } = useData();

  const handleResetPassword = () => {
    Alert.alert(
      'Reset password',
      'This will set your password to "changeme". You can sign in with it and update later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            const res = resetPassword('changeme');
            if (!res.ok) {
              Alert.alert('Could not reset', res.message || 'Please try again');
              return;
            }
            Alert.alert('Password reset', 'Your password is now "changeme". Please sign in again if prompted.');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This removes your account and data from this device. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const res = deleteAccount();
            if (!res.ok) {
              Alert.alert('Could not delete', res.message || 'Please try again');
              return;
            }
            Alert.alert('Account deleted', 'Your account was removed from this device.');
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.button} onPress={handleResetPassword}>
          <Text style={styles.buttonText}>Reset Password</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleDeleteAccount}>
          <Text style={[styles.buttonText, styles.deleteButtonText]}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', gap: 10 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16 },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  deleteButton: { backgroundColor: '#3b0f0f', borderColor: '#ef4444', borderWidth: 1 },
  deleteButtonText: { color: '#fecaca' },
});
