import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Platform, Linking, NativeModules } from 'react-native';
import { useData } from '../context/DataContext';
import { API_URL } from '../config/api';
import { apiFetch } from '../utils/apiFetch';
import * as RNIap from 'react-native-iap';

export default function SubscriptionManager() {
  const { currentUser, subscriptionTiers, convertPrice, theme } = useData();
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
        await RNIap.initConnection();
      } catch {
        // ignore
      }
    })();
    return () => {
      RNIap.endConnection().catch(() => {});
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
      const purchases = await RNIap.getAvailablePurchases();
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
      <Text style={[styles.title, { color: theme.text }]}>Membership</Text>
      {!tier ? (
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No active membership</Text>
      ) : (
        <View style={[styles.currentPlanCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.planName, { color: theme.text }]}>{tier.name}</Text>
          <Text style={[styles.planDescription, { color: theme.textMuted }]}>Current plan</Text>
          {localPrice ? (
            <Text style={[styles.planPrice, { color: theme.text }]}>
              {localPrice.symbol}{localPrice.amount}/{tier.period}
            </Text>
          ) : null}
        </View>
      )}

      <TouchableOpacity style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]} onPress={openAppleSubscriptionSettings} disabled={submitting}>
        <Text style={styles.primaryButtonText}>Manage in iOS Subscriptions</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, submitting && styles.secondaryButtonDisabled]}
        onPress={restorePurchases}
        disabled={submitting}
      >
        <Text style={styles.secondaryButtonText}>{submitting ? 'Restoring…' : 'Restore Purchases'}</Text>
      </TouchableOpacity>

      <Text style={[styles.note, { color: theme.textMuted }]}>
        Subscriptions are billed and managed by Apple. If you already subscribed on this Apple ID, use Restore Purchases.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#0b0b0f',
    gap: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9aa1b5',
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
    color: '#fff',
  },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
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
  currentPlanBox: {
    backgroundColor: '#11121a',
    borderColor: '#1f2738',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  currentPlanLabel: {
    fontSize: 12,
    color: '#9aa1b5',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  currentPlanName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2563eb',
  },
  currentPlanPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  renewalText: {
    fontSize: 13,
    color: '#9aa1b5',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginTop: 12,
  },
  plansContainer: {
    gap: 12,
  },
  planCard: {
    backgroundColor: '#11121a',
    borderColor: '#1f2738',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    position: 'relative',
  },
  planCardSelected: {
    borderColor: '#2563eb',
    borderWidth: 2,
    backgroundColor: '#0f1419',
  },
  planCardCurrent: {
    borderColor: '#16a34a',
    borderWidth: 1,
  },
  planCardDisabled: {
    opacity: 0.6,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  planDescription: {
    fontSize: 13,
    color: '#9aa1b5',
    marginBottom: 12,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  price: {
    fontSize: 24,
    fontWeight: '800',
    color: '#2563eb',
  },
  period: {
    fontSize: 14,
    color: '#9aa1b5',
    marginLeft: 4,
  },
  checkmark: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  currentBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: '#16a34a',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  currentBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderColor: '#dc2626',
    borderWidth: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  cancelButtonText: {
    color: '#dc2626',
    fontWeight: '700',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0b0b0f',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },
  featureSection: {
    backgroundColor: '#11121a',
    borderColor: '#1f2738',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  featureSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  featureLost: {
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 8,
    fontWeight: '500',
  },
  featureGained: {
    fontSize: 13,
    color: '#16a34a',
    marginBottom: 8,
    fontWeight: '500',
  },
  pricingSection: {
    backgroundColor: '#11121a',
    borderColor: '#1f2738',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  pricingSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pricingLabel: {
    fontSize: 13,
    color: '#9aa1b5',
    fontWeight: '500',
  },
  pricingValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  pricingAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2563eb',
  },
  pricingDivider: {
    height: 1,
    backgroundColor: '#1f2738',
    marginVertical: 12,
  },
  effectiveRow: {
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    borderColor: '#2563eb',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  effectiveLabel: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
    textAlign: 'center',
  },
  modalButtonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderColor: '#1f2738',
    borderWidth: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#9aa1b5',
    fontWeight: '700',
  },
  modalConfirmButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalConfirmButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
