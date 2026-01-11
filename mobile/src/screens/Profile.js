import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Image, ScrollView, RefreshControl, Platform, Switch, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import ShareModal from '../components/ShareModal';

const getInitials = (user) => {
  const first = (user?.firstName || '').toString().trim();
  const last = (user?.lastName || '').toString().trim();
  const a = first ? first[0] : '';
  const b = last ? last[0] : '';
  const initials = `${a}${b}`.toUpperCase();
  return initials || '?';
};

export default function Profile() {
  const {
    currentUser,
    updateCurrentUser,
    resetAllData,
    vaults,
    collections,
    assets,
    validatePassword,
    resetPassword,
    deleteAccount,
    refreshData,
    theme,
    isDarkMode,
    setDarkModeEnabled,
    membershipAccess,
    biometricEnabledForCurrentUser,
    enableBiometricSignInForCurrentUser,
    disableBiometricSignIn,
  } = useData();
  const [draft, setDraft] = useState(currentUser || {});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingBiometric, setUpdatingBiometric] = useState(false);
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
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

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
    const patch = {
      firstName: draft.firstName || '',
      lastName: draft.lastName || '',
      email: draft.email || '',
      username: draft.username || '',
    };
    // Only set profileImage when the user explicitly selected one.
    if (draft.profileImage) patch.profileImage = draft.profileImage;
    const result = updateCurrentUser(patch);
    setLoading(false);
    if (!result.ok) {
      Alert.alert(result.message || 'Could not save');
      return;
    }
    Alert.alert('Profile updated');
  };

  const ownedVaultsShared = useMemo(
    () => (vaults || []).filter((v) => v?.ownerId === currentUser?.id && (v.sharedWith || []).length > 0),
    [vaults, currentUser?.id]
  );
  const ownedCollectionsShared = useMemo(
    () => (collections || []).filter((c) => c?.ownerId === currentUser?.id && (c.sharedWith || []).length > 0),
    [collections, currentUser?.id]
  );
  const ownedAssetsShared = useMemo(
    () => (assets || []).filter((a) => a?.ownerId === currentUser?.id && (a.sharedWith || []).length > 0),
    [assets, currentUser?.id]
  );
  const anyShares = ownedVaultsShared.length + ownedCollectionsShared.length + ownedAssetsShared.length > 0;

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

  const handleResetTestData = () => {
    Alert.alert(
      'Clear all local data',
      'This removes all local users, profiles, subscriptions, vaults, and assets from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const res = await resetAllData?.();
            if (!res?.ok) {
              Alert.alert('Could not clear data', res?.message || 'Please try again');
              return;
            }
            Alert.alert('Cleared', 'All local test data has been removed.');
          },
        },
      ]
    );
  };

  return (
    <>
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        showsVerticalScrollIndicator={false}
        bounces
        alwaysBounceVertical
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              if (refreshing) return;
              setRefreshing(true);
              const startedAt = Date.now();
              try {
                await refreshData?.();
              } finally {
                const elapsed = Date.now() - startedAt;
                const minMs = 800;
                if (elapsed < minMs) {
                  await new Promise((r) => setTimeout(r, minMs - elapsed));
                }
                setRefreshing(false);
              }
            }}
            tintColor="#fff"
            progressViewOffset={24}
          />
        }
      >
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Profile</Text>
        {currentUser ? (
          <>
            <View style={styles.avatarContainer}>
              <TouchableOpacity onPress={handleProfilePictureChange} activeOpacity={0.8}>
                {!avatarFailed && (draft.profileImage || currentUser.profileImage) ? (
                  <Image
                    source={{ uri: draft.profileImage || currentUser.profileImage }}
                    style={styles.avatar}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{getInitials(draft)}</Text>
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <Text style={styles.cameraText}>📷</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={[styles.netWorthCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.netWorthLabel, { color: theme.textMuted }]}>Net Worth</Text>
              <Text style={[styles.netWorthValue, { color: theme.text }]}>
                ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textMuted }]}>First Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="First name"
                placeholderTextColor={theme.placeholder}
                value={draft.firstName || ''}
                onChangeText={(v) => setDraft({ ...draft, firstName: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textMuted }]}>Last Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Last name"
                placeholderTextColor={theme.placeholder}
                value={draft.lastName || ''}
                onChangeText={(v) => setDraft({ ...draft, lastName: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textMuted }]}>Username</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Username"
                placeholderTextColor={theme.placeholder}
                autoCapitalize="none"
                value={draft.username || ''}
                onChangeText={(v) => setDraft({ ...draft, username: v })}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.textMuted }]}>Email</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Email"
                placeholderTextColor={theme.placeholder}
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

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Account</Text>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextCol}>
                  <Text style={[styles.toggleTitle, { color: theme.text }]}>Dark Mode</Text>
                  <Text style={[styles.toggleSubtitle, { color: theme.textMuted }]}>Default is on. Turn off for a light theme.</Text>
                </View>
                <Switch
                  value={!!isDarkMode}
                  onValueChange={(next) => {
                    const res = setDarkModeEnabled?.(next);
                    if (!res?.ok) Alert.alert('Dark Mode', res?.message || 'Could not update theme');
                  }}
                />
              </View>

              {Platform.OS === 'ios' && (
                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextCol}>
                    <Text style={[styles.toggleTitle, { color: theme.text }]}>Face ID Sign In</Text>
                    <Text style={[styles.toggleSubtitle, { color: theme.textMuted }]}>Use Face ID to sign in on this device.</Text>
                  </View>
                  <Switch
                    value={!!biometricEnabledForCurrentUser}
                    onValueChange={async (next) => {
                      if (updatingBiometric) return;
                      setUpdatingBiometric(true);
                      try {
                        if (next) {
                          const res = await enableBiometricSignInForCurrentUser?.();
                          if (!res?.ok) {
                            Alert.alert('Face ID', res?.message || 'Could not enable Face ID');
                          }
                        } else {
                          const res = await disableBiometricSignIn?.();
                          if (!res?.ok) {
                            Alert.alert('Face ID', res?.message || 'Could not disable Face ID');
                          }
                        }
                      } finally {
                        setUpdatingBiometric(false);
                      }
                    }}
                    disabled={updatingBiometric}
                  />
                </View>
              )}

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

              <TouchableOpacity style={[styles.button, styles.deleteButton]} onPress={handleResetTestData}>
                <Text style={[styles.buttonText, styles.deleteButtonText]}>Clear All Local Test Data</Text>
              </TouchableOpacity>
            </View>

            {!membershipAccess && (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Membership required</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Only Profile and Membership are available until you renew.</Text>
              </View>
            )}

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Sharing</Text>
              {!anyShares ? (
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>You haven’t shared anything.</Text>
              ) : (
                <>
                  {!membershipAccess && (
                    <Text style={[styles.subtitle, { color: theme.textSecondary }]}>You can revoke access to items you previously shared.</Text>
                  )}
                  {ownedVaultsShared.map((v) => (
                    <TouchableOpacity
                      key={`vault-${v.id}`}
                      style={[styles.shareRow, { borderTopColor: theme.border }]}
                      onPress={() => setShareTarget({ targetType: 'vault', targetId: v.id })}
                    >
                      <Text style={[styles.shareRowTitle, { color: theme.text }]}>{v.name || 'Vault'}</Text>
                      <Text style={[styles.shareRowMeta, { color: theme.textMuted }]}>Vault • {(v.sharedWith || []).length} shared</Text>
                    </TouchableOpacity>
                  ))}
                  {ownedCollectionsShared.map((c) => (
                    <TouchableOpacity
                      key={`collection-${c.id}`}
                      style={[styles.shareRow, { borderTopColor: theme.border }]}
                      onPress={() => setShareTarget({ targetType: 'collection', targetId: c.id })}
                    >
                      <Text style={[styles.shareRowTitle, { color: theme.text }]}>{c.name || 'Collection'}</Text>
                      <Text style={[styles.shareRowMeta, { color: theme.textMuted }]}>Collection • {(c.sharedWith || []).length} shared</Text>
                    </TouchableOpacity>
                  ))}
                  {ownedAssetsShared.map((a) => (
                    <TouchableOpacity
                      key={`asset-${a.id}`}
                      style={[styles.shareRow, { borderTopColor: theme.border }]}
                      onPress={() => setShareTarget({ targetType: 'asset', targetId: a.id })}
                    >
                      <Text style={[styles.shareRowTitle, { color: theme.text }]}>{a.title || 'Asset'}</Text>
                      <Text style={[styles.shareRowMeta, { color: theme.textMuted }]}>Asset • {(a.sharedWith || []).length} shared</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Legal</Text>
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
          </>
        ) : (
          <Text style={styles.subtitle}>No user loaded.</Text>
        )}

        <View style={styles.spacer} />
      </ScrollView>
    </View>
    <ShareModal
      visible={!!shareTarget}
      onClose={() => setShareTarget(null)}
      targetType={shareTarget?.targetType}
      targetId={shareTarget?.targetId}
    />
    </>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  toggleTextCol: { flex: 1, paddingRight: 12 },
  toggleTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 14 },
  toggleSubtitle: { color: '#9aa1b5', fontSize: 12, marginTop: 2, lineHeight: 16 },
  deleteButton: { backgroundColor: '#3b0f0f', borderColor: '#ef4444', borderWidth: 1 },
  deleteButtonText: { color: '#fecaca' },
  shareRow: { paddingVertical: 10, borderTopWidth: 1 },
  shareRowTitle: { fontWeight: '700' },
  shareRowMeta: { marginTop: 2, fontSize: 12 },
  legalRow: { paddingVertical: 6 },
  legalLink: { color: '#9ab6ff', fontWeight: '600' },
  spacer: { height: 40 },
});
