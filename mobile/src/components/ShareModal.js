import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, FlatList, ScrollView } from 'react-native';
import { useData } from '../context/DataContext';

export default function ShareModal({ visible, onClose, targetType, targetId }) {
  const {
    users,
    currentUser,
    shareVault,
    shareCollection,
    shareAsset,
    updateVaultShare,
    updateCollectionShare,
    updateAssetShare,
    removeVaultShare,
    removeCollectionShare,
    removeAssetShare,
    vaults,
    collections,
    assets,
  } = useData();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('Reviewer');
  const [canCreateCollections, setCanCreateCollections] = useState(false);
  const [canCreateAssets, setCanCreateAssets] = useState(false);

  const alreadySharedIds = useMemo(() => {
    if (targetType === 'vault') {
      return (vaults.find(v => v.id === targetId)?.sharedWith || []).map(s => s.userId);
    }
    if (targetType === 'collection') {
      return (collections.find(c => c.id === targetId)?.sharedWith || []).map(s => s.userId);
    }
    if (targetType === 'asset') {
      return (assets.find(a => a.id === targetId)?.sharedWith || []).map(s => s.userId);
    }
    return [];
  }, [targetType, targetId, vaults, collections, assets]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users.filter(u => {
      if (u.id === currentUser?.id) return false;
      if (alreadySharedIds.includes(u.id)) return false;
      const full = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      return (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || full.includes(q);
    }).slice(0, 6);
  }, [users, query, currentUser, alreadySharedIds]);

  const existingShares = useMemo(() => {
    if (targetType === 'vault') {
      return (vaults.find(v => v.id === targetId)?.sharedWith || []).map(s => ({ ...s, user: users.find(u => u.id === s.userId) }));
    }
    if (targetType === 'collection') {
      return (collections.find(c => c.id === targetId)?.sharedWith || []).map(s => ({ ...s, user: users.find(u => u.id === s.userId) }));
    }
    if (targetType === 'asset') {
      return (assets.find(a => a.id === targetId)?.sharedWith || []).map(s => ({ ...s, user: users.find(u => u.id === s.userId) }));
    }
    return [];
  }, [targetType, targetId, vaults, collections, assets, users]);

  const handleShare = (userId) => {
    if (targetType === 'vault') shareVault({ vaultId: targetId, userId, role, canCreateCollections });
    if (targetType === 'collection') shareCollection({ collectionId: targetId, userId, role, canCreateAssets });
    if (targetType === 'asset') shareAsset({ assetId: targetId, userId, role });
    setQuery('');
    setCanCreateCollections(false);
    setCanCreateAssets(false);
  };

  const handleUpdate = (userId, nextRole, nextFlag) => {
    if (targetType === 'vault') updateVaultShare({ vaultId: targetId, userId, role: nextRole, canCreateCollections: nextFlag });
    if (targetType === 'collection') updateCollectionShare({ collectionId: targetId, userId, role: nextRole, canCreateAssets: nextFlag });
    if (targetType === 'asset') updateAssetShare({ assetId: targetId, userId, role: nextRole });
  };

  const handleRemove = (userId) => {
    if (targetType === 'vault') removeVaultShare({ vaultId: targetId, userId });
    if (targetType === 'collection') removeCollectionShare({ collectionId: targetId, userId });
    if (targetType === 'asset') removeAssetShare({ assetId: targetId, userId });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>Share {targetType}</Text>
            <Text style={styles.label}>User</Text>
            <TextInput
              style={styles.input}
              placeholder="Username or email"
              placeholderTextColor="#80869b"
              value={query}
              onChangeText={setQuery}
            />
            {suggestions.length > 0 && (
              <FlatList
                data={suggestions}
                keyExtractor={(u) => u.id}
                style={styles.suggestions}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.suggestionRow} onPress={() => handleShare(item.id)}>
                    <View>
                      <Text style={styles.suggestionName}>{item.username}</Text>
                      <Text style={styles.suggestionMeta}>{item.email || `${item.firstName || ''} ${item.lastName || ''}`}</Text>
                    </View>
                    <Text style={styles.addText}>Add</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <View style={styles.divider} />
            <Text style={styles.label}>Role</Text>
            <View style={styles.roleRow}>
              {['Reviewer', 'Editor', 'Manager'].map((r) => (
                <TouchableOpacity key={r} style={[styles.roleChip, role === r && styles.roleChipActive]} onPress={() => setRole(r)}>
                  <Text style={styles.roleText}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
              {targetType === 'vault' && (
                <TouchableOpacity style={[styles.toggle, canCreateCollections && styles.toggleActive]} onPress={() => setCanCreateCollections((prev) => !prev)}>
                  <Text style={styles.toggleText}>Allow creating collections</Text>
                  <Text style={styles.toggleBadge}>{canCreateCollections ? 'On' : 'Off'}</Text>
                </TouchableOpacity>
              )}
              {targetType === 'collection' && (
                <TouchableOpacity style={[styles.toggle, canCreateAssets && styles.toggleActive]} onPress={() => setCanCreateAssets((prev) => !prev)}>
                  <Text style={styles.toggleText}>Allow creating assets</Text>
                  <Text style={styles.toggleBadge}>{canCreateAssets ? 'On' : 'Off'}</Text>
                </TouchableOpacity>
              )}
              {existingShares.length > 0 && (
                <View style={styles.sharedBox}>
                  <Text style={styles.sharedLabel}>Currently shared</Text>
                <ScrollView style={styles.sharedList} showsVerticalScrollIndicator={false}>
                  {existingShares.map((s, idx) => (
                    <View key={s.userId}>
                      <View style={styles.sharedRow}>
                        <View style={styles.sharedInfo}>
                          <Text style={styles.sharedName}>{s.user?.username || s.userId}</Text>
                          <Text style={styles.sharedMeta}>{s.user?.email || ''}</Text>
                        </View>
                        <View style={styles.sharedActions}>
                          <View style={styles.roleRow}>
                            {['Reviewer', 'Editor', 'Manager'].map((r) => (
                              <TouchableOpacity key={r} style={[styles.roleChipSmall, s.role === r && styles.roleChipActive]} onPress={() => handleUpdate(s.userId, r, targetType === 'vault' ? s.canCreateCollections : targetType === 'collection' ? s.canCreateAssets : undefined)}>
                                <Text style={styles.roleText}>{r}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          {targetType === 'vault' && (
                            <TouchableOpacity style={[styles.toggle, s.canCreateCollections && styles.toggleActive]} onPress={() => handleUpdate(s.userId, s.role, !s.canCreateCollections)}>
                              <Text style={styles.toggleText}>Can create collections</Text>
                              <Text style={styles.toggleBadge}>{s.canCreateCollections ? 'On' : 'Off'}</Text>
                            </TouchableOpacity>
                          )}
                          {targetType === 'collection' && (
                            <TouchableOpacity style={[styles.toggle, s.canCreateAssets && styles.toggleActive]} onPress={() => handleUpdate(s.userId, s.role, !s.canCreateAssets)}>
                              <Text style={styles.toggleText}>Can create assets</Text>
                              <Text style={styles.toggleBadge}>{s.canCreateAssets ? 'On' : 'Off'}</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(s.userId)}>
                            <Text style={styles.removeText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {idx < existingShares.length - 1 && <View style={styles.sharedDivider} />}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondary} onPress={onClose}>
              <Text style={styles.secondaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: '#0f111a', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1f2738', maxHeight: '80%' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  label: { color: '#9aa1b5', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  suggestions: { marginTop: 8, maxHeight: 180, borderWidth: 1, borderColor: '#1f2738', borderRadius: 10 },
  suggestionRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#1f2738', flexDirection: 'row', justifyContent: 'space-between' },
  suggestionName: { color: '#fff', fontWeight: '700' },
  suggestionMeta: { color: '#9aa1b5', fontSize: 12 },
  addText: { color: '#9ab6ff', fontWeight: '700' },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a' },
  roleChipActive: { borderColor: '#2563eb', backgroundColor: '#172447' },
  roleChipSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a' },
  roleText: { color: '#e5e7f0', fontWeight: '700' },
  actions: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
  secondary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#26344a' },
  secondaryText: { color: '#e5e7f0', fontWeight: '700' },
  toggle: { marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleActive: { borderColor: '#2563eb', backgroundColor: '#172447' },
  toggleText: { color: '#e5e7f0', fontWeight: '600' },
  toggleBadge: { color: '#9aa1b5', fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#1f2738', marginVertical: 12 },
  sharedBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#0f111a' },
  sharedLabel: { color: '#e5e7f0', fontWeight: '800', marginBottom: 8 },
  sharedList: { maxHeight: 250 },
  sharedRow: { flexDirection: 'column', gap: 8, paddingVertical: 10, paddingHorizontal: 10, marginHorizontal: -2, borderRadius: 8, backgroundColor: '#11121a' },
  sharedDivider: { height: 1, backgroundColor: '#1f2738', marginVertical: 8 },
  sharedInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sharedName: { color: '#fff', fontWeight: '700' },
  sharedMeta: { color: '#9aa1b5', fontSize: 12 },
  sharedActions: { gap: 6 },
  removeBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#44282c', backgroundColor: '#2a171b', alignSelf: 'flex-start' },
  removeText: { color: '#fca5a5', fontWeight: '700' },
});
