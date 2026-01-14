import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, Alert, Image, RefreshControl } from 'react-native';
import { useData } from '../context/DataContext';
import ShareModal from '../components/ShareModal';
import LambHeader from '../components/LambHeader';
import { getInitials } from '../utils/user';
import { runWithMinimumDuration } from '../utils/timing';

export default function Home({ navigation }) {
  const { loading, vaults, currentUser, addVault, logout, refreshData, theme, membershipAccess, vaultMemberships, acceptInvitationCode } = useData();
  const [newVaultName, setNewVaultName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const limit35 = (value = '') => String(value).slice(0, 35);
  const [shareVaultId, setShareVaultId] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const scrollRef = useRef(null);
  const [mySectionY, setMySectionY] = useState(0);
  const [sharedSectionY, setSharedSectionY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await refreshData?.();
      }, 800);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAcceptInvite = async () => {
    const code = inviteCode.trim();
    if (!code) {
      Alert.alert('Invite code', 'Enter an invite code to join a vault.');
      return;
    }
    const res = await acceptInvitationCode?.(code);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to accept invite');
      return;
    }
    setInviteCode('');
    Alert.alert('Joined', 'You now have access to the shared vault.');
    if (res.vaultId) {
      navigation.navigate('Vault', { vaultId: res.vaultId });
    }
  };

  if (!membershipAccess) {
    return (
      <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
        <ScrollView
          contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
          bounces
          alwaysBounceVertical
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
        >
          <LambHeader />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: theme.text }]}>Home</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
                {!avatarFailed && currentUser?.profileImage ? (
                  <Image source={{ uri: currentUser.profileImage }} style={styles.avatar} onError={() => setAvatarFailed(true)} />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: theme.primary,
                        borderColor: theme.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                      },
                    ]}
                  >
                    <Text style={[styles.avatarFallbackText, { color: '#fff' }]}>{getInitials(currentUser)}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]} onPress={logout}>
                <Text style={[styles.secondaryText, { color: theme.textSecondary }]}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Join a Vault</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Have an invite code? Paste it here to join as a delegate.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Invite Code"
                placeholderTextColor={theme.placeholder}
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text, flex: 1 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 10 }]}
                onPress={handleAcceptInvite}
              >
                <Text style={[styles.secondaryText, { color: theme.textSecondary }]}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Membership Required</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your membership isn’t active. You can manage your membership, update your profile, and revoke sharing.</Text>

            {!currentUser?.subscription?.tier ? (
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  {
                    borderColor: theme.primary,
                    backgroundColor: theme.primary,
                    alignSelf: 'flex-start',
                    marginTop: 10,
                  },
                ]}
                onPress={() => navigation.navigate('ChooseSubscription', { mode: 'upgrade' })}
              >
                <Text style={[styles.secondaryText, { color: '#fff' }]}>Choose Membership</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.quickRow}>
            <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => navigation.navigate('Membership')}>
              <Text style={[styles.quickTitle, { color: theme.text }]}>Membership</Text>
              <Text style={[styles.quickMeta, { color: theme.textMuted }]}>Renew or manage</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => navigation.navigate('Profile')}>
              <Text style={[styles.quickTitle, { color: theme.text }]}>Profile</Text>
              <Text style={[styles.quickMeta, { color: theme.textMuted }]}>Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  const myVaults = useMemo(() => vaults.filter((v) => v.ownerId === currentUser?.id), [vaults, currentUser]);
  const sharedVaults = useMemo(() => {
    const uid = currentUser?.id ? String(currentUser.id) : null;
    if (!uid) return [];
    const activeVaultIds = new Set(
      (vaultMemberships || [])
        .filter((m) => m?.user_id === uid && m?.status === 'ACTIVE')
        .map((m) => String(m.vault_id))
    );
    return vaults.filter((v) => v?.ownerId !== uid && activeVaultIds.has(String(v.id)));
  }, [vaults, currentUser, vaultMemberships]);

  const getDelegateCountForVault = (vaultId) => {
    const vId = String(vaultId);
    return (vaultMemberships || []).filter((m) => m?.vault_id === vId && m?.status === 'ACTIVE' && m?.role === 'DELEGATE').length;
  };

  const renderVault = (item) => (
    <TouchableOpacity
      style={[
        styles.card,
        styles.vaultAccent,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      onPress={() => navigation.navigate('Vault', { vaultId: item.id })}
    >
      <View style={styles.cardRow}>
        <View>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
            <View
              style={[
                styles.sharedDot,
                item?.ownerId === currentUser?.id && getDelegateCountForVault(item.id) > 0 ? styles.sharedDotOn : styles.sharedDotOff,
              ]}
            />
          </View>
          <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>Vault • {new Date(item.createdAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.cardActions}>
          <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        bounces
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Home</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
              {!avatarFailed && currentUser?.profileImage ? (
                <Image source={{ uri: currentUser.profileImage }} style={styles.avatar} onError={() => setAvatarFailed(true)} />
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
                  <Text style={[styles.avatarFallbackText, { color: '#fff' }]}>{getInitials(currentUser)}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]} onPress={logout}>
              <Text style={[styles.secondaryText, { color: theme.textSecondary }]}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Join a vault</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Have an invite code? Paste it here to join as a delegate.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <TextInput
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="Invite code"
              placeholderTextColor={theme.placeholder}
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text, flex: 1 }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 10 }]}
              onPress={handleAcceptInvite}
            >
              <Text style={[styles.secondaryText, { color: theme.textSecondary }]}>Join</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.quickRow}>
          <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => scrollRef.current?.scrollTo({ y: mySectionY, animated: true })}>
            <Text style={[styles.quickTitle, { color: theme.text }]}>My Vaults</Text>
            <Text style={[styles.quickMeta, { color: theme.textMuted }]}>{myVaults.length} total</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => scrollRef.current?.scrollTo({ y: sharedSectionY, animated: true })}>
            <Text style={[styles.quickTitle, { color: theme.text }]}>Shared Vaults</Text>
            <Text style={[styles.quickMeta, { color: theme.textMuted }]}>{sharedVaults.length} total</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => navigation.navigate('Membership')}>
            <Text style={[styles.quickTitle, { color: theme.text }]}>Membership</Text>
            <Text style={[styles.quickMeta, { color: theme.textMuted }]}>Membership</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => navigation.navigate('Profile')}>
            <Text style={[styles.quickTitle, { color: theme.text }]}>Profile</Text>
            <Text style={[styles.quickMeta, { color: theme.textMuted }]}>Account</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Loading…</Text>
        ) : (
          <>
            <View onLayout={(e) => setMySectionY(e.nativeEvent.layout.y)}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>My Vaults</Text>
              </View>
              <View style={styles.createRow}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                  placeholder="New vault name"
                  placeholderTextColor={theme.placeholder}
                  value={newVaultName}
                  onChangeText={(text) => setNewVaultName(limit35(text || ''))}
                />
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => {
                    if (!newVaultName.trim()) return;
                    (async () => {
                      const res = await addVault({ name: newVaultName.trim() });
                      if (!res || res.ok === false) {
                        Alert.alert('Create vault failed', res?.message || 'Unable to create vault');
                        return;
                      }
                      setNewVaultName('');
                    })();
                  }}
                >
                  <Text style={styles.addButtonText}>Add</Text>
                </TouchableOpacity>
              </View>
              {myVaults.length === 0 ? (
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No vaults yet.</Text>
              ) : (
                myVaults.map((v) => (
                  <View key={v.id} style={styles.sectionItem}>
                    {renderVault(v)}
                  </View>
                ))
              )}
            </View>

            <View onLayout={(e) => setSharedSectionY(e.nativeEvent.layout.y)}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Vaults</Text>
              </View>
              {sharedVaults.length === 0 ? (
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No shared vaults.</Text>
              ) : (
                sharedVaults.map((v) => (
                  <View key={v.id} style={styles.sectionItem}>
                    {renderVault(v)}
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      <ShareModal visible={!!shareVaultId} onClose={() => setShareVaultId(null)} targetType="vault" targetId={shareVaultId} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2738' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#9aa1b5', fontWeight: '700' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  quickCard: { flexBasis: '48%', padding: 12, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738', gap: 4 },
  quickTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16 },
  quickMeta: { color: '#9aa1b5', fontSize: 12 },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, borderLeftColor: '#2563eb', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
  separator: { height: 12 },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#26344a', backgroundColor: '#1b2535' },
  secondaryText: { color: '#d3dcf2', fontWeight: '700' },
  sharePill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#16a34a' },
  sharePillText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  scrollGap: { gap: 16 },
  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },
  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
});
