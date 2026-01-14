import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BackButton from '../components/BackButton';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { apiFetch } from '../utils/apiFetch';
import { API_URL } from '../config/stripe';

const CATEGORIES = {
  billing: 'billing',
  security: 'security',
  accessChanges: 'accessChanges',
  destructiveActions: 'destructiveActions',
  structuralChanges: 'structuralChanges',
  activityDigest: 'activityDigest',
};

const ToggleRow = ({ label, helper, value, disabled, onPress, theme }) => {
  return (
    <TouchableOpacity
      style={[styles.row, { borderColor: theme.border }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: theme.text, opacity: disabled ? 0.7 : 1 }]}>{label}</Text>
        {!!helper && <Text style={[styles.rowHelper, { color: theme.textSecondary }]}>{helper}</Text>}
      </View>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: value ? theme.link : theme.surface,
            borderColor: theme.border,
            opacity: disabled ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[styles.pillText, { color: value ? theme.background : theme.textSecondary }]}>{value ? 'On' : 'Off'}</Text>
      </View>
    </TouchableOpacity>
  );
};

export default function EmailNotifications() {
  const { theme, vaults, currentUser } = useData();

  const ownsAnyVault = useMemo(() => {
    if (!currentUser?.id) return false;
    return (vaults || []).some((v) => v?.ownerId && v.ownerId === currentUser.id);
  }, [vaults, currentUser?.id]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [categories, setCategories] = useState({});
  const [digestFrequency, setDigestFrequency] = useState('weekly');

  const load = async () => {
    if (!API_URL) {
      Alert.alert('Unavailable', 'Server is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const resp = await apiFetch(`${API_URL}/notification-settings`, { method: 'GET' });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load settings');
      }

      const s = data.settings || {};
      setEmailEnabled(s.emailEnabled !== false);
      setCategories(s.categories || {});
      setDigestFrequency(s.digestFrequency === 'daily' ? 'daily' : 'weekly');
    } finally {
      setLoading(false);
    }
  };

  const save = async (next) => {
    if (!API_URL) return;
    if (saving) return;

    setSaving(true);
    try {
      const resp = await apiFetch(`${API_URL}/notification-settings`, {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save settings');
      }

      const s = data.settings || {};
      setEmailEnabled(s.emailEnabled !== false);
      setCategories(s.categories || {});
      setDigestFrequency(s.digestFrequency === 'daily' ? 'daily' : 'weekly');
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catValue = (key) => {
    // billing + security are always on (backend enforced)
    if (key === CATEGORIES.billing) return true;
    if (key === CATEGORIES.security) return true;
    return categories?.[key] === true;
  };

  const setCat = (key, value) => {
    const next = { ...(categories || {}), [key]: !!value };
    setCategories(next);
    save({ categories: { [key]: !!value } }).catch(() => {});
  };

  const setGlobal = (value) => {
    setEmailEnabled(!!value);
    save({ emailEnabled: !!value }).catch(() => {});
  };

  const setDigest = (freqOrOff) => {
    if (freqOrOff === 'off') {
      setCategories((prev) => ({ ...(prev || {}), [CATEGORIES.activityDigest]: false }));
      save({ categories: { [CATEGORIES.activityDigest]: false } }).catch(() => {});
      return;
    }

    const freq = freqOrOff === 'daily' ? 'daily' : 'weekly';
    setDigestFrequency(freq);
    setCategories((prev) => ({ ...(prev || {}), [CATEGORIES.activityDigest]: true }));
    save({ digestFrequency: freq, categories: { [CATEGORIES.activityDigest]: true } }).catch(() => {});
  };

  const optionalDisabled = !emailEnabled;

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.headerRow}>
          <BackButton />
          <LambHeader />
        </View>

        <Text style={[styles.title, { color: theme.text }]}>Email Notifications</Text>

        <ToggleRow
          theme={theme}
          label="Receive email notifications"
          helper="Turning this off disables optional emails only."
          value={emailEnabled}
          disabled={saving}
          onPress={() => setGlobal(!emailEnabled)}
        />

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Important (Always On)</Text>
          <ToggleRow
            theme={theme}
            label="Billing & payments"
            helper={ownsAnyVault ? 'These emails are required to protect your account.' : 'Owners only — delegates never receive billing emails.'}
            value={true}
            disabled
            onPress={() => {}}
          />
          <ToggleRow
            theme={theme}
            label="Security alerts"
            helper="These emails are required to protect your account."
            value={true}
            disabled
            onPress={() => {}}
          />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Access & Permissions</Text>
          <ToggleRow
            theme={theme}
            label={ownsAnyVault ? "Someone’s access changes" : "Your access is changed"}
            helper={ownsAnyVault ? 'Get emails when someone accepts or changes access.' : 'Get emails when your access is updated.'}
            value={catValue(CATEGORIES.accessChanges)}
            disabled={saving || optionalDisabled}
            onPress={() => setCat(CATEGORIES.accessChanges, !catValue(CATEGORIES.accessChanges))}
          />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Deletions & Risky Actions</Text>
          <ToggleRow
            theme={theme}
            label="Assets or collections deleted"
            helper="Get emails about high-risk deletions."
            value={catValue(CATEGORIES.destructiveActions)}
            disabled={saving || optionalDisabled}
            onPress={() => setCat(CATEGORIES.destructiveActions, !catValue(CATEGORIES.destructiveActions))}
          />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Structural Changes</Text>
          <ToggleRow
            theme={theme}
            label="Assets moved or reorganised"
            helper="Get emails when things are reorganised."
            value={catValue(CATEGORIES.structuralChanges)}
            disabled={saving || optionalDisabled}
            onPress={() => setCat(CATEGORIES.structuralChanges, !catValue(CATEGORIES.structuralChanges))}
          />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Activity Summary</Text>
          <ToggleRow
            theme={theme}
            label="Daily summary"
            helper="A single email with a summary of changes."
            value={catValue(CATEGORIES.activityDigest) && digestFrequency === 'daily'}
            disabled={saving || optionalDisabled}
            onPress={() => setDigest(catValue(CATEGORIES.activityDigest) && digestFrequency === 'daily' ? 'off' : 'daily')}
          />
          <ToggleRow
            theme={theme}
            label="Weekly summary"
            helper="A single email with a summary of changes."
            value={catValue(CATEGORIES.activityDigest) && digestFrequency === 'weekly'}
            disabled={saving || optionalDisabled}
            onPress={() => setDigest(catValue(CATEGORIES.activityDigest) && digestFrequency === 'weekly' ? 'off' : 'weekly')}
          />
          <Text style={[styles.smallNote, { color: theme.textSecondary }]}>
            Activity summaries are only sent as a digest, never as individual emails.
          </Text>
        </View>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading…</Text>
          </View>
        )}

        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  container: { padding: 20, gap: 12, paddingBottom: 100 },
  headerRow: { position: 'relative', width: '100%' },
  title: { fontSize: 24, fontWeight: '700' },
  sectionCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8, marginTop: 8 },
  sectionTitle: { fontWeight: '800', fontSize: 16, marginBottom: 2 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontWeight: '700', fontSize: 14 },
  rowHelper: { marginTop: 4, fontSize: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, minWidth: 64, alignItems: 'center' },
  pillText: { fontWeight: '800', fontSize: 12 },
  smallNote: { marginTop: 8, fontSize: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  loadingText: { fontWeight: '600' },
  spacer: { height: 40 },
});
