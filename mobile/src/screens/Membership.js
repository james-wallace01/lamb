import React, { useState } from 'react';
import { Image, StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Linking } from 'react-native';
import LambHeader from '../components/LambHeader';
import SubscriptionManager from '../components/SubscriptionManager';
import { useData } from '../context/DataContext';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { runWithMinimumDuration } from '../utils/timing';
import { getInitials } from '../utils/user';

export default function Membership({ navigation, route }) {
  const { refreshData, theme, vaults, currentUser, updateSubscription, showNotice } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const isOnProfile = route?.name === 'Profile';
  const goProfile = () => {
    if (isOnProfile) return;
    navigation?.navigate?.('Profile');
  };
  const [avatarFailed, setAvatarFailed] = useState(false);

  const notifyError = (message) => showNotice?.(message, { variant: 'error', durationMs: 2600 });
  const notifyInfo = (message) => showNotice?.(message, { durationMs: 1800 });

  const ownsAnyVault = (vaults || []).some((v) => v?.ownerId && currentUser?.id && v.ownerId === currentUser.id);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

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
          <Text style={[styles.title, { color: theme.text }]}>Membership</Text>
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
                      borderWidth: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                  ]}
                >
                  <Text style={[styles.avatarFallbackText, { color: theme.onAccentText || '#fff' }]}>{getInitials(currentUser)}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        <SubscriptionManager
          showTitle={false}
          showChooseMembership={!currentUser?.subscription?.tier}
          onChooseMembership={() => navigation.navigate('ChooseSubscription', { mode: 'upgrade' })}
        />

        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Developer</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Temporary tools for local testing.</Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => {
                const res = updateSubscription?.('PRO');
                if (res?.ok) {
                  notifyInfo('Pro enabled locally for this device.');
                } else {
                  notifyError(res?.message || 'Unable to enable Pro.');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Enable Pro locally"
            >
              <Text style={[styles.primaryButtonText, { color: theme.onAccentText || '#fff' }]}>DEV: Enable Pro</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!ownsAnyVault ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Billing</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your access is managed by the vault owner. Delegates never need to pay.</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Legal</Text>
          {LEGAL_LINK_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.linkRow}
              onPress={() => openLegalLink(item.url)}
              accessibilityRole="link"
            >
              <Text style={[styles.linkText, { color: theme.link }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12, paddingBottom: 100 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallbackText: { fontWeight: '800', fontSize: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  card: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8, marginTop: 8 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  linkRow: { paddingVertical: 6 },
  linkText: { color: '#9ab6ff', fontWeight: '600' },
  primaryButton: { marginTop: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  primaryButtonText: { fontWeight: '800' },
  spacer: { height: 40 },
});
