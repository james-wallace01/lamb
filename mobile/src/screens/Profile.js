import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, Image, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

const DEFAULT_AVATAR = 'https://via.placeholder.com/112?text=Profile';

export default function Profile() {
  const { currentUser, updateCurrentUser, assets } = useData();
  const [draft, setDraft] = useState(currentUser || {});
  const [loading, setLoading] = useState(false);

  const netWorth = useMemo(() => {
    if (!currentUser) return 0;
    const ownedAssets = assets.filter((a) => a.ownerId === currentUser.id);
    return ownedAssets.reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0);
  }, [assets, currentUser]);

  useEffect(() => {
    setDraft(currentUser || {});
  }, [currentUser]);

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

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <LambHeader />
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
        </>
      ) : (
        <Text style={styles.subtitle}>No user loaded.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
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
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb', alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
