import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { firestore } from '../firebase';
import { getCollectionCapabilities, getVaultCapabilities } from '../policies/capabilities';
import { runWithMinimumDuration } from '../utils/timing';

export default function PrivateVaults({ navigation, route }) {
  const {
    loading,
    vaults,
    collections,
    assets,
    currentUser,
    addVault,
    addCollection,
    deleteVault,
    deleteCollection,
    getRoleForVault,
    canCreateCollectionsInVault,
    getRoleForCollection,
    canCreateAssetsInCollection,
    refreshData,
    theme,
    vaultMemberships,
    retainVaultCollections,
    releaseVaultCollections,
    retainVaultAssets,
    releaseVaultAssets,
    backendReachable,
    showAlert,
  } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const [newVaultName, setNewVaultName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);
  const [remoteOwnedVaults, setRemoteOwnedVaults] = useState([]);

  const [selectedVaultId, setSelectedVaultId] = useState(route?.params?.selectedVaultId ? String(route.params.selectedVaultId) : null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState(false);

  const limit35 = (value = '') => String(value).slice(0, 35);

  const uid = currentUser?.id ? String(currentUser.id) : null;

  const normalizeVaultDoc = ({ docId, data }) => {
    const raw = data || {};
    const id = String(docId);
    return {
      ...raw,
      id,
      ownerId: raw.activeOwnerId || raw.ownerId || null,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : (raw.createdAt?.toMillis ? raw.createdAt.toMillis() : raw.createdAt) || Date.now(),
    };
  };

  const loadOwnedVaults = async () => {
    if (!uid) return;
    if (!firestore) return;

    try {
      const ownedByOwnerIdQuery = query(collection(firestore, 'vaults'), where('ownerId', '==', uid));
      const ownedByActiveOwnerQuery = query(collection(firestore, 'vaults'), where('activeOwnerId', '==', uid));
      const [snapOwner, snapActive] = await Promise.all([getDocs(ownedByOwnerIdQuery), getDocs(ownedByActiveOwnerQuery)]);
      const combined = [...snapOwner.docs, ...snapActive.docs]
        .map((d) => normalizeVaultDoc({ docId: d.id, data: d.data() }))
        .filter(Boolean);

      const seen = new Set();
      const deduped = [];
      for (const v of combined) {
        const id = v?.id ? String(v.id) : null;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduped.push(v);
      }
      setRemoteOwnedVaults(deduped);
    } catch {
      // ignore; realtime listeners are preferred
    }
  };

  useEffect(() => {
    loadOwnedVaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const myVaults = useMemo(() => {
    if (!uid) return [];
    const combined = [...(vaults || []), ...(remoteOwnedVaults || [])];
    const owned = combined.filter((v) => v?.ownerId != null && String(v.ownerId) === uid);

    const seen = new Set();
    const deduped = [];
    for (const v of owned) {
      const id = v?.id ? String(v.id) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      deduped.push(v);
    }
    return deduped;
  }, [vaults, remoteOwnedVaults, uid]);

  const sortedMyVaults = useMemo(() => {
    const list = (myVaults || []).slice();
    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [myVaults]);

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
    if (!sortedMyVaults.length) return;
    setSelectedVaultId(String(sortedMyVaults[0].id));
  }, [selectedVaultId, sortedMyVaults]);

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
    () => (selectedVaultId ? (myVaults || []).find((v) => String(v?.id) === String(selectedVaultId)) : null),
    [myVaults, selectedVaultId]
  );

  const vaultCaps = useMemo(() => {
    if (!selectedVaultId || !currentUser?.id) return getVaultCapabilities({ role: null, canCreateCollections: false });
    const role = getRoleForVault?.(String(selectedVaultId), String(currentUser.id));
    const canCreateCollections = canCreateCollectionsInVault?.(String(selectedVaultId), String(currentUser.id));
    return getVaultCapabilities({ role, canCreateCollections });
  }, [selectedVaultId, currentUser?.id, getRoleForVault, canCreateCollectionsInVault]);

  const canVaultEditOnline = vaultCaps.canEdit && !isOffline;
  const canVaultShareOnline = vaultCaps.canShare && !isOffline;
  const canVaultCloneOnline = vaultCaps.canClone && !isOffline;
  const canVaultDeleteOnline = vaultCaps.canDelete && !isOffline;

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

  const collectionCaps = useMemo(() => {
    if (!selectedCollectionId || !currentUser?.id) return getCollectionCapabilities({ role: null, canCreateAssets: false });
    const role = getRoleForCollection?.(String(selectedCollectionId), String(currentUser.id));
    const canCreateAssets = canCreateAssetsInCollection?.(String(selectedCollectionId), String(currentUser.id));
    return getCollectionCapabilities({ role, canCreateAssets });
  }, [selectedCollectionId, currentUser?.id, getRoleForCollection, canCreateAssetsInCollection]);

  const canCollectionEditOnline = collectionCaps.canEdit && !isOffline;
  const canCollectionShareOnline = collectionCaps.canShare && !isOffline;
  const canCollectionMoveOnline = collectionCaps.canMove && !isOffline;
  const canCollectionCloneOnline = collectionCaps.canClone && !isOffline;
  const canCollectionDeleteOnline = collectionCaps.canDelete && !isOffline;

  const collectionAssets = useMemo(() => {
    if (!selectedCollectionId) return [];
    const list = (assets || []).filter((a) => String(a?.collectionId) === String(selectedCollectionId));
    list.sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));
    return list;
  }, [assets, selectedCollectionId]);

  const getDelegateCountForVault = (vaultId) => {
    const vId = String(vaultId);
    return (vaultMemberships || []).filter((m) => m?.vault_id === vId && m?.status === 'ACTIVE' && m?.role === 'DELEGATE').length;
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await loadOwnedVaults();
        await refreshData?.();
      }, 800);
    } finally {
      setRefreshing(false);
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
          <Text style={[styles.title, { color: theme.text }]}>Private Vaults</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Create a vault</Text>
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
            style={[styles.addButton, isOffline && styles.buttonDisabled]}
            disabled={isOffline}
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

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>My Vaults</Text>
        </View>

        {loading ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Loading…</Text>
        ) : sortedMyVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No vaults yet.</Text>
        ) : (
          <>
            <View style={[styles.card, styles.vaultAccent, { backgroundColor: theme.surface, borderColor: theme.border, borderLeftColor: theme.primary }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Vault</Text>
              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setVaultDropdownOpen((v) => !v)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dropdownButtonText, { color: theme.text }]}>{selectedVault?.name || 'Select vault…'}</Text>
                  {selectedVaultId ? (
                    <Text style={[styles.cardSubtitle, { color: theme.textMuted, marginTop: 4 }]}>Delegates: {getDelegateCountForVault(selectedVaultId)}</Text>
                  ) : null}
                </View>
                <Text style={[styles.dropdownArrow, { color: theme.textMuted }]}>{vaultDropdownOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {vaultDropdownOpen && (
                <ScrollView
                  style={[styles.dropdownList, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  {sortedMyVaults.map((v) => {
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

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultEditOnline) && styles.buttonDisabled]}
                  disabled={!selectedVaultId || !canVaultEditOnline}
                  onPress={() => navigation.navigate('Vault', { vaultId: selectedVaultId, openEdit: true })}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultShareOnline) && styles.buttonDisabled]}
                  disabled={!selectedVaultId || !canVaultShareOnline}
                  onPress={() => navigation.navigate('Vault', { vaultId: selectedVaultId, openShare: true, shareTargetType: 'vault', shareTargetId: selectedVaultId })}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedVaultId || !canVaultCloneOnline) && styles.buttonDisabled]}
                  disabled={!selectedVaultId || !canVaultCloneOnline}
                  onPress={() => {
                    if (!selectedVault) return;
                    const baseName = selectedVault?.name ? String(selectedVault.name) : 'Vault';
                    const copyName = limit35(`${baseName} (Copy)`);
                    (async () => {
                      const res = await addVault({
                        name: copyName,
                        images: Array.isArray(selectedVault?.images) ? selectedVault.images : [],
                        heroImage: selectedVault?.heroImage || null,
                      });
                      if (!res || res.ok === false) {
                        Alert.alert('Clone failed', res?.message || 'Unable to clone vault');
                        return;
                      }
                      if (res.vaultId) {
                        onSelectVault(String(res.vaultId));
                      }
                    })();
                  }}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Clone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder }, (!selectedVaultId || !canVaultDeleteOnline) && styles.buttonDisabled]}
                  disabled={!selectedVaultId || !canVaultDeleteOnline}
                  onPress={() => {
                    if (!selectedVaultId) return;
                    Alert.alert('Delete Vault?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          (async () => {
                            const res = await deleteVault?.(String(selectedVaultId));
                            if (!res || res.ok === false) {
                              Alert.alert('Delete failed', res?.message || 'Unable to delete vault');
                              return;
                            }
                            setSelectedVaultId(null);
                            setSelectedCollectionId(null);
                            setVaultDropdownOpen(false);
                            setCollectionDropdownOpen(false);
                            await refreshData?.();
                          })();
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={[styles.actionButtonText, { color: theme.dangerText }]}>Delete</Text>
                </TouchableOpacity>
              </View>
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

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionEditOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionEditOnline}
                  onPress={() => navigation.navigate('Collection', { collectionId: selectedCollectionId, openEdit: true })}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionShareOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionShareOnline}
                  onPress={() => navigation.navigate('Collection', { collectionId: selectedCollectionId, openShare: true, shareTargetType: 'collection', shareTargetId: selectedCollectionId })}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Delegate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionMoveOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionMoveOnline}
                  onPress={() => navigation.navigate('Collection', { collectionId: selectedCollectionId, openMove: true })}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Move</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, (!selectedCollectionId || !canCollectionCloneOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionCloneOnline}
                  onPress={() => {
                    if (!selectedVaultId || !selectedCollection) return;
                    const baseName = selectedCollection?.name ? String(selectedCollection.name) : 'Collection';
                    const copyName = limit35(`${baseName} (Copy)`);
                    (async () => {
                      const res = await addCollection?.({
                        vaultId: String(selectedVaultId),
                        name: copyName,
                        images: Array.isArray(selectedCollection?.images) ? selectedCollection.images : [],
                        heroImage: selectedCollection?.heroImage || null,
                      });
                      if (!res || res.ok === false) {
                        Alert.alert('Clone failed', res?.message || 'Unable to clone collection');
                        return;
                      }
                      if (res.collectionId) {
                        onSelectCollection(String(res.collectionId));
                      }
                    })();
                  }}
                >
                  <Text style={[styles.actionButtonText, { color: theme.text }]}>Clone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBorder }, (!selectedCollectionId || !canCollectionDeleteOnline) && styles.buttonDisabled]}
                  disabled={!selectedCollectionId || !canCollectionDeleteOnline}
                  onPress={() => {
                    if (!selectedCollectionId) return;
                    Alert.alert('Delete Collection?', 'This action cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          (async () => {
                            const res = await deleteCollection?.(String(selectedCollectionId));
                            if (!res || res.ok === false) {
                              Alert.alert('Delete failed', res?.message || 'Unable to delete collection');
                              return;
                            }
                            setSelectedCollectionId(null);
                            setCollectionDropdownOpen(false);
                            await refreshData?.();
                          })();
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={[styles.actionButtonText, { color: theme.dangerText }]}>Delete</Text>
                </TouchableOpacity>
              </View>
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

  createRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 10, color: '#fff' },
  addButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16a34a' },
  addButtonText: { color: '#fff', fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  vaultAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  collectionAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  assetAccent: { borderLeftWidth: 4, paddingLeft: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  actionButtonText: { fontWeight: '700', fontSize: 13 },
  dangerButton: { borderWidth: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
  sharedDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#0f172a' },
  sharedDotOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  sharedDotOff: { backgroundColor: '#475569', borderColor: '#475569' },
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
