import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Image, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';

const DEFAULT_AVATAR = 'https://via.placeholder.com/112?text=Profile';

export default function Profile() {
  const { currentUser, updateCurrentUser, assets, validatePassword, resetPassword, deleteAccount } = useData();
  const [draft, setDraft] = useState(currentUser || {});
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const netWorth = useMemo(() => {
    if (!currentUser) return 0;
    const ownedAssets = assets.filter((a) => a.ownerId === currentUser.id);
    return ownedAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  }, [assets, currentUser]);

  useEffect(() => {
    setDraft(currentUser || {});
  }, [currentUser]);

  useEffect(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setCurrentPasswordError('');
    setConfirmPasswordError('');
    setResettingPassword(false);
    setShowResetPassword(false);
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  }, [currentUser?.id]);

  const handleSave = () => {
    if (!currentUser) return;
    setLoading(true);
    const result = updateCurrentUser({
      firstName: draft.firstName || '',
      lastName: draft.lastName || '',
      email: draft.email || '',
      username: draft.username || '',
      profileImage: draft.profileImage || currentUser.profileImage || DEFAULT_AVATAR,
    });
    setLoading(false);
    if (!result.ok) {
      Alert.alert(result.message || 'Could not save');
      return;
    }
    Alert.alert('Profile updated');
  };

  const handleProfilePictureChange = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera roll permission is required to select an image');
      return;
    }

    const mediaTypes = ImagePicker.MediaType?.Images || ImagePicker.MediaTypeOptions.Images;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]?.base64) {
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setDraft({ ...draft, profileImage: base64Image });
      Alert.alert('Image selected. Press Save to update your profile picture.');
    }
  };

  const handlePasswordChange = (text) => {
    setNewPassword(text);
    setPasswordError('');
    setConfirmPasswordError('');
    if (!text) {
      setPasswordError('');
      return;
    }
    const res = validatePassword(text);
    setPasswordError(res.ok ? '' : (res.message || 'Password does not meet requirements'));
  };

  const handleConfirmPasswordChange = (text) => {
    setConfirmNewPassword(text);
    setConfirmPasswordError('');
    if (!text) return;
    if (newPassword && text !== newPassword) {
      setConfirmPasswordError('Passwords do not match');
    }
  };

  const handleResetPassword = async () => {
    if (resettingPassword) return;

    if (!showResetPassword) {
      setShowResetPassword(true);
      return;
    }

    setCurrentPasswordError('');
    setPasswordError('');
    setConfirmPasswordError('');

    if (!currentPassword || !String(currentPassword).trim()) {
      setCurrentPasswordError('Please enter your current password');
      return;
    }

    if (!newPassword || !String(newPassword).trim()) {
      setPasswordError('Please enter a new password');
      return;
    }

    if (!confirmNewPassword || !String(confirmNewPassword).trim()) {
      setConfirmPasswordError('Please confirm your new password');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setConfirmPasswordError('Passwords do not match');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      setPasswordError(validation.message || 'Password does not meet requirements');
      return;
    }

    Alert.alert(
      'Reset password',
      'Set your password to the value you entered?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            (async () => {
              try {
                setResettingPassword(true);
                const res = await resetPassword({ currentPassword, newPassword });
                if (!res.ok) {
                  if (res.message === 'Current password is incorrect') {
                    setCurrentPasswordError(res.message);
                  } else {
                    setPasswordError(res.message || 'Please try again');
                  }
                  return;
                }
                setCurrentPassword('');
                setNewPassword('');
                setConfirmNewPassword('');
                setPasswordError('');
                setCurrentPasswordError('');
                setConfirmPasswordError('');
                setShowResetPassword(false);
                Alert.alert('Password updated', 'Your password was updated successfully.');
              } finally {
                setResettingPassword(false);
              }
            })();
          },
        },
      ]
    );
  };

  const handleCancelResetPassword = () => {
    if (resettingPassword) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setCurrentPasswordError('');
    setConfirmPasswordError('');
    setShowResetPassword(false);
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  };

  const handlePerformResetPassword = async () => {
    if (resettingPassword) return;

    setCurrentPasswordError('');
    setPasswordError('');
    setConfirmPasswordError('');

    if (!currentPassword || !String(currentPassword).trim()) {
      setCurrentPasswordError('Please enter your current password');
      return;
    }

    if (!newPassword || !String(newPassword).trim()) {
      setPasswordError('Please enter a new password');
      return;
    }

    if (!confirmNewPassword || !String(confirmNewPassword).trim()) {
      setConfirmPasswordError('Please confirm your new password');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setConfirmPasswordError('Passwords do not match');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.ok) {
      setPasswordError(validation.message || 'Password does not meet requirements');
      return;
    }

    try {
      setResettingPassword(true);
      const res = await resetPassword({ currentPassword, newPassword });
      if (!res.ok) {
        if (res.message === 'Current password is incorrect') {
          setCurrentPasswordError(res.message);
        } else {
          setPasswordError(res.message || 'Please try again');
        }
        return;
      }
      handleCancelResetPassword();
      Alert.alert('Password updated', 'Your password was updated successfully.');
    } finally {
      setResettingPassword(false);
    }
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
    <View style={styles.wrapper}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>
        <Text style={styles.title}>Profile</Text>
        {currentUser ? (
          <>
            <View style={styles.avatarContainer}>
              <TouchableOpacity onPress={handleProfilePictureChange} activeOpacity={0.8}>
                <Image
                  source={{ uri: draft.profileImage || currentUser.profileImage || DEFAULT_AVATAR }}
                  style={styles.avatar}
                />
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraText}>📷</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.netWorthCard}>
              <Text style={styles.netWorthLabel}>Net Worth</Text>
              <Text style={styles.netWorthValue}>
                ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>First Name</Text>
              <TextInput
                style={styles.input}
                placeholder="First name"
                placeholderTextColor="#80869b"
                value={draft.firstName || ''}
                onChangeText={(v) => setDraft({ ...draft, firstName: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Last Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Last name"
                placeholderTextColor="#80869b"
                value={draft.lastName || ''}
                onChangeText={(v) => setDraft({ ...draft, lastName: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#80869b"
                autoCapitalize="none"
                value={draft.username || ''}
                onChangeText={(v) => setDraft({ ...draft, username: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#80869b"
                keyboardType="email-address"
                autoCapitalize="none"
                value={draft.email || ''}
                onChangeText={(v) => setDraft({ ...draft, email: v })}
              />
            </View>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Account</Text>
              {!showResetPassword && (
                <TouchableOpacity
                  style={[styles.button, resettingPassword && styles.buttonDisabled]}
                  onPress={handleResetPassword}
                  disabled={resettingPassword}
                >
                  <Text style={styles.buttonText}>Reset Password</Text>
                </TouchableOpacity>
              )}
              {showResetPassword && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Current Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      placeholder="Enter current password"
                      placeholderTextColor="#80869b"
                      value={currentPassword}
                      onChangeText={(v) => {
                        setCurrentPassword(v);
                        setCurrentPasswordError('');
                      }}
                      secureTextEntry={!showCurrentPassword}
                      autoCapitalize="none"
                      textContentType="password"
                      autoComplete="current-password"
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowCurrentPassword((p) => !p)}
                      accessibilityRole="button"
                      accessibilityLabel={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                    >
                      <Text style={styles.eyeText}>👁</Text>
                    </TouchableOpacity>
                  </View>
                  {!!currentPasswordError && <Text style={styles.helperError}>{currentPasswordError}</Text>}

                  <Text style={styles.label}>New Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      placeholder="Enter a new password"
                      placeholderTextColor="#80869b"
                      value={newPassword}
                      onChangeText={handlePasswordChange}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      textContentType="newPassword"
                      autoComplete="new-password"
                      passwordRules="minlength: 12; required: lower; required: upper; required: digit; required: special;"
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowNewPassword((p) => !p)}
                      accessibilityRole="button"
                      accessibilityLabel={showNewPassword ? 'Hide new password' : 'Show new password'}
                    >
                      <Text style={styles.eyeText}>👁</Text>
                    </TouchableOpacity>
                  </View>
                  {!!passwordError && <Text style={styles.helperError}>{passwordError}</Text>}

                  <Text style={styles.label}>Confirm New Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      placeholder="Confirm new password"
                      placeholderTextColor="#80869b"
                      value={confirmNewPassword}
                      onChangeText={handleConfirmPasswordChange}
                      secureTextEntry={!showConfirmNewPassword}
                      autoCapitalize="none"
                      textContentType="newPassword"
                      autoComplete="new-password"
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowConfirmNewPassword((p) => !p)}
                      accessibilityRole="button"
                      accessibilityLabel={showConfirmNewPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      <Text style={styles.eyeText}>👁</Text>
                    </TouchableOpacity>
                  </View>
                  {!!confirmPasswordError && <Text style={styles.helperError}>{confirmPasswordError}</Text>}

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.secondaryButton, resettingPassword && styles.buttonDisabled]}
                      onPress={handleCancelResetPassword}
                      disabled={resettingPassword}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.actionButton, resettingPassword && styles.buttonDisabled]}
                      onPress={handlePerformResetPassword}
                      disabled={resettingPassword}
                    >
                      <Text style={styles.buttonText}>{resettingPassword ? 'Resetting...' : 'Reset'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleDeleteAccount}>
                <Text style={[styles.buttonText, styles.deleteButtonText]}>Delete Account</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.subtitle}>No user loaded.</Text>
        )}

        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12, paddingBottom: 100 },
  headerRow: { position: 'relative', width: '100%' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 16 },
  subtitle: { color: '#c5c5d0' },
  avatarContainer: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderColor: '#1f2738' },
  cameraBadge: { position: 'absolute', bottom: 6, right: 6, backgroundColor: '#2563eb', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 },
  cameraText: { fontSize: 16 },
  netWorthCard: { marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1 },
  netWorthLabel: { color: '#9aa1b5', fontSize: 12, marginBottom: 4, fontWeight: '600' },
  netWorthValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  fieldGroup: { marginBottom: 12 },
  label: { color: '#9aa1b5', marginBottom: 4, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  helperError: { marginTop: 6, color: '#fecaca', fontSize: 12, lineHeight: 16 },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: { marginLeft: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1 },
  eyeText: { color: '#9aa1b5', fontSize: 16, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionButton: { flex: 1 },
  secondaryButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, alignItems: 'center', marginTop: 8 },
  secondaryButtonText: { color: '#e5e7f0', fontWeight: '700' },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700' },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', gap: 10, marginTop: 18 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16 },
  deleteButton: { backgroundColor: '#3b0f0f', borderColor: '#ef4444', borderWidth: 1 },
  deleteButtonText: { color: '#fecaca' },
  spacer: { height: 40 },
});
