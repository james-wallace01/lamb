import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform, Linking, NativeModules } from 'react-native';
import { useData } from '../context/DataContext';
import { API_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';
import { safeIapCall } from '../utils/iap';
import * as RNIap from 'react-native-iap';

export default function SubscriptionManager({ showTitle = true, showChooseMembership = false, onChooseMembership }) {
  const { currentUser, subscriptionTiers, convertPrice, theme, showAlert } = useData();
  const Alert = { alert: showAlert };
  const [submitting, setSubmitting] = useState(false);

  const iapNativeAvailable =
    Platform.OS === 'ios' &&
    !!(
      NativeModules?.RNIapModule ||
      NativeModules?.RNIapIos ||
      NativeModules?.RNIapIosSk2 ||
      NativeModules?.RNIapIosStorekit2
    );

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      try {
        if (!iapNativeAvailable) return;
        await safeIapCall(() => RNIap.initConnection());
      } catch {
        // ignore
      }
    })();
    return () => {
      if (!iapNativeAvailable) return;
      safeIapCall(() => RNIap.endConnection());
    };
  }, []);

  const openAppleSubscriptionSettings = async () => {
    // Apple-supported path for managing subscriptions.
    const url = 'itms-apps://apps.apple.com/account/subscriptions';
    Linking.openURL(url).catch(() => {
      Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {});
    });
  };

  const restorePurchases = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Unavailable', 'Restore is available on iOS only.');
      return;
    }

    if (!iapNativeAvailable) {
      Alert.alert(
        'In-app purchases unavailable',
        'To test purchases you need a native build (TestFlight or an EAS development build). Expo Go does not support react-native-iap.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const purchases = await safeIapCall(() => RNIap.getAvailablePurchases());
      if (!purchases) {
        Alert.alert(
          'In-app purchases unavailable',
          'This build cannot access Apple In-App Purchases. Use TestFlight (recommended) or an EAS development build with react-native-iap included.'
        );
        setSubmitting(false);
        return;
      }
      const best = Array.isArray(purchases) ? purchases.find((p) => p?.transactionReceipt) : null;
      const receiptData = best?.transactionReceipt || null;
      const productId = best?.productId || null;
      if (!receiptData) {
        Alert.alert('Nothing to restore', 'No active purchases were found on this Apple ID.');
        setSubmitting(false);
        return;
      }

      const resp = await apiFetch(`${API_URL}/iap/verify`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'ios', productId, receiptData }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        Alert.alert('Restore failed', json?.error || 'Unable to verify receipt');
        setSubmitting(false);
        return;
      }

      Alert.alert('Restored', 'Your membership has been restored.');
    } catch (e) {
      Alert.alert('Restore failed', e?.message || 'Unable to restore purchases');
    } finally {
      setSubmitting(false);
    }
  };

  const tierId = currentUser?.subscription?.tier ? String(currentUser.subscription.tier).toUpperCase() : null;
  const tier = tierId && subscriptionTiers && subscriptionTiers[tierId] ? subscriptionTiers[tierId] : null;
  const localPrice = tier ? convertPrice(tier.price) : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {showTitle ? <Text style={[styles.title, { color: theme.text }]}>Membership</Text> : null}
      {!tier ? (
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No active membership</Text>
      ) : (
        <View style={[styles.currentPlanCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.planName, { color: theme.text }]}>{tier.name}</Text>
          <Text style={[styles.planDescription, { color: theme.textMuted }]}>Current membership</Text>
          {localPrice ? (
            <Text style={[styles.planPrice, { color: theme.text }]}>
              {localPrice.symbol}{localPrice.amount}/{tier.period}
            </Text>
          ) : null}
        </View>
      )}

      {showChooseMembership ? (
        <TouchableOpacity
          style={[styles.primaryButton, { borderColor: theme.primary, backgroundColor: theme.primary }, submitting && styles.primaryButtonDisabled]}
          onPress={() => {
            if (submitting) return;
            onChooseMembership?.();
          }}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Choose membership"
        >
          <Text style={styles.primaryButtonText}>Choose Membership</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, { borderColor: theme.primary, backgroundColor: theme.primary }, submitting && styles.primaryButtonDisabled]}
        onPress={openAppleSubscriptionSettings}
        disabled={submitting}
      >
        <Text style={styles.primaryButtonText}>Manage in App Store Subscriptions</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, submitting && styles.secondaryButtonDisabled]}
        onPress={restorePurchases}
        disabled={submitting}
      >
        <Text style={styles.secondaryButtonText}>{submitting ? 'Restoring…' : 'Restore Purchases'}</Text>
      </TouchableOpacity>

      <Text style={[styles.note, { color: theme.textMuted }]}>
        Subscriptions are billed and managed by Apple. If you already have an active subscription on this Apple ID, use Restore Purchases.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  currentPlanCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '800',
  },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#26344a',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    color: '#e5e7f0',
    fontWeight: '700',
  },
  note: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 16,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  planDescription: {
    fontSize: 13,
    marginBottom: 12,
  },
});
