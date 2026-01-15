import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { runWithMinimumDuration } from '../utils/timing';

export default function SharedVaults({ navigation, route }) {
  const {
    loading,
    vaults,
    collections,
    assets,
    currentUser,
    refreshData,
    theme,
    vaultMemberships,
    acceptInvitationCode,
    retainVaultCollections,
    releaseVaultCollections,
    retainVaultAssets,
    releaseVaultAssets,
    backendReachable,
    showAlert,
  } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const [inviteCode, setInviteCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);

  const [selectedVaultId, setSelectedVaultId] = useState(route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);

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

  const sortedSharedVaults = useMemo(() => {
    const list = (sharedVaults || []).slice();
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [sharedVaults]);

  useEffect(() => {
    const routeSelected = route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null;
    if (!routeSelected) return;
    setSelectedVaultId(routeSelected);
    setSelectedCollectionId(null);
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
  }, [route?.params?.selectedVaultId]);

  useEffect(() => {
    if (selectedVaultId) return;
    if (!sortedSharedVaults.length) return;
    setSelectedVaultId(String(sortedSharedVaults[0].id));
  }, [selectedVaultId, sortedSharedVaults]);

  useEffect(() => {
    if (!selectedVaultId) return;
    const vId = String(selectedVaultId);
    retainVaultCollections?.(vId);
    retainVaultAssets?.(vId);
    return () => {
      releaseVaultCollections?.(vId);
      releaseVaultAssets?.(vId);
    };
  }, [selectedVaultId, retainVaultCollections, releaseVaultCollections, retainVaultAssets, releaseVaultAssets]);

  const selectedVault = useMemo(
    () => (selectedVaultId ? (sharedVaults || []).find((v) => String(v?.id) === String(selectedVaultId)) : null),
    [sharedVaults, selectedVaultId]
  );

  const vaultCollections = useMemo(() => {
    if (!selectedVaultId) return [];
    const list = (collections || []).filter((c) => String(c?.vaultId) === String(selectedVaultId));
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [collections, selectedVaultId]);

  useEffect(() => {
    if (!selectedVaultId) return;
    const stillValid = vaultCollections.find((c) => String(c?.id) === String(selectedCollectionId));
    if (stillValid) return;
    if (vaultCollections.length) setSelectedCollectionId(String(vaultCollections[0].id));
    else setSelectedCollectionId(null);
  }, [selectedVaultId, vaultCollections, selectedCollectionId]);

  const selectedCollection = useMemo(
    () => (selectedCollectionId ? (collections || []).find((c) => String(c?.id) === String(selectedCollectionId)) : null),
    [collections, selectedCollectionId]
  );

  const collectionAssets = useMemo(() => {
    if (!selectedCollectionId) return [];
    const list = (assets || []).filter((a) => String(a?.collectionId) === String(selectedCollectionId));
    list.sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));
    return list;
  }, [assets, selectedCollectionId]);

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
      setSelectedVaultId(String(res.vaultId));
      setSelectedCollectionId(null);
      setVaultDropdownOpen(false);
      setCollectionDropdownOpen(false);
    }
  };

  const onSelectVault = (vaultId) => {
    const vId = vaultId ? String(vaultId) : null;
    setSelectedVaultId(vId);
    setSelectedCollectionId(null);
    setVaultDropdownOpen(false);
    setCollectionDropdownOpen(false);
  };

  const onSelectCollection = (collectionId) => {
    setSelectedCollectionId(collectionId ? String(collectionId) : null);
    setCollectionDropdownOpen(false);
  };

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
        ) : sortedSharedVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No shared vaults.</Text>
        ) : (
          <>
            <View style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.primary }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Vault</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setVaultDropdownOpen((v) => !v)}
              >
                <Text style={[styles.dropdownButtonText, { color: theme.text }]}>{selectedVault?.name || 'Select vault…'}</Text>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{vaultDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {vaultDropdownOpen && (
                <ScrollView
                  style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  {sortedSharedVaults.map((v) => {
                    const active = selectedVaultId != null && String(v?.id) === String(selectedVaultId);
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                        onPress={() => onSelectVault(v.id)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.dropdownItemText, { color: theme.text }]}>{v.name || v.id}</Text>
                          <Text style={[styles.dropdownItemMeta, { color: theme.textMuted }]}>Vault • {new Date(v.createdAt).toLocaleDateString()}</Text>
                        </View>
                        {active && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            <View style={[styles.card, styles.collectionAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.clone }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Collection</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }, !selectedVaultId && styles.buttonDisabled]}
                onPress={() => selectedVaultId && setCollectionDropdownOpen((v) => !v)}
                disabled={!selectedVaultId}
              >
                <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                  {selectedCollection?.name || (selectedVaultId ? 'Select collection…' : 'Select a vault first…')}
                </Text>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{collectionDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {collectionDropdownOpen && (
                <ScrollView
                  style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  {vaultCollections.length === 0 ? (
                    <Text style={[styles.subtitle, { color: theme.textSecondary, padding: 12 }]}>No collections in this vault.</Text>
                  ) : (
                    vaultCollections.map((c) => {
                      const active = selectedCollectionId != null && String(c?.id) === String(selectedCollectionId);
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.dropdownItem, { borderBottomColor: theme.border }, active && styles.dropdownItemActive]}
                          onPress={() => onSelectCollection(c.id)}
                        >
                          <Text style={[styles.dropdownItemText, { color: theme.text }]}>{c.name || c.id}</Text>
                          {active && <Text style={styles.checkmark}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              )}
            </View>
          </>
        )}

        {selectedVaultId && selectedCollectionId ? (
          <View style={[styles.card, styles.assetAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.success }]}> 
            <View style={styles.cardRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Assets</Text>
              <Text style={[styles.assetCount, { color: theme.textMuted }]}>{collectionAssets.length}</Text>
            </View>

            {collectionAssets.length === 0 ? (
              <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>No assets in this collection.</Text>
            ) : (
              collectionAssets.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.assetRow, { borderBottomColor: theme.border }]}
                  onPress={() => navigation.navigate('Asset', { assetId: a.id, vaultId: selectedVaultId })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assetTitle, { color: theme.text }]}>{a.title || 'Untitled'}</Text>
                    {a.category ? <Text style={[styles.assetMeta, { color: theme.textMuted }]}>{a.category}</Text> : null}
                  </View>
                  <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        ) : null}
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
  vaultAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  collectionAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  assetAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  chevron: { color: '#9aa1b5', fontSize: 20, fontWeight: '700' },

  dropdownButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dropdownButtonText: { fontWeight: '700' },
  dropdownArrow: { fontSize: 12, fontWeight: '700' },
  dropdownList: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    maxHeight: 220,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dropdownItemActive: { opacity: 0.9 },
  dropdownItemText: { fontWeight: '700' },
  dropdownItemMeta: { fontSize: 12, marginTop: 3 },
  checkmark: { color: '#16a34a', fontWeight: '900' },

  assetRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
  },
  assetTitle: { fontSize: 15, fontWeight: '700' },
  assetMeta: { fontSize: 12, marginTop: 3 },
  assetCount: { fontSize: 13, fontWeight: '700' },
});
