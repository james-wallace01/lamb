import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useData } from '../context/DataContext';
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
    showNotice,
  } = useData();
  const notifyError = (message) => showNotice?.(message, { variant: 'error', durationMs: 2600 });
  const notifyInfo = (message) => showNotice?.(message, { durationMs: 1800 });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [invitesListenError, setInvitesListenError] = useState('');
  const [invitesLoading, setInvitesLoading] = useState(false);
  const inviteAbortRef = useRef(null);
  const invitesLoadAbortRef = useRef(null);
  // Back-compat: DataContext still accepts a legacy "role" string to map into permissions.
  const [role, setRole] = useState(DEFAULT_DELEGATE_ROLE);
  const [canCreateCollections, setCanCreateCollections] = useState(false);
  const [canCreateAssets, setCanCreateAssets] = useState(false);

  const getInviteStatusPresentation = (rawStatus) => {
    const status = String(rawStatus || '').toUpperCase();
    if (status === 'PENDING') {
      return { label: 'Pending', bg: '#fbbf24', border: '#f59e0b', text: '#111827' };
    }
    if (status === 'ACCEPTED') {
      return { label: 'Active', bg: '#16a34a', border: '#15803d', text: '#ffffff' };
    }
    if (status === 'DENIED') {
      return { label: 'Denied', bg: '#dc2626', border: '#b91c1c', text: '#ffffff' };
    }
    return { label: status || 'Pending', bg: '#0f172a', border: '#334155', text: '#e5e7f0' };
  };

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
      notifyError(res?.message || 'You do not have permission to share this item.');
      return;
    }

    setCanCreateCollections(false);
    setCanCreateAssets(false);
  };

  const handleSendInvite = async () => {
    const email = String(inviteEmail || '').trim().toLowerCase();
    const selfEmail = String(currentUser?.email || '').trim().toLowerCase();
    if (!email) {
      setInviteEmailError('');
      notifyError('Enter an email to delegate.');
      return;
    }

    if (selfEmail && email === selfEmail) {
      setInviteEmailError("You can't invite yourself!");
      return;
    }

    setInviteEmailError('');

    // Vault owners can create invitation codes (works for existing users and non-users).
    if (canInviteByEmail) {
      await handleCreateInvite();
      return;
    }

    // Otherwise: immediately grant access to an existing user matched by email.
    const match = (users || []).find((u) => String(u?.email || '').toLowerCase() === email);
    if (!match?.id) {
      notifyError('No user with that email is available to delegate.');
      return;
    }

    if (currentUser?.id && String(match.id) === String(currentUser.id)) {
      setInviteEmailError("You can't invite yourself!");
      return;
    }

    await handleShare(match.id);
    setInviteEmail('');
    notifyInfo('Delegate access has been granted.');
  };

  const canInviteByEmail = useMemo(() => {
    if (!vaultIdForTarget) return false;
    const uid = currentUser?.id ? String(currentUser.id) : null;
    if (!uid) return false;
    const m = (vaultMemberships || []).find(
      (x) => x && String(x.vault_id) === String(vaultIdForTarget) && String(x.user_id) === uid
    );
    return !!(m && m.status === 'ACTIVE' && m.role === 'OWNER');
  }, [vaultIdForTarget, vaultMemberships, currentUser]);

  useEffect(() => {
    if (visible) return;
    // If the modal closes while a network request is in-flight, abort it so the UI can't get stuck.
    try {
      inviteAbortRef.current?.abort?.();
    } catch {
      // ignore
    }
    inviteAbortRef.current = null;

    try {
      invitesLoadAbortRef.current?.abort?.();
    } catch {
      // ignore
    }
    invitesLoadAbortRef.current = null;

    setCreatingInvite(false);
    setInvitesLoading(false);
    setInvitesListenError('');
  }, [visible]);

  const getCreatedAtMs = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v.toMillis === 'function') {
      try {
        return v.toMillis();
      } catch {
        return 0;
      }
    }
    if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      return Math.floor(v.seconds * 1000);
    }
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  };

  const loadInvites = async () => {
    if (!visible) return;
    if (!vaultIdForTarget) return;
    if (!canInviteByEmail) return;

    const vaultId = String(vaultIdForTarget);
    setInvitesListenError('');
    setInvitesLoading(true);

    try {
      try {
        invitesLoadAbortRef.current?.abort?.();
      } catch {
        // ignore
      }
      invitesLoadAbortRef.current = null;

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) invitesLoadAbortRef.current = controller;

      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vaultId)}/invitations`, {
        requireAuth: true,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal,
        timeoutMs: 12000,
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setPendingInvites([]);
        setInvitesListenError(json?.error || 'Unable to load invites.');
        return;
      }

      const rawInvites = Array.isArray(json?.invitations) ? json.invitations : [];
      const invites = rawInvites
        .map((x) => (x && typeof x === 'object' ? x : null))
        .filter(Boolean)
        .filter((x) => ['PENDING', 'ACCEPTED', 'DENIED'].includes(String(x?.status || '').toUpperCase()))
        .filter((x) => {
          const sType = String(x?.scope_type || 'VAULT').toUpperCase();
          const sId = x?.scope_id == null ? null : String(x.scope_id);
          if (targetType === 'vault') return sType === 'VAULT';
          if (targetType === 'collection') return sType === 'COLLECTION' && sId === String(targetId);
          if (targetType === 'asset') return sType === 'ASSET' && sId === String(targetId);
          return false;
        })
        .sort((a, b) => getCreatedAtMs(b?.createdAt) - getCreatedAtMs(a?.createdAt));

      setPendingInvites(invites);
    } catch (err) {
      setPendingInvites([]);
      setInvitesListenError(err?.message || 'Unable to load invites.');
    } finally {
      invitesLoadAbortRef.current = null;
      setInvitesLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (!canInviteByEmail) return;
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, canInviteByEmail, vaultIdForTarget, targetType, targetId]);

  const handleCreateInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    const selfEmail = String(currentUser?.email || '').trim().toLowerCase();
    if (!email) {
      setInviteEmailError('');
      notifyError('Enter an email to invite.');
      return;
    }

    if (selfEmail && email === selfEmail) {
      setInviteEmailError("You can't invite yourself!");
      return;
    }

    setInviteEmailError('');
    if (creatingInvite) return;
    if (!canInviteByEmail) {
      notifyError('Only the vault owner can create invites.');
      return;
    }
    setCreatingInvite(true);
    try {
      // Cancel any previous attempt before starting a new one.
      try {
        inviteAbortRef.current?.abort?.();
      } catch {
        // ignore
      }
      inviteAbortRef.current = null;

      const vaultId = String(vaultIdForTarget);
      const scopeType = targetType === 'vault' ? 'VAULT' : targetType === 'collection' ? 'COLLECTION' : targetType === 'asset' ? 'ASSET' : 'VAULT';
      const scopeId = targetType === 'vault' ? null : String(targetId);
      const permissions =
        targetType === 'vault'
          ? { View: true, Create: !!canCreateCollections }
          : targetType === 'collection'
            ? { View: true, Create: !!canCreateAssets }
            : { View: true };

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) inviteAbortRef.current = controller;

      const resp = await apiFetch(`${API_URL}/vaults/${encodeURIComponent(vaultId)}/invitations`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, scopeType, scopeId, permissions }),
        signal: controller?.signal,
        timeoutMs: 12000,
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        notifyError(json?.error || 'Unable to create invitation');
        return;
      }

      // Refresh list from the same backend that created the invite.
      await loadInvites();

      setInviteEmail('');
      notifyInfo('An invitation has been created for this email.');
    } catch (e) {
      notifyError(e?.message || 'Unable to create invitation');
    } finally {
      inviteAbortRef.current = null;
      setCreatingInvite(false);
    }
  };

  const handleRevokeInvite = async (code) => {
    if (!canInviteByEmail) {
      notifyError('Only the vault owner can revoke invites.');
      return;
    }
    const vaultId = String(vaultIdForTarget);
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
        notifyError(json?.error || 'Unable to revoke invitation');
        return;
      }
      notifyInfo('Invitation has been revoked.');
      await loadInvites();
    } catch (e) {
      notifyError(e?.message || 'Unable to revoke invitation');
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
      notifyError(res?.message || 'You do not have permission to update sharing on this item.');
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
      notifyError(res?.message || 'You do not have permission to remove sharing on this item.');
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
            <Text style={[styles.title, { color: theme.text }]}>
              {targetType === 'collection' ? 'Delegate Collection' : `Share ${targetType}`}
            </Text>

          {targetType === 'vault' && (
            <>
              <Text style={[styles.label, { color: theme.textMuted, marginTop: 8 }]}>Invite by email</Text>
              {canInviteByEmail ? (
                <>
                  <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>Invite a delegate by email.</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder="Email"
                    placeholderTextColor={theme.placeholder}
                    value={inviteEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    keyboardType="email-address"
                    onChangeText={(t) => {
                      setInviteEmail(t);
                      if (inviteEmailError) setInviteEmailError('');
                    }}
                  />
                  {inviteEmailError ? (
                    <Text style={[styles.inlineError, { color: '#dc2626' }]}>{inviteEmailError}</Text>
                  ) : null}
                  <TouchableOpacity style={[styles.primaryButton, creatingInvite && styles.primaryButtonDisabled]} onPress={handleSendInvite} disabled={creatingInvite}>
                    <Text style={styles.primaryButtonText}>{creatingInvite ? 'Sending…' : 'Send invite'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={[styles.roleHelp, { color: theme.textSecondary }]}>Only the vault owner can create invites.</Text>
              )}
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
            </>
          )}

            {targetType !== 'vault' && (
              <>
                <Text style={[styles.label, { color: theme.textMuted }]}>Email</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                  placeholder="Email"
                  placeholderTextColor={theme.placeholder}
                  value={inviteEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="email-address"
                  onChangeText={(t) => {
                    setInviteEmail(t);
                    if (inviteEmailError) setInviteEmailError('');
                  }}
                />
                {inviteEmailError ? (
                  <Text style={[styles.inlineError, { color: '#dc2626' }]}>{inviteEmailError}</Text>
                ) : null}
                <TouchableOpacity style={[styles.primaryButton, creatingInvite && styles.primaryButtonDisabled]} onPress={handleSendInvite} disabled={creatingInvite}>
                  <Text style={styles.primaryButtonText}>{creatingInvite ? 'Sending…' : 'Send invite'}</Text>
                </TouchableOpacity>
              </>
            )}

            {canInviteByEmail && (
              <>
                <View style={[styles.miniDivider, { backgroundColor: theme.border }]} />
                <Text style={[styles.label, { color: theme.textMuted }]}>Invites</Text>
                <Text style={[styles.roleHelp, { color: theme.textSecondary, marginTop: 2 }]}>API: {API_URL}</Text>
                <View style={[styles.sharedBox, { borderColor: theme.border, backgroundColor: theme.surface }]}> 
                  {invitesListenError ? (
                    <Text style={[styles.roleHelp, { color: '#dc2626', marginTop: 0 }]}>{invitesListenError}</Text>
                  ) : invitesLoading ? (
                    <Text style={[styles.roleHelp, { color: theme.textSecondary, marginTop: 0 }]}>Loading…</Text>
                  ) : pendingInvites.length === 0 ? (
                    <Text style={[styles.roleHelp, { color: theme.textSecondary, marginTop: 0 }]}>No invites yet.</Text>
                  ) : (
                    <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
                      {pendingInvites.map((inv) => (
                        <View key={inv.id} style={[styles.sharedRow, { backgroundColor: theme.inputBg }]}> 
                          <View style={styles.sharedHeaderRow}>
                            <View style={styles.sharedInfoLeft}>
                              <Text style={[styles.sharedName, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                                {inv.invitee_email || inv.email || inv.id}
                              </Text>
                            </View>
                            <View style={styles.sharedRightActions}>
                              {(() => {
                                const pres = getInviteStatusPresentation(inv.status);
                                return (
                                  <View style={[styles.statusPill, { backgroundColor: pres.bg, borderColor: pres.border }]}>
                                    <Text style={[styles.statusText, { color: pres.text }]}>{pres.label}</Text>
                                  </View>
                                );
                              })()}

                              {String(inv?.status || '').toUpperCase() === 'PENDING' ? (
                                <TouchableOpacity
                                  style={[styles.removeBtn, { backgroundColor: theme.surface, borderColor: '#dc2626' }]}
                                  onPress={() => handleRevokeInvite(inv.id)}
                                >
                                  <Text style={[styles.removeText, { color: '#dc2626' }]}>Revoke</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </>
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
                        <View style={styles.sharedHeaderRow}>
                          <View style={styles.sharedInfoLeft}>
                            <Text style={[styles.sharedName, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                              {s.user?.email || s.userId}
                            </Text>
                          </View>

                          <View style={styles.sharedRightActions}>
                            <View style={[styles.statusPill, { backgroundColor: '#16a34a', borderColor: '#15803d' }]}>
                              <Text style={[styles.statusText, { color: '#ffffff' }]}>Active</Text>
                            </View>
                            <TouchableOpacity
                              style={[styles.removeBtn, { backgroundColor: theme.surface, borderColor: '#dc2626' }]}
                              onPress={() => handleRemove(s.userId)}
                            >
                              <Text style={[styles.removeText, { color: '#dc2626' }]}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        {(targetType === 'vault' || targetType === 'collection') && (
                          <View style={styles.sharedPermissionsRow}>
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
                        )}
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
  sharedRow: { flexDirection: 'column', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#11121a' },
  sharedDivider: { height: 1, backgroundColor: '#1f2738', marginVertical: 8 },
  sharedInfoLeft: { flex: 1, minWidth: 0 },
  sharedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  sharedRightActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  sharedPermissionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  statusPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '800' },
  sharedName: { color: '#fff', fontWeight: '700' },
  sharedMeta: { color: '#9aa1b5', fontSize: 12 },
  removeBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#44282c', backgroundColor: '#2a171b', alignSelf: 'flex-start' },
  removeText: { color: '#fca5a5', fontWeight: '700' },
  inlineError: { marginTop: 6, fontWeight: '700' },
});
