import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput, Image, RefreshControl, TouchableOpacity } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import PullToRefreshIndicator from '../components/PullToRefreshIndicator';
import { getInitials } from '../utils/user';
import { runWithMinimumDuration } from '../utils/timing';

export default function Home({ navigation, route }) {
  const {
    currentUser,
    refreshData,
    theme,
    membershipAccess,
    acceptInvitationCode,
    denyInvitationCode,
    listMyInvitations,
    backendReachable,
    showNotice,
    t,
    recentlyAccessed,
    vaults,
    collections,
    assets,
    vaultMemberships,
  } = useData();
  const isOffline = backendReachable === false;
  const isOnProfile = route?.name === 'Profile';
  const goProfile = () => {
    if (isOnProfile) return;
    navigation?.navigate?.('Profile');
  };

  const openRecentlyAccessed = (item) => {
    const screen = item?.screen ? String(item.screen) : '';
    const params = item?.params && typeof item.params === 'object' ? item.params : {};

    const kind = item?.kind ? String(item.kind) : screen;
    const rawVaultId = params?.vaultId != null ? String(params.vaultId) : null;
    const rawCollectionId = params?.collectionId != null ? String(params.collectionId) : null;
    const rawAssetId = params?.assetId != null ? String(params.assetId) : null;

    const resolveVaultId = () => {
      if (kind === 'Vault') return rawVaultId;
      if (kind === 'Collection' && rawCollectionId) {
        const c = (collections || []).find((x) => String(x?.id) === String(rawCollectionId));
        return c?.vaultId != null ? String(c.vaultId) : null;
      }
      if (kind === 'Asset' && rawAssetId) {
        const a = (assets || []).find((x) => String(x?.id) === String(rawAssetId));
        if (a?.vaultId != null) return String(a.vaultId);
        return rawVaultId;
      }
      return rawVaultId;
    };

    const vId = resolveVaultId();
    const uid = currentUser?.id != null ? String(currentUser.id) : null;
    const vault = vId ? (vaults || []).find((v) => String(v?.id) === String(vId)) : null;
    const hasActiveMembership =
      !!(uid && vId && (vaultMemberships || []).some((m) => m?.user_id === uid && m?.status === 'ACTIVE' && String(m?.vault_id) === String(vId)));
    // Prefer ownerId when available; fall back to membership if vault record isn't present yet.
    const isSharedVault = !!(
      uid &&
      vId &&
      ((vault && vault?.ownerId != null && String(vault.ownerId) !== uid) || (!vault && hasActiveMembership))
    );
    const target = isSharedVault ? 'SharedVaults' : 'PrivateVaults';

    if (vId && (kind === 'Vault' || kind === 'Collection' || kind === 'Asset')) {
      let openEdit = null;
      if (kind === 'Vault') openEdit = { kind: 'Vault', vaultId: String(vId) };
      if (kind === 'Collection' && rawCollectionId) openEdit = { kind: 'Collection', vaultId: String(vId), collectionId: String(rawCollectionId) };
      if (kind === 'Asset' && rawAssetId) {
        const a = (assets || []).find((x) => String(x?.id) === String(rawAssetId)) || null;
        const collectionId = a?.collectionId != null ? String(a.collectionId) : (rawCollectionId ? String(rawCollectionId) : null);
        openEdit = {
          kind: 'Asset',
          vaultId: String(vId),
          collectionId: collectionId || undefined,
          assetId: String(rawAssetId),
        };
      }

      if (openEdit) {
        navigation?.navigate?.(target, {
          selectedVaultId: String(vId),
          openEdit,
          openEditToken: Date.now(),
        });
        return;
      }
    }

    // Fallback: keep older behavior if we can't resolve the vault/IDs.
    if (!screen) return;
    navigation?.navigate?.(screen, params);
  };

  const recentList = Array.isArray(recentlyAccessed) ? recentlyAccessed : (recentlyAccessed ? [recentlyAccessed] : []);

  const notifyError = (message) => showNotice?.(message, { variant: 'error', durationMs: 2600 });
  const [invitations, setInvitations] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState('');

  const [avatarFailed, setAvatarFailed] = useState(false);
  const scrollRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const handleScroll = (e) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    if (y < 0) {
      setPullDistance(Math.min(60, -y));
      return;
    }
    setPullDistance(0);
  };

  const getInviteStatusPresentation = (rawStatus) => {
    const status = String(rawStatus || '').toUpperCase();
    if (status === 'PENDING') {
      return { label: 'Pending', bg: theme.warning, border: theme.warningBorder, text: theme.isDark ? '#111827' : theme.text };
    }
    if (status === 'ACCEPTED') {
      return { label: 'Active', bg: theme.success, border: theme.successBorder, text: theme.onAccentText };
    }
    if (status === 'DENIED') {
      return { label: 'Denied', bg: theme.danger, border: theme.dangerBorder, text: theme.onAccentText };
    }
    return { label: status || 'Pending', bg: theme.surfaceAlt, border: theme.border, text: theme.textSecondary };
  };

  const loadInvitations = async () => {
    if (invitesLoading) return;
    if (isOffline) {
      setInvitesError('Internet connection required.');
      setInvitations([]);
      return;
    }
    setInvitesLoading(true);
    setInvitesError('');
    try {
      const res = await listMyInvitations?.();
      if (!res || res.ok === false) {
        setInvitations([]);
        setInvitesError(res?.message || 'Unable to load invitations');
        return;
      }
      const list = Array.isArray(res?.invitations) ? res.invitations : [];
      setInvitations(list);
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await refreshData?.();
        await loadInvitations();
      }, 800);
      showNotice?.('Refresh complete.', { durationMs: 1200 });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayName =
    currentUser?.firstName ||
    currentUser?.username ||
    (currentUser?.email ? String(currentUser.email).split('@')[0] : '') ||
    '';
  const welcomeText = `${t?.('welcome') || 'Welcome'}${displayName ? `, ${displayName}` : ''}`;

  const handleAcceptInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return;
    const res = await acceptInvitationCode?.(raw);
    if (!res || res.ok === false) {
      notifyError(res?.message || 'Unable to accept invite');
      return;
    }
    showNotice?.('You now have access to the shared vault.', { durationMs: 1800 });
    await loadInvitations();
    if (res.vaultId) navigation.navigate('SharedVaults', { selectedVaultId: res.vaultId });
  };

  const handleDenyInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return;
    const res = await denyInvitationCode?.(raw);
    if (!res || res.ok === false) {
      notifyError(res?.message || 'Unable to deny invite');
      return;
    }
    showNotice?.('Invitation denied.', { durationMs: 1800 });
    await loadInvitations();
  };

  if (!membershipAccess) {
    return (
      <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} theme={theme} />
        <ScrollView
          contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
          bounces
          alwaysBounceVertical
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
        >
          <LambHeader />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: theme.text }]}>Home</Text>
            <View style={styles.headerActions}>
              {currentUser ? (
                <TouchableOpacity
                  onPress={goProfile}
                  disabled={isOnProfile}
                  accessibilityRole="button"
                  accessibilityLabel="Profile"
                >
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
              ) : null}
            </View>
          </View>

          <Text style={[styles.welcome, { color: theme.textSecondary }]}>{welcomeText}</Text>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Invitations</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Review invitations to shared vaults.</Text>
            {invitesError ? <Text style={[styles.subtitle, { color: theme.danger }]}>{invitesError}</Text> : null}
            {invitesLoading ? (
              <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>Loading…</Text>
            ) : invitations.length === 0 ? (
              <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>No invitations.</Text>
            ) : (
              <View style={{ gap: 10, marginTop: 10 }}>
                {invitations.map((inv) => {
                  const pres = getInviteStatusPresentation(inv?.status);
                  const vaultName = inv?.vault?.name || 'Shared Vault';
                  const isPending = String(inv?.status || '').toUpperCase() === 'PENDING';
                  return (
                    <View key={String(inv?.id)} style={[styles.card, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, marginTop: 0 }]}>
                      <View style={styles.cardRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                            {vaultName}
                          </Text>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: pres.bg, borderColor: pres.border }]}>
                          <Text style={[styles.statusText, { color: pres.text }]}>{pres.label}</Text>
                        </View>
                      </View>
                      {isPending ? (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                          <TouchableOpacity
                            style={[styles.secondaryButton, { borderColor: theme.successBorder, backgroundColor: theme.success, flex: 1 }]}
                            onPress={() => handleAcceptInvitation(String(inv.id))}
                            disabled={isOffline}
                          >
                            <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Accept</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.secondaryButton, { borderColor: theme.dangerBorder, backgroundColor: theme.danger, flex: 1 }]}
                            onPress={() => handleDenyInvitation(String(inv.id))}
                            disabled={isOffline}
                          >
                            <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Deny</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Recently accessed</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Jump back to your last viewed item.</Text>
            {recentList.length ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                {recentList.slice(0, 4).map((item, idx) => (
                  <TouchableOpacity
                    key={String(item?.updatedAt || idx)}
                    style={[styles.card, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, marginTop: 0 }]}
                    onPress={() => openRecentlyAccessed(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Open recently accessed"
                  >
                    <View style={styles.cardRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                          {item?.title || item?.kind || 'Recently Accessed'}
                        </Text>
                        <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 4 }]} numberOfLines={1} ellipsizeMode="tail">
                          {item?.kind ? String(item.kind) : 'Item'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>No recently accessed item yet.</Text>
            )}
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
                  isOffline && styles.buttonDisabled,
                ]}
                onPress={() => navigation.navigate('ChooseSubscription', { mode: 'upgrade' })}
                disabled={isOffline}
              >
                <Text style={[styles.secondaryText, { color: '#fff' }]}>Choose Membership</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.quickRow} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} theme={theme} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        bounces
        alwaysBounceVertical
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.isDark ? '#fff' : '#111827'} progressViewOffset={24} />}
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Home</Text>
          <View style={styles.headerActions}>
            {currentUser ? (
              <TouchableOpacity
                onPress={goProfile}
                disabled={isOnProfile}
                accessibilityRole="button"
                accessibilityLabel="Profile"
              >
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
            ) : null}
          </View>
        </View>

        <Text style={[styles.welcome, { color: theme.textSecondary }]}>{welcomeText}</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Invitations</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Review invitations to shared vaults.</Text>
          {invitesError ? <Text style={[styles.subtitle, { color: theme.danger }]}>{invitesError}</Text> : null}
          {invitesLoading ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>Loading…</Text>
          ) : invitations.length === 0 ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>No invitations.</Text>
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {invitations.map((inv) => {
                const pres = getInviteStatusPresentation(inv?.status);
                const vaultName = inv?.vault?.name || 'Shared Vault';
                const isPending = String(inv?.status || '').toUpperCase() === 'PENDING';
                return (
                  <View key={String(inv?.id)} style={[styles.card, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, marginTop: 0 }]}>
                    <View style={styles.cardRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                          {vaultName}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: pres.bg, borderColor: pres.border }]}>
                        <Text style={[styles.statusText, { color: pres.text }]}>{pres.label}</Text>
                      </View>
                    </View>
                    {isPending ? (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { borderColor: theme.successBorder, backgroundColor: theme.success, flex: 1 }]}
                          onPress={() => handleAcceptInvitation(String(inv.id))}
                          disabled={isOffline}
                        >
                          <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.secondaryButton, { borderColor: theme.dangerBorder, backgroundColor: theme.danger, flex: 1 }]}
                          onPress={() => handleDenyInvitation(String(inv.id))}
                          disabled={isOffline}
                        >
                          <Text style={[styles.secondaryText, { color: theme.onAccentText, textAlign: 'center' }]}>Deny</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Recently accessed</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Jump back to your last viewed item.</Text>
          {recentList.length ? (
            <View style={{ gap: 10, marginTop: 10 }}>
              {recentList.slice(0, 4).map((item, idx) => (
                <TouchableOpacity
                  key={String(item?.updatedAt || idx)}
                  style={[styles.card, { backgroundColor: theme.surfaceAlt, borderColor: theme.border, marginTop: 0 }]}
                  onPress={() => openRecentlyAccessed(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Open recently accessed"
                >
                  <View style={styles.cardRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1} ellipsizeMode="tail">
                        {item?.title || item?.kind || 'Recently Accessed'}
                      </Text>
                      <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 4 }]} numberOfLines={1} ellipsizeMode="tail">
                        {item?.kind ? String(item.kind) : 'Item'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginTop: 8 }]}>No recently accessed item yet.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  welcome: { marginTop: 2, marginBottom: 6, fontSize: 14, fontWeight: '600' },
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
  statusPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '800' },
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
  buttonDisabled: { opacity: 0.6 },
});
