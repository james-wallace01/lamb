import React, { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Linking, Platform, TextInput } from 'react-native';
import LambHeader from '../components/LambHeader';
import SubscriptionManager from '../components/SubscriptionManager';
import { useData } from '../context/DataContext';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { runWithMinimumDuration } from '../utils/timing';

const FEEDBACK_EMAIL = 'support@lamb.app';

export default function Membership({ navigation }) {
  const { refreshData, theme, vaults, currentUser, showAlert, updateSubscription, language, currency, setLanguagePreference, setCurrencyPreference } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [languageDraft, setLanguageDraft] = useState(String(language || ''));
  const [currencyDraft, setCurrencyDraft] = useState(String(currency || ''));

  const ownsAnyVault = (vaults || []).some((v) => v?.ownerId && currentUser?.id && v.ownerId === currentUser.id);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleFeedback = () => {
    const subject = encodeURIComponent('LAMB Feedback');
    const who = currentUser?.email || currentUser?.username || currentUser?.id || '';
    const body = encodeURIComponent(
      `Hi!\n\nMy feedback:\n\n\n---\nUser: ${who}\nPlatform: ${Platform.OS}`
    );
    const mailto = `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`;

    Linking.openURL(mailto).catch(() => {
      showAlert?.('Feedback', `Unable to open your email app. Please email us at ${FEEDBACK_EMAIL}.`);
    });
  };

  const handleSupport = () => {
    const subject = encodeURIComponent('LAMB Support');
    const who = currentUser?.email || currentUser?.username || currentUser?.id || '';
    const body = encodeURIComponent(
      `Hi!\n\nI need help with:\n\n\n---\nUser: ${who}\nPlatform: ${Platform.OS}`
    );
    const mailto = `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`;

    Linking.openURL(mailto).catch(() => {
      showAlert?.('Support', `Unable to open your email app. Please email us at ${FEEDBACK_EMAIL}.`);
    });
  };

  const applyPreferences = async () => {
    const langRes = await setLanguagePreference?.(languageDraft);
    if (langRes && langRes.ok === false) {
      showAlert?.('Language', langRes.message || 'Invalid language code.');
      return;
    }
    const curRes = await setCurrencyPreference?.(currencyDraft);
    if (curRes && curRes.ok === false) {
      showAlert?.('Currency', curRes.message || 'Invalid currency code.');
      return;
    }
    showAlert?.('Preferences', 'Saved.');
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
          <LambHeader />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Membership</Text>

        <SubscriptionManager
          showTitle={false}
          showChooseMembership={!currentUser?.subscription?.tier}
          onChooseMembership={() => navigation.navigate('ChooseSubscription', { mode: 'upgrade' })}
        />

        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Developer</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Temporary tools for local testing.</Text>
            <TouchableOpacity
              style={[styles.devButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
              onPress={() => {
                const res = updateSubscription?.('PRO');
                if (res?.ok) {
                  showAlert?.('Developer', 'Pro enabled locally for this device.');
                } else {
                  showAlert?.('Developer', res?.message || 'Unable to enable Pro.');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Enable Pro locally"
            >
              <Text style={[styles.devButtonText, { color: theme.onAccentText || '#fff' }]}>DEV: Enable Pro</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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

        <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Support</Text>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={handleSupport}
            accessibilityRole="button"
            accessibilityLabel="Contact support"
          >
            <Text style={[styles.legalLink, { color: theme.link }]}>Contact Support</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Preferences</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Set language and currency anytime.</Text>

          <Text style={[styles.prefLabel, { color: theme.textSecondary }]}>Language (e.g., en, fr, es)</Text>
          <TextInput
            style={[styles.prefInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            autoCapitalize="none"
            value={languageDraft}
            onChangeText={setLanguageDraft}
            placeholder="en"
            placeholderTextColor={theme.placeholder}
          />

          <Text style={[styles.prefLabel, { color: theme.textSecondary }]}>Currency (e.g., USD, EUR)</Text>
          <TextInput
            style={[styles.prefInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            autoCapitalize="characters"
            value={currencyDraft}
            onChangeText={setCurrencyDraft}
            placeholder="USD"
            placeholderTextColor={theme.placeholder}
          />

          <TouchableOpacity
            style={[styles.devButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={applyPreferences}
            accessibilityRole="button"
            accessibilityLabel="Save language and currency"
          >
            <Text style={[styles.devButtonText, { color: theme.onAccentText || '#fff' }]}>Save Preferences</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Feedback</Text>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={handleFeedback}
            accessibilityRole="button"
            accessibilityLabel="Send app feedback"
          >
            <Text style={[styles.legalLink, { color: theme.link }]}>Send Feedback</Text>
          </TouchableOpacity>
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
  prefLabel: { marginTop: 8, fontSize: 12, fontWeight: '700' },
  prefInput: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 6 },
  devButton: { marginTop: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  devButtonText: { fontWeight: '800' },
  spacer: { height: 40 },
});
