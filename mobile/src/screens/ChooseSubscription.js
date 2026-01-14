import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking, Platform, NativeModules } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { API_URL } from '../config/api';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { apiFetch } from '../utils/apiFetch';
import { safeIapCall } from '../utils/iap';
import * as RNIap from 'react-native-iap';
import { IAP_PRODUCTS } from '../config/iap';

export default function ChooseSubscription({ navigation, route }) {
  const { subscriptionTiers, convertPrice, theme, register, loading, ensureFirebaseSignupAuth, refreshData } = useData();
  const insets = useSafeAreaInsets();
  const { firstName, lastName, email, username, password } = route.params || {};
  const isUpgrade = String(route?.params?.mode || '') === 'upgrade';
  const [selectedTier, setSelectedTier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [iapReady, setIapReady] = useState(false);
  const [iapInitError, setIapInitError] = useState(null);

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
    let mounted = true;
    (async () => {
      try {
        if (!iapNativeAvailable) {
          throw new Error('In-app purchases unavailable in this build');
        }
        await safeIapCall(() => RNIap.initConnection());
        if (mounted) {
          setIapReady(true);
          setIapInitError(null);
        }
      } catch {
        if (mounted) {
          setIapReady(false);
          setIapInitError('In-app purchases are unavailable in this build.');
        }
      }
    })();
    return () => {
      mounted = false;
      if (!iapNativeAvailable) return;
      safeIapCall(() => RNIap.endConnection());
    };
  }, []);

  const footerSpacer = 72 + (insets?.bottom || 0);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  const productIdForTier = (tierId) => {
    const t = String(tierId || '').toUpperCase();
    if (t === 'BASIC') return IAP_PRODUCTS.BASIC_MONTHLY;
    if (t === 'PREMIUM') return IAP_PRODUCTS.PREMIUM_MONTHLY;
    if (t === 'PRO') return IAP_PRODUCTS.PRO_MONTHLY;
    return null;
  };

  const handleContinue = async () => {
    if (!selectedTier) {
      Alert.alert('Select Membership', 'Please choose a membership to continue');
      return;
    }

    if (Platform.OS !== 'ios') {
      Alert.alert('Unavailable', 'Membership purchases are currently available on iOS only.');
      return;
    }

    if (!iapNativeAvailable || !iapReady) {
      Alert.alert(
        'In-app purchases unavailable',
        `${iapInitError || 'This build cannot access Apple In-App Purchases.'}\n\nTo test purchases you need a native build (TestFlight or an EAS development build). Expo Go does not support react-native-iap.`
      );
      return;
    }

    setSubmitting(true);

    if (!isUpgrade) {
      // In production, backend membership endpoints require Firebase auth.
      // Ensure we have a Firebase session so apiFetch can attach an ID token.
      const authRes = await ensureFirebaseSignupAuth?.({ email, password, username });
      if (authRes && authRes.ok === false) {
        Alert.alert('Sign up failed', authRes.message || 'Unable to create account. Please try again.');
        setSubmitting(false);
        return;
      }
    }

    const tier = subscriptionTiers[selectedTier];
    const localPrice = convertPrice(tier.price);
    const productId = productIdForTier(selectedTier);
    if (!productId) {
      Alert.alert('Error', 'Invalid membership selection');
      setSubmitting(false);
      return;
    }

    let purchase = null;
    try {
      purchase = await safeIapCall(() => RNIap.requestSubscription({ sku: productId }));
    } catch (e) {
      const raw = e?.message ? String(e.message) : String(e || 'Purchase cancelled');
      const msg = /buyProduct|of null|native module/i.test(raw)
        ? 'In-app purchases are unavailable in this build. Use TestFlight (recommended) or create an EAS development build with react-native-iap included.'
        : raw;
      Alert.alert('Purchase', msg);
      setSubmitting(false);
      return;
    }

    if (!purchase) {
      Alert.alert(
        'In-app purchases unavailable',
        'This build cannot access Apple In-App Purchases. Use TestFlight (recommended) or an EAS development build with react-native-iap included.'
      );
      setSubmitting(false);
      return;
    }

    const receiptData = purchase?.transactionReceipt || null;
    if (!receiptData) {
      Alert.alert('Error', 'Purchase completed but receipt was missing. Please try restoring purchases.');
      setSubmitting(false);
      return;
    }

    const verifyResp = await apiFetch(`${API_URL}/iap/verify`, {
      requireAuth: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'ios', productId, receiptData, tier: selectedTier.toUpperCase() }),
    });

    const verifyJson = await verifyResp.json().catch(() => null);
    if (!verifyResp.ok) {
      Alert.alert('Error', verifyJson?.error || 'Unable to verify purchase');
      setSubmitting(false);
      return;
    }

    try {
      await safeIapCall(() => RNIap.finishTransaction({ purchase, isConsumable: false }));
    } catch {
      // ignore
    }

    if (isUpgrade) {
      try {
        await refreshData?.();
      } catch {
        // ignore
      }
      setSubmitting(false);
      Alert.alert('Success!', 'Your membership is active.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      return;
    }

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('Free trial subscription started - creating account');
    }
    const res = await register({
      firstName,
      lastName,
      email,
      username,
      password,
      subscriptionTier: selectedTier.toUpperCase(),
    });

    setSubmitting(false);

    if (!res.ok) {
      Alert.alert('Sign up failed', res.message || 'Try again');
      return;
    }

    Alert.alert(
      'Success!',
      `Your membership is active. You will be charged ${localPrice.symbol}${localPrice.amount}/${tier.period} by Apple unless you cancel in App Store Subscriptions.`
    );
  };

  const handleRestorePurchases = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Unavailable', 'Restore is available on iOS only.');
      return;
    }

    if (!iapNativeAvailable || !iapReady) {
      Alert.alert(
        'In-app purchases unavailable',
        `${iapInitError || 'This build cannot access Apple In-App Purchases.'}\n\nTo test purchases you need a native build (TestFlight or an EAS development build). Expo Go does not support react-native-iap.`
      );
      return;
    }

    if (submitting || loading) return;
    setSubmitting(true);

    try {
      if (!isUpgrade) {
        const authRes = await ensureFirebaseSignupAuth?.({ email, password, username });
        if (authRes && authRes.ok === false) {
          Alert.alert('Sign up failed', authRes.message || 'Unable to create account. Please try again.');
          return;
        }
      }

      const purchases = await safeIapCall(() => RNIap.getAvailablePurchases());
      if (!purchases) {
        Alert.alert(
          'In-app purchases unavailable',
          'This build cannot access Apple In-App Purchases. Use TestFlight (recommended) or an EAS development build with react-native-iap included.'
        );
        return;
      }

      const best = Array.isArray(purchases) ? purchases.find((p) => p?.transactionReceipt) : null;
      const receiptData = best?.transactionReceipt || null;
      const productId = best?.productId || null;
      if (!receiptData) {
        Alert.alert('Nothing to restore', 'No active purchases were found on this Apple ID.');
        return;
      }

      const verifyResp = await apiFetch(`${API_URL}/iap/verify`, {
        requireAuth: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'ios', productId, receiptData }),
      });

      const verifyJson = await verifyResp.json().catch(() => null);
      if (!verifyResp.ok || !verifyJson?.ok) {
        Alert.alert('Restore failed', verifyJson?.error || 'Unable to verify receipt');
        return;
      }

      if (isUpgrade) {
        try {
          await refreshData?.();
        } catch {
          // ignore
        }
        Alert.alert('Restored', 'Your membership has been restored.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }

      const tier = verifyJson?.tier ? String(verifyJson.tier).toUpperCase() : null;
      const res = await register({
        firstName,
        lastName,
        email,
        username,
        password,
        subscriptionTier: tier,
      });

      if (!res.ok) {
        Alert.alert('Sign up failed', res.message || 'Try again');
        return;
      }

      Alert.alert('Restored', 'Your membership has been restored.');
    } catch (e) {
      Alert.alert('Restore failed', e?.message || 'Unable to restore purchases');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (isUpgrade) return;
    if (submitting || loading) return;

    Alert.alert(
      'Continue without membership?',
      'You can still access the app and join a vault as a delegate using an invite code. A paid membership is only required for full access as an owner.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);

            const authRes = await ensureFirebaseSignupAuth?.({ email, password, username });
            if (authRes && authRes.ok === false) {
              Alert.alert('Sign up failed', authRes.message || 'Unable to create account. Please try again.');
              setSubmitting(false);
              return;
            }

            const res = await register({
              firstName,
              lastName,
              email,
              username,
              password,
              subscriptionTier: null,
            });

            setSubmitting(false);

            if (!res.ok) {
              Alert.alert('Sign up failed', res.message || 'Try again');
              return;
            }

            Alert.alert('Account created', 'You can join a vault from Home using an invite code.');
          },
        },
      ]
    );
  };

  const tiers = Object.values(subscriptionTiers);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.container, { backgroundColor: theme.background, paddingBottom: 24 + footerSpacer }]}
    >
      <LambHeader />
      <Text style={[styles.title, { color: theme.text }]}>Choose Your Membership</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Subscriptions are billed by Apple and can be managed in App Store Subscriptions.</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>Auto-renews until canceled. Cancel anytime in App Store Subscriptions.</Text>

      <View style={styles.plansContainer}>
        {tiers.map((tier) => {
          const localPrice = convertPrice(tier.price);
          return (
            <TouchableOpacity
              key={tier.id}
              style={[
                styles.planCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
                selectedTier === tier.id && styles.planCardSelected
              ]}
              onPress={() => setSelectedTier(tier.id)}
            >
              <Text style={[styles.planName, { color: theme.text }]}>{tier.name}</Text>
              <Text style={[styles.planDescription, { color: theme.textMuted }]}>{tier.description}</Text>
              <View style={styles.priceContainer}>
                <Text style={styles.price}>{localPrice.symbol}{localPrice.amount}</Text>
                <Text style={[styles.period, { color: theme.textMuted }]}>/{tier.period}</Text>
              </View>
              {selectedTier === tier.id && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.button, (submitting || !selectedTier) && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={submitting || loading || !selectedTier}
      >
        <Text style={styles.buttonText}>
          {submitting ? (isUpgrade ? 'Processing…' : 'Creating account…') : 'Continue'}
        </Text>
      </TouchableOpacity>

      {!isUpgrade ? (
        <TouchableOpacity onPress={handleSkip} disabled={submitting || loading}>
          <Text style={[styles.link, { color: theme.link, marginTop: 10, marginBottom: 0, opacity: (submitting || loading) ? 0.7 : 1 }]}>Skip for now</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity onPress={handleRestorePurchases} disabled={submitting || loading}>
        <Text style={[styles.link, { color: theme.link, marginTop: 10, marginBottom: 0, opacity: (submitting || loading) ? 0.7 : 1 }]}>Restore Purchases</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={[styles.link, { color: theme.link }]}>Back</Text>
      </TouchableOpacity>

      <View style={[styles.legalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
        <Text style={[styles.legalTitle, { color: theme.text }]}>Legal</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingVertical: 24,
    paddingHorizontal: 24,
    backgroundColor: '#0b0b0f',
    gap: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginTop: 12,
  },
  subtitle: {
    color: '#c5c5d0',
    marginBottom: 8,
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
    fontSize: 28,
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
  button: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  link: {
    color: '#9ab6ff',
    marginTop: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 32,
  },
  legalCard: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 8 },
  legalTitle: { color: '#e5e7f0', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  legalRow: { paddingVertical: 4 },
  legalLink: { color: '#9ab6ff', fontWeight: '600' },
});
