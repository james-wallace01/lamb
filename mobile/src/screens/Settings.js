import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, StyleSheet, View, Text, ScrollView, RefreshControl, TouchableOpacity, Linking, Platform, Switch } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { runWithMinimumDuration } from '../utils/timing';

const FEEDBACK_EMAIL = 'support@lamb.app';

export default function Settings({ navigation }) {
  const {
    refreshData,
    theme,
    currentUser,
    showAlert,
    showNotice,
    language,
    currency,
    languagePreferenceMode,
    currencyPreferenceMode,
    setLanguagePreference,
    setCurrencyPreference,
    isDarkMode,
    setDarkModeEnabled,
    biometricEnabledForCurrentUser,
    enableBiometricSignInForCurrentUser,
    disableBiometricSignIn,
    showVaultTotalValue,
    setShowVaultTotalValueEnabled,
  } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [languageDraft, setLanguageDraft] = useState(languagePreferenceMode === 'auto' ? '__auto__' : String(language || ''));
  const [currencyDraft, setCurrencyDraft] = useState(currencyPreferenceMode === 'auto' ? '__auto__' : String(currency || ''));
  const [updatingBiometric, setUpdatingBiometric] = useState(false);

  const Alert = { alert: showAlert };

  useEffect(() => {
    setLanguageDraft(languagePreferenceMode === 'auto' ? '__auto__' : String(language || ''));
  }, [languagePreferenceMode, language]);

  useEffect(() => {
    setCurrencyDraft(currencyPreferenceMode === 'auto' ? '__auto__' : String(currency || ''));
  }, [currencyPreferenceMode, currency]);

  const LANGUAGE_OPTIONS = [
    { label: 'Auto (Device)', value: '__auto__' },
    { label: 'English', value: 'en' },
    { label: 'Français', value: 'fr' },
    { label: 'Español', value: 'es' },
    { label: 'Deutsch', value: 'de' },
    { label: 'Italiano', value: 'it' },
  ];

  const CURRENCY_OPTIONS = [
    { label: 'Auto (Region)', value: '__auto__' },
    { label: 'USD — US Dollar', value: 'USD' },
    { label: 'EUR — Euro', value: 'EUR' },
    { label: 'GBP — British Pound', value: 'GBP' },
    { label: 'AUD — Australian Dollar', value: 'AUD' },
    { label: 'CAD — Canadian Dollar', value: 'CAD' },
    { label: 'NZD — New Zealand Dollar', value: 'NZD' },
    { label: 'JPY — Japanese Yen', value: 'JPY' },
  ];

  const labelForOption = (options, value) => {
    const found = (options || []).find((o) => String(o.value) === String(value));
    return found?.label || String(value || '');
  };

  const openActionSheet = ({ title, options, selectedValue, onSelect }) => {
    const labels = (options || []).map((o) => o.label);
    const cancelButtonIndex = labels.length;
    const selectedIndex = Math.max(
      0,
      (options || []).findIndex((o) => String(o.value) === String(selectedValue))
    );

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...labels, 'Cancel'],
        cancelButtonIndex,
        userInterfaceStyle: theme?.isDark ? 'dark' : 'light',
        destructiveButtonIndex: undefined,
      },
      (buttonIndex) => {
        if (buttonIndex == null) return;
        if (buttonIndex === cancelButtonIndex) return;
        const picked = options?.[buttonIndex];
        if (!picked) return;
        onSelect?.(picked.value);
      }
    );
  };

  const handleFeedback = () => {
    const subject = encodeURIComponent('LAMB Feedback');
    const who = currentUser?.email || currentUser?.username || currentUser?.id || '';
    const body = encodeURIComponent(
      `Hi!\n\nMy feedback:\n\n\n---\nUser: ${who}\nPlatform: ${Platform.OS}`
    );
    const mailto = `mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=${subject}&body=${body}`;

    Linking.openURL(mailto).catch(() => {
      showNotice?.(`Unable to open your email app. Please email us at ${FEEDBACK_EMAIL}.`, { variant: 'error' });
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
      showNotice?.(`Unable to open your email app. Please email us at ${FEEDBACK_EMAIL}.`, { variant: 'error' });
    });
  };

  const applyPreferences = async () => {
    const langRes = await setLanguagePreference?.(languageDraft);
    if (langRes && langRes.ok === false) {
      showNotice?.(langRes.message || 'Invalid language code.', { variant: 'error' });
      return;
    }
    const curRes = await setCurrencyPreference?.(currencyDraft);
    if (curRes && curRes.ok === false) {
      showNotice?.(curRes.message || 'Invalid currency code.', { variant: 'error' });
      return;
    }
    showNotice?.('Preferences saved.', { variant: 'info' });
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
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>App</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text style={[styles.toggleTitle, { color: theme.text }]}>Dark Mode</Text>
              <Text style={[styles.toggleSubtitle, { color: theme.textMuted }]}>Default is on. Turn off for a light theme.</Text>
            </View>
            <Switch
              value={!!isDarkMode}
              onValueChange={(next) => {
                const res = setDarkModeEnabled?.(next);
                if (!res?.ok) showNotice?.(res?.message || 'Could not update theme', { variant: 'error' });
              }}
            />
          </View>

          {Platform.OS === 'ios' && (
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={[styles.toggleTitle, { color: theme.text }]}>Face ID Sign In</Text>
                <Text style={[styles.toggleSubtitle, { color: theme.textMuted }]}>Use Face ID to sign in on this device.</Text>
              </View>
              <Switch
                value={!!biometricEnabledForCurrentUser}
                onValueChange={async (next) => {
                  if (updatingBiometric) return;
                  setUpdatingBiometric(true);
                  try {
                    if (next) {
                      const res = await enableBiometricSignInForCurrentUser?.();
                      if (!res?.ok) {
                        showNotice?.(res?.message || 'Could not enable Face ID', { variant: 'error' });
                      }
                    } else {
                      const res = await disableBiometricSignIn?.();
                      if (!res?.ok) {
                        showNotice?.(res?.message || 'Could not disable Face ID', { variant: 'error' });
                      }
                    }
                  } finally {
                    setUpdatingBiometric(false);
                  }
                }}
                disabled={updatingBiometric}
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={() => navigation?.navigate?.('EmailNotifications')}
            accessibilityRole="button"
            accessibilityLabel="Email notifications"
          >
            <Text style={[styles.primaryButtonText, { color: theme.onAccentText || '#fff' }]}>Email Notifications</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Preferences</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Set language and currency anytime.</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text style={[styles.toggleTitle, { color: theme.text }]}>Show Total Value</Text>
              <Text style={[styles.toggleSubtitle, { color: theme.textMuted }]}>Show a total on Private/Shared Vaults screens.</Text>
            </View>
            <Switch
              value={showVaultTotalValue !== false}
              onValueChange={(next) => setShowVaultTotalValueEnabled?.(next)}
            />
          </View>

          <Text style={[styles.prefLabel, { color: theme.textSecondary }]}>Language</Text>
          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              style={[styles.selectRow, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
              onPress={() =>
                openActionSheet({
                  title: 'Language',
                  options: LANGUAGE_OPTIONS,
                  selectedValue: languageDraft,
                  onSelect: (v) => setLanguageDraft(String(v)),
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Choose language"
            >
              <Text style={[styles.selectValue, { color: theme.text }]}>{labelForOption(LANGUAGE_OPTIONS, languageDraft)}</Text>
              <Text style={[styles.selectChevron, { color: theme.textMuted }]}>›</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.pickerWrap, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
              <Picker
                mode="dropdown"
                selectedValue={languageDraft}
                onValueChange={(v) => setLanguageDraft(String(v))}
                style={[styles.picker, { color: theme.text }]}
                dropdownIconColor={theme.textMuted}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>
          )}

          <Text style={[styles.prefLabel, { color: theme.textSecondary }]}>Currency</Text>
          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              style={[styles.selectRow, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
              onPress={() =>
                openActionSheet({
                  title: 'Currency',
                  options: CURRENCY_OPTIONS,
                  selectedValue: currencyDraft,
                  onSelect: (v) => setCurrencyDraft(String(v)),
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Choose currency"
            >
              <Text style={[styles.selectValue, { color: theme.text }]}>{labelForOption(CURRENCY_OPTIONS, currencyDraft)}</Text>
              <Text style={[styles.selectChevron, { color: theme.textMuted }]}>›</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.pickerWrap, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
              <Picker
                mode="dropdown"
                selectedValue={currencyDraft}
                onValueChange={(v) => setCurrencyDraft(String(v))}
                style={[styles.picker, { color: theme.text }]}
                dropdownIconColor={theme.textMuted}
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.primary, borderColor: theme.primary }]}
            onPress={applyPreferences}
            accessibilityRole="button"
            accessibilityLabel="Save language and currency"
          >
            <Text style={[styles.primaryButtonText, { color: theme.onAccentText || '#fff' }]}>Save Preferences</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Support</Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={handleSupport}
            accessibilityRole="button"
            accessibilityLabel="Contact support"
          >
            <Text style={[styles.linkText, { color: theme.link }]}>Contact Support</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Feedback</Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={handleFeedback}
            accessibilityRole="button"
            accessibilityLabel="Send app feedback"
          >
            <Text style={[styles.linkText, { color: theme.link }]}>Send Feedback</Text>
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
  card: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8, marginTop: 8 },
  sectionTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  linkRow: { paddingVertical: 6 },
  linkText: { color: '#9ab6ff', fontWeight: '600' },
  prefLabel: { marginTop: 8, fontSize: 12, fontWeight: '700' },
  pickerWrap: { borderWidth: 1, borderRadius: 10, marginTop: 6, overflow: 'hidden' },
  picker: { height: 44 },
  selectRow: { marginTop: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectValue: { fontWeight: '600', flex: 1, paddingRight: 12 },
  selectChevron: { fontSize: 18, fontWeight: '700' },
  primaryButton: { marginTop: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  primaryButtonText: { fontWeight: '800' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  toggleTextCol: { flex: 1 },
  toggleTitle: { fontWeight: '700' },
  toggleSubtitle: { marginTop: 2, fontSize: 12 },
  spacer: { height: 40 },
});
