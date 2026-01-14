import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useData } from '../context/DataContext';
import { firestore } from '../firebase';
import { collection, onSnapshot, orderBy, query as fsQuery } from 'firebase/firestore';
import { API_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';

// Roles are Vault-scoped and only OWNER/DELEGATE.
// Sharing UI configures delegate permissions, not hierarchical roles.
const DEFAULT_DELEGATE_ROLE = 'editor';

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
    vaultMemberships,
    permissionGrants,
    acceptInvitationCode,
    showAlert,
  } = useData();
  const Alert = { alert: showAlert };
  const [query, setQuery] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  // Back-compat: DataContext still accepts a legacy "role" string to map into permissions.
  const [role, setRole] = useState(DEFAULT_DELEGATE_ROLE);
  const [canCreateCollections, setCanCreateCollections] = useState(false);
  const [canCreateAssets, setCanCreateAssets] = useState(false);

  const vaultIdForTarget = useMemo(() => {
    if (targetType === 'vault') return targetId;
    if (targetType === 'collection') return collections.find((c) => c.id === targetId)?.vaultId || null;
    if (targetType === 'asset') return assets.find((a) => a.id === targetId)?.vaultId || null;
    return null;
  }, [targetType, targetId, collections, assets]);

  const alreadySharedIds = useMemo(() => {
    if (!vaultIdForTarget) return [];
    if (targetType === 'vault') {
      return (vaultMemberships || [])
        .filter((m) => m?.vault_id === String(vaultIdForTarget) && m?.status === 'ACTIVE' && m?.role === 'DELEGATE')
        .map((m) => m.user_id);
    }
    if (targetType === 'collection') {
      return (permissionGrants || [])
        .filter((g) => g?.vault_id === String(vaultIdForTarget) && g?.scope_type === 'COLLECTION' && g?.scope_id === String(targetId))
        .map((g) => g.user_id);
    }
    if (targetType === 'asset') {
      return (permissionGrants || [])
        .filter((g) => g?.vault_id === String(vaultIdForTarget) && g?.scope_type === 'ASSET' && g?.scope_id === String(targetId))
        .map((g) => g.user_id);
    }
    return [];
  }, [vaultIdForTarget, targetType, targetId, vaultMemberships, permissionGrants]);

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
    if (!vaultIdForTarget) return [];

    if (targetType === 'vault') {
      return (vaultMemberships || [])
        .filter((m) => m?.vault_id === String(vaultIdForTarget) && m?.status === 'ACTIVE' && m?.role === 'DELEGATE')
        .map((m) => ({
          userId: m.user_id,
          // Back-compat fields used by handlers
          role: DEFAULT_DELEGATE_ROLE,
          canCreateCollections: !!m?.permissions?.Create,
          user: users.find((u) => u.id === m.user_id),
        }));
    }

    if (targetType === 'collection') {
      return (permissionGrants || [])
        .filter((g) => g?.vault_id === String(vaultIdForTarget) && g?.scope_type === 'COLLECTION' && g?.scope_id === String(targetId))
        .map((g) => ({
          userId: g.user_id,
          role: DEFAULT_DELEGATE_ROLE,
          canCreateAssets: !!g?.permissions?.Create,
          user: users.find((u) => u.id === g.user_id),
        }));
    }

    if (targetType === 'asset') {
      return (permissionGrants || [])
        .filter((g) => g?.vault_id === String(vaultIdForTarget) && g?.scope_type === 'ASSET' && g?.scope_id === String(targetId))
        .map((g) => ({
          userId: g.user_id,
          role: DEFAULT_DELEGATE_ROLE,
          user: users.find((u) => u.id === g.user_id),
        }));
    }

    return [];
  }, [vaultIdForTarget, targetType, targetId, vaultMemberships, permissionGrants, users]);

  const handleShare = async (userId) => {
    const normalizedRole = role || DEFAULT_DELEGATE_ROLE;

    const res =
      targetType === 'vault'
        ? await shareVault({ vaultId: targetId, userId, role: normalizedRole, canCreateCollections })
        : targetType === 'collection'
          ? await shareCollection({ collectionId: targetId, userId, role: normalizedRole, canCreateAssets })
          : targetType === 'asset'
            ? await shareAsset({ assetId: targetId, userId, role: normalizedRole })
            : null;

    if (!res || res.ok === false) {
      Alert.alert('Not allowed', res?.message || 'You do not have permission to share this item.');
      return;
    }

    setQuery('');
    setCanCreateCollections(false);
    setCanCreateAssets(false);
  };

  const canInviteByEmail = useMemo(() => {
    if (targetType !== 'vault') return false;
    const v = (vaults || []).find((x) => x?.id === targetId);
    if (!v) return false;
    return v?.ownerId && currentUser?.id && v.ownerId === currentUser.id;
  }, [targetType, targetId, vaults, currentUser]);

  useEffect(() => {
    if (!visible) return;
    if (targetType !== 'vault') return;
    if (!firestore) return;
    if (!targetId) return;
    if (!canInviteByEmail) return;

    const vaultId = String(targetId);
    const invRef = collection(firestore, 'vaults', vaultId, 'invitations');
    const q = fsQuery(invRef, orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const invites = snap.docs
          .map((d) => ({ id: String(d.id), ...(d.data() || {}) }))
          .filter((x) => x?.status === 'PENDING');
        setPendingInvites(invites);
      },
      () => {
        // ignore
      }
    );

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, [visible, targetType, targetId]);

  const handleCreateInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      Alert.alert('Invite', 'Enter an email to invite.');
      return;
    }
    if (creatingInvite) return;
    if (!canInviteByEmail) {
      Alert.alert('Invite', 'Only the vault owner can create invites.');
      return;
    }
    setCreatingInvite(true);
    try {
      const vaultId = String(targetId);
      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vaultId)}/invitations`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        Alert.alert('Invite failed', json?.error || 'Unable to create invitation');
        return;
      }

      const code = json?.code ? String(json.code) : '';
      if (code) setInviteCode(code);
      setInviteEmail('');
      Alert.alert('Invite created', 'Share the invite code with your delegate.');
    } catch (e) {
      Alert.alert('Invite failed', e?.message || 'Unable to create invitation');
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleAcceptInvite = async () => {
    const code = inviteCode.trim();
    if (!code) {
      Alert.alert('Invite', 'Paste an invite code to accept.');
      return;
    }
    const res = await acceptInvitationCode?.(code);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to accept invite');
      return;
    }
    Alert.alert('Joined', 'You now have access to the vault.');
    onClose?.();
  };

  const handleRevokeInvite = async (code) => {
    if (!canInviteByEmail) {
      Alert.alert('Revoke failed', 'Only the vault owner can revoke invites.');
      return;
    }
    const vaultId = String(targetId);
    const inviteId = String(code || '').trim();
    if (!vaultId || !inviteId) return;
    try {
      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vaultId)}/invitations/${encodeURIComponent(inviteId)}/revoke`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        Alert.alert('Revoke failed', json?.error || 'Unable to revoke invitation');
        return;
      }
      Alert.alert('Revoked', 'Invitation has been revoked.');
    } catch (e) {
      Alert.alert('Revoke failed', e?.message || 'Unable to revoke invitation');
    }
  };

  const handleUpdate = async (userId, nextRole, nextFlag) => {
    const normalizedRole = nextRole || DEFAULT_DELEGATE_ROLE;

    const res =
      targetType === 'vault'
        ? await updateVaultShare({ vaultId: targetId, userId, role: normalizedRole, canCreateCollections: nextFlag })
        : targetType === 'collection'
          ? await updateCollectionShare({ collectionId: targetId, userId, role: normalizedRole, canCreateAssets: nextFlag })
          : targetType === 'asset'
            ? await updateAssetShare({ assetId: targetId, userId, role: normalizedRole })
            : null;

    if (!res || res.ok === false) {
      Alert.alert('Not allowed', res?.message || 'You do not have permission to update sharing on this item.');
    }
  };

  const handleRemove = async (userId) => {
    const res =
      targetType === 'vault'
        ? await removeVaultShare({ vaultId: targetId, userId })
        : targetType === 'collection'
          ? await removeCollectionShare({ collectionId: targetId, userId })
          : targetType === 'asset'
            ? await removeAssetShare({ assetId: targetId, userId })
            : null;

    if (!res || res.ok === false) {
      Alert.alert('Not allowed', res?.message || 'You do not have permission to remove sharing on this item.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.modal,
            { borderColor: theme.border },
            Platform.OS === 'ios' ? { backgroundColor: 'transparent' } : { backgroundColor: theme.surface },
          ]}
        >
          {Platform.OS === 'ios' ? (
            <BlurView
              style={StyleSheet.absoluteFill}
              intensity={22}
              tint={theme.isDark ? 'dark' : 'light'}
              pointerEvents="none"
            />
          ) : null}

          <View style={styles.modalContent}>
            <Text style={[styles.title, { color: theme.text }]}>Share {targetType}</Text>

          {targetType === 'vault' && (
            <>
              <Text style={[styles.label, { color: theme.textMuted, marginTop: 8 }]}>Invite by code</Text>
              {canInviteByEmail ? (
                <>
                  <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>Paid owners can invite delegates by email. Delegates accept using a code.</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="Delegate email"
                    placeholderTextColor={theme.placeholder}
                    value={inviteEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setInviteEmail}
                  />
                  <TouchableOpacity style={[styles.primaryButton, creatingInvite && styles.primaryButtonDisabled]} onPress={handleCreateInvite} disabled={creatingInvite}>
                    <Text style={styles.primaryButtonText}>{creatingInvite ? 'Creating…' : 'Create invite'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>Only the vault owner can create invites.</Text>
              )}

              <TextInput
                style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder="Invite code"
                placeholderTextColor={theme.placeholder}
                value={inviteCode}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setInviteCode}
              />
              <TouchableOpacity style={[styles.secondaryButton]} onPress={handleAcceptInvite}>
                <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Accept invite</Text>
              </TouchableOpacity>

              {canInviteByEmail && pendingInvites.length > 0 && (
                <>
                  <View style={[styles.miniDivider, { backgroundColor: theme.border }]} />
                  <Text style={[styles.label, { color: theme.textMuted }]}>Pending invites</Text>
                  <View style={[styles.sharedBox, { borderColor: theme.border, backgroundColor: theme.surface }]}> 
                    <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
                      {pendingInvites.map((inv) => (
                        <View key={inv.id} style={[styles.sharedRow, { backgroundColor: theme.inputBg }]}> 
                          <View style={styles.sharedInfo}>
                            <Text style={[styles.sharedName, { color: theme.text }]}>{inv.invitee_email || inv.email || inv.id}</Text>
                            <Text style={[styles.sharedMeta, { color: theme.textMuted }]}>{inv.id}</Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.removeBtn, { backgroundColor: theme.surface, borderColor: '#dc2626' }]}
                            onPress={() => handleRevokeInvite(inv.id)}
                          >
                            <Text style={[styles.removeText, { color: '#dc2626' }]}>Revoke</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />
            </>
          )}

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
            <Text style={[styles.label, { color: theme.textMuted }]}>Delegate Access</Text>
            <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>
              Delegates can work inside the shared scope based on the permissions you grant.
            </Text>

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
                          <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>Delegate</Text>

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
                                      onPress={() => handleUpdate(s.userId, DEFAULT_DELEGATE_ROLE, false)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !!s.canCreateCollections && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, DEFAULT_DELEGATE_ROLE, true)}
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
                                      onPress={() => handleUpdate(s.userId, DEFAULT_DELEGATE_ROLE, false)}
                                    >
                                      <Text style={[styles.roleText, { color: theme.text }]}>Disabled</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[
                                        styles.roleChipSmall,
                                        { borderColor: theme.border, backgroundColor: theme.inputBg },
                                        !!s.canCreateAssets && { borderColor: '#2563eb', backgroundColor: theme.surface },
                                      ]}
                                      onPress={() => handleUpdate(s.userId, DEFAULT_DELEGATE_ROLE, true)}
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: '#0f111a', borderRadius: 14, borderWidth: 1, borderColor: '#1f2738', maxHeight: '80%', overflow: 'hidden' },
  modalContent: { padding: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  label: { color: '#9aa1b5', fontWeight: '800', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#11121a', borderColor: '#1f2738', borderWidth: 1, borderRadius: 10, padding: 12, color: '#fff' },
  primaryButton: { marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#2563eb', backgroundColor: '#2563eb', alignItems: 'center' },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#26344a', backgroundColor: 'transparent', alignItems: 'center' },
  secondaryButtonText: { color: '#e5e7f0', fontWeight: '700' },
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
