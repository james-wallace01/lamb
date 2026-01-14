import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Linking } from 'react-native';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import SubscriptionManager from '../components/SubscriptionManager';
import { useData } from '../context/DataContext';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { runWithMinimumDuration } from '../utils/timing';

export default function Membership({ navigation }) {
  const { refreshData, theme, vaults, currentUser } = useData();
  const [refreshing, setRefreshing] = useState(false);

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
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Membership</Text>

        {!currentUser?.subscription?.tier ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={() => {
              navigation.navigate('ChooseSubscription', { mode: 'upgrade' });
            }}
          >
            <Text style={styles.primaryButtonText}>Choose Membership</Text>
          </TouchableOpacity>
        ) : null}

        <SubscriptionManager />

        {!ownsAnyVault ? (
          <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Billing</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your access is managed by the vault owner. Delegates never need to pay.</Text>
          </View>
        ) : null}

        <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Legal</Text>
          {LEGAL_LINK_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.legalRow}
              onPress={() => openLegalLink(item.url)}
              accessibilityRole="link"
            >
              <Text style={[styles.legalLink, { color: theme.link }]}>{item.label}</Text>
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
  headerRow: { position: 'relative', width: '100%' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  legalCard: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8, marginTop: 8 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  legalRow: { paddingVertical: 6 },
  legalLink: { color: '#9ab6ff', fontWeight: '600' },
  spacer: { height: 40 },
});
