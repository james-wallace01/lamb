import React, { useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { runWithMinimumDuration } from '../utils/timing';

export default function SharedVaults({ navigation }) {
  const { loading, vaults, currentUser, refreshData, theme, vaultMemberships, acceptInvitationCode, backendReachable } = useData();
  const isOffline = backendReachable === false;
  const [inviteCode, setInviteCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);

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

  const renderVault = (item) => (
    <TouchableOpacity
      style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={() => navigation.navigate('Vault', { vaultId: item.id })}
    >
      <View style={styles.cardRow}>
        <View>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.isDark ? '#fff' : '#111827'}
            progressViewOffset={24}
          />
        }
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Shared Vaults</Text>
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
              style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 10 }, isOffline && styles.buttonDisabled]}
              onPress={handleAcceptInvite}
              disabled={isOffline}
            >
              <Text style={[styles.secondaryText, { color: theme.textSecondary }]}>Join</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Vaults</Text>
        </View>

        {loading ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Loading…</Text>
        ) : sharedVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No shared vaults.</Text>
        ) : (
          sharedVaults.map((v) => (
            <View key={v.id} style={styles.sectionItem}>
              {renderVault(v)}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  sectionHeader: { marginTop: 8, marginBottom: 8 },
  sectionTitle: { color: '#e5e7f0', fontSize: 18, fontWeight: '700' },
  sectionItem: { marginBottom: 10 },

  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#26344a', backgroundColor: '#1b2535' },
  secondaryText: { color: '#d3dcf2', fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, borderLeftColor: '#2563eb', paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },
});
