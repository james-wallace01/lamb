import React, { useMemo, useState } from 'react';
import { Alert, Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useData } from '../context/DataContext';

const ROLE_OPTIONS = [
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
];

const ROLE_HELP = {
  reviewer: 'View access.',
  editor: 'View and Edit access.',
  manager: 'View, Edit, Move and Clone access.',
  owner: 'View, Edit, Move, Clone and Delete access.',
};

const normalizeRole = (role) => {
  if (!role) return null;
  const raw = role.toString().trim().toLowerCase();
  if (raw === 'viewer' || raw === 'reviewer') return 'reviewer';
  if (raw === 'editor') return 'editor';
  if (raw === 'manager') return 'manager';
  if (raw === 'owner') return 'owner';
  return raw;
};

const roleLabel = (role) => {
  const normalized = normalizeRole(role);
  return ROLE_OPTIONS.find((r) => r.value === normalized)?.label || 'Reviewer';
};

export default function ShareModal({ visible, onClose, targetType, targetId }) {
  const {
    users,
    currentUser,
    theme,
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
  const [role, setRole] = useState('reviewer');
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
    const normalizedRole = normalizeRole(role) || 'reviewer';

    const res =
      targetType === 'vault'
        ? shareVault({ vaultId: targetId, userId, role: normalizedRole, canCreateCollections })
        : targetType === 'collection'
          ? shareCollection({ collectionId: targetId, userId, role: normalizedRole, canCreateAssets })
          : targetType === 'asset'
            ? shareAsset({ assetId: targetId, userId, role: normalizedRole })
            : null;

    if (res && res.ok === false) {
      Alert.alert('Not allowed', res.message || 'You do not have permission to share this item.');
      return;
    }

    setQuery('');
    setCanCreateCollections(false);
    setCanCreateAssets(false);
  };

  const handleUpdate = (userId, nextRole, nextFlag) => {
    const normalizedRole = normalizeRole(nextRole) || 'reviewer';

    const res =
      targetType === 'vault'
        ? updateVaultShare({ vaultId: targetId, userId, role: normalizedRole, canCreateCollections: nextFlag })
        : targetType === 'collection'
          ? updateCollectionShare({ collectionId: targetId, userId, role: normalizedRole, canCreateAssets: nextFlag })
          : targetType === 'asset'
            ? updateAssetShare({ assetId: targetId, userId, role: normalizedRole })
            : null;

    if (res && res.ok === false) {
      Alert.alert('Not allowed', res.message || 'You do not have permission to update sharing on this item.');
    }
  };

  const handleRemove = (userId) => {

    const res =
      targetType === 'vault'
        ? removeVaultShare({ vaultId: targetId, userId })
        : targetType === 'collection'
          ? removeCollectionShare({ collectionId: targetId, userId })
          : targetType === 'asset'
            ? removeAssetShare({ assetId: targetId, userId })
            : null;

    if (res && res.ok === false) {
      Alert.alert('Not allowed', res.message || 'You do not have permission to remove sharing on this item.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.modal, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Share {targetType}</Text>
            <Text style={[styles.label, { color: theme.textMuted }]}>User</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="Username or email"
              placeholderTextColor={theme.placeholder}
              value={query}
              onChangeText={setQuery}
            />
            {suggestions.length > 0 && (
              <View style={[styles.suggestions, { borderColor: theme.border, backgroundColor: theme.inputBg }]}>
                {suggestions.map((u, idx) => (
                  <TouchableOpacity
                    key={u.id || u.username || u.email || String(idx)}
                    style={[
                      styles.suggestionRow,
                      { borderBottomColor: theme.border },
                      idx === suggestions.length - 1 && styles.suggestionRowLast,
                    ]}
                    onPress={() => handleShare(u.id)}
                  >
                    <View>
                      <Text style={[styles.suggestionName, { color: theme.text }]}>{u.username || u.email || 'User'}</Text>
                      <Text style={[styles.suggestionMeta, { color: theme.textMuted }]}>{u.email || `${u.firstName || ''} ${u.lastName || ''}`}</Text>
                    </View>
                    <Text style={styles.addText}>Add</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Text style={[styles.label, { color: theme.textMuted }]}>Access Type</Text>
            <View style={styles.roleRow}>
              {ROLE_OPTIONS.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={[
                    styles.roleChip,
                    { borderColor: theme.border, backgroundColor: theme.inputBg },
                    role === r.value && { borderColor: '#2563eb', backgroundColor: theme.surface },
                  ]}
                  onPress={() => setRole(r.value)}
                >
                  <Text style={[styles.roleText, { color: theme.text }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {ROLE_HELP[role] && (
              <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>{ROLE_HELP[role]}</Text>
            )}

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

            {(targetType === 'vault' || targetType === 'collection') && (
              <>
                <Text style={[styles.label, { color: theme.textMuted }]}>Permissions</Text>
                <View style={styles.roleRow}>
                  {targetType === 'vault' && (
                    <>
                      <View style={styles.createLabelWrap}>
                        <Text style={[styles.createLabelText, { color: theme.textMuted }]}>Create Collections</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.roleChipSmall,
                          { borderColor: theme.border, backgroundColor: theme.inputBg },
                          !canCreateCollections && { borderColor: '#2563eb', backgroundColor: theme.surface },
                        ]}
                        onPress={() => setCanCreateCollections(false)}
                      >
                        <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.roleChipSmall,
                          { borderColor: theme.border, backgroundColor: theme.inputBg },
                          canCreateCollections && { borderColor: '#2563eb', backgroundColor: theme.surface },
                        ]}
                        onPress={() => setCanCreateCollections(true)}
                      >
                        <Text style={[styles.roleText, { color: theme.text }]}>Enabled</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {targetType === 'collection' && (
                    <>
                      <View style={styles.createLabelWrap}>
                        <Text style={[styles.createLabelText, { color: theme.textMuted }]}>Create Assets</Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.roleChipSmall,
                          { borderColor: theme.border, backgroundColor: theme.inputBg },
                          !canCreateAssets && { borderColor: '#2563eb', backgroundColor: theme.surface },
                        ]}
                        onPress={() => setCanCreateAssets(false)}
                      >
                        <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.roleChipSmall,
                          { borderColor: theme.border, backgroundColor: theme.inputBg },
                          canCreateAssets && { borderColor: '#2563eb', backgroundColor: theme.surface },
                        ]}
                        onPress={() => setCanCreateAssets(true)}
                      >
                        <Text style={[styles.roleText, { color: theme.text }]}>Enabled</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </>
            )}
              {existingShares.length > 0 && (
                <View style={[styles.sharedBox, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  <Text style={[styles.sharedLabel, { color: theme.text }]}>Currently shared</Text>
                <ScrollView style={styles.sharedList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {existingShares.map((s, idx) => (
                    <View key={s.userId}>
                      <View style={[styles.sharedRow, { backgroundColor: theme.inputBg }]}>
                        <View style={styles.sharedInfo}>
                          <Text style={[styles.sharedName, { color: theme.text }]}>{s.user?.username || s.userId}</Text>
                          <Text style={[styles.sharedMeta, { color: theme.textMuted }]}>{s.user?.email || ''}</Text>
                        </View>
                        <View style={styles.sharedActions}>
                          <View style={styles.roleRow}>
                            {ROLE_OPTIONS.map((r) => (
                              <TouchableOpacity
                                key={r.value}
                                style={[
                                  styles.roleChipSmall,
                                  { borderColor: theme.border, backgroundColor: theme.inputBg },
                                  normalizeRole(s.role) === r.value && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                ]}
                                onPress={() => handleUpdate(
                                  s.userId,
                                  r.value,
                                  targetType === 'vault' ? s.canCreateCollections : targetType === 'collection' ? s.canCreateAssets : undefined
                                )}
                              >
                                <Text style={[styles.roleText, { color: theme.text }]}>{r.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          {ROLE_HELP[normalizeRole(s.role)] && (
                            <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>{ROLE_HELP[normalizeRole(s.role)]}</Text>
                          )}

                          <View style={[styles.miniDivider, { backgroundColor: theme.border }]} />

                          {(targetType === 'vault' || targetType === 'collection') && (
                            <>
                              <Text style={[styles.label, { color: theme.textMuted }]}>Permissions</Text>
                              <View style={styles.roleRow}>
                                {targetType === 'vault' && (
                                  <>
                                    <View style={styles.createLabelWrap}>
                                      <Text style={[styles.createLabelText, { color: theme.textMuted }]}>Create Collections</Text>
                                    </View>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !s.canCreateCollections && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, s.role, false)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !!s.canCreateCollections && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, s.role, true)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Enabled</Text>
                                    </TouchableOpacity>
                                  </>
                                )}
                                {targetType === 'collection' && (
                                  <>
                                    <View style={styles.createLabelWrap}>
                                      <Text style={[styles.createLabelText, { color: theme.textMuted }]}>Create Assets</Text>
                                    </View>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !s.canCreateAssets && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, s.role, false)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !!s.canCreateAssets && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, s.role, true)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Enabled</Text>
                                    </TouchableOpacity>
                                  </>
                                )}
                              </View>
                            </>
                          )}
                          <TouchableOpacity
                            style={[styles.removeBtn, { backgroundColor: theme.surface, borderColor: '#dc2626' }]}
                            onPress={() => handleRemove(s.userId)}
                          >
                            <Text style={[styles.removeText, { color: '#dc2626' }]}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {idx < existingShares.length - 1 && <View style={[styles.sharedDivider, { backgroundColor: theme.border }]} />}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondary} onPress={onClose}>
              <Text style={[styles.secondaryText, { color: theme.text }]}>Close</Text>
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
  label: { color: '#9aa1b5', fontWeight: '800', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  suggestions: { marginTop: 8, maxHeight: 180, borderWidth: 1, borderColor: '#1f2738', borderRadius: 10, backgroundColor: '#11121a', overflow: 'hidden' },
  suggestionRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#1f2738', flexDirection: 'row', justifyContent: 'space-between' },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionName: { color: '#fff', fontWeight: '700' },
  suggestionMeta: { color: '#9aa1b5', fontSize: 12 },
  addText: { color: '#9ab6ff', fontWeight: '700' },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a' },
  roleChipActive: { borderColor: '#2563eb', backgroundColor: '#172447' },
  roleChipSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a' },
  roleText: { color: '#e5e7f0', fontWeight: '700' },
  createLabelWrap: { justifyContent: 'center', paddingRight: 2 },
  createLabelText: { color: '#9aa1b5', fontWeight: '700' },
  roleHelp: { color: '#cbd2e8', marginTop: 6, lineHeight: 18 },
  actions: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
  secondary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#26344a' },
  secondaryText: { color: '#e5e7f0', fontWeight: '700' },
  toggle: { marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#1f2738', backgroundColor: '#11121a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleActive: { borderColor: '#2563eb', backgroundColor: '#172447' },
  toggleText: { color: '#e5e7f0', fontWeight: '600' },
  toggleBadge: { color: '#9aa1b5', fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#1f2738', marginVertical: 12 },
  miniDivider: { height: 1, backgroundColor: '#1f2738', marginVertical: 10 },
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
