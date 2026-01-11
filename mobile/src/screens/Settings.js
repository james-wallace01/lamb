import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Linking } from 'react-native';
import LambHeader from '../components/LambHeader';
import BackButton from '../components/BackButton';
import SubscriptionManager from '../components/SubscriptionManager';
import { useData } from '../context/DataContext';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';

export default function Membership() {
  const { refreshData, syncSubscriptionFromServer, theme } = useData();
  const [refreshing, setRefreshing] = useState(false);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await syncSubscriptionFromServer?.();
      await refreshData?.();
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 800;
      if (elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
      }
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
        
        <SubscriptionManager />

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
  legalCard: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8, marginTop: 8 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  legalRow: { paddingVertical: 6 },
  legalLink: { color: '#9ab6ff', fontWeight: '600' },
  spacer: { height: 40 },
});
