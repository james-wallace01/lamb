import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput, Image, RefreshControl, TouchableOpacity } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { getInitials } from '../utils/user';
import { runWithMinimumDuration } from '../utils/timing';

export default function Home({ navigation }) {
  const { currentUser, refreshData, theme, membershipAccess, acceptInvitationCode, denyInvitationCode, listMyInvitations, backendReachable, showAlert } = useData();
  const Alert = { alert: showAlert };
  const isOffline = backendReachable === false;
  const [invitations, setInvitations] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState('');

  const [avatarFailed, setAvatarFailed] = useState(false);
  const scrollRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);

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
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAcceptInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return;
    const res = await acceptInvitationCode?.(raw);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to accept invite');
      return;
    }
    Alert.alert('Joined', 'You now have access to the shared vault.');
    await loadInvitations();
    if (res.vaultId) navigation.navigate('SharedVaults', { selectedVaultId: res.vaultId });
  };

  const handleDenyInvitation = async (code) => {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw) return;
    const res = await denyInvitationCode?.(raw);
    if (!res || res.ok === false) {
      Alert.alert('Invite failed', res?.message || 'Unable to deny invite');
      return;
    }
    Alert.alert('Denied', 'Invitation denied.');
    await loadInvitations();
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
            </View>
          </View>

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
          </View>
        </View>

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
