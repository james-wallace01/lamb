import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { useStripe } from '@stripe/stripe-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { API_URL, APPLE_PAY_COUNTRY_CODE, STRIPE_MERCHANT_DISPLAY_NAME } from '../config/stripe';
import { LEGAL_LINK_ITEMS } from '../config/legalLinks';
import { apiFetch } from '../utils/apiFetch';

export default function ChooseSubscription({ navigation, route }) {
  const { subscriptionTiers, convertPrice, theme } = useData();
  const insets = useSafeAreaInsets();
  const { firstName, lastName, email, username, password } = route.params || {};
  const [selectedTier, setSelectedTier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, loading, ensureFirebaseSignupAuth } = useData();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const footerSpacer = 72 + (insets?.bottom || 0);

  const openLegalLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  const initializePaymentSheet = async (tier) => {
    try {
      const returnURL = ExpoLinking.createURL('stripe-redirect');

      // Collect valid payment info first (no charge yet)
      const response = await apiFetch(`${API_URL}/create-subscription`, {
        requireAuth: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          name: `${firstName} ${lastName}`,
          subscriptionTier: tier.toUpperCase(),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        Alert.alert('Error', err.error || 'Unable to start signup. Please try again.');
        return null;
      }

      const { setupIntentClientSecret, setupIntentId, ephemeralKey, customer } = await response.json();

      if (!setupIntentClientSecret || !customer || !ephemeralKey) {
        Alert.alert('Error', 'Unable to reach membership service. Please try again.');
        return null;
      }

      const { error } = await initPaymentSheet({
        merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
        customerId: customer,
        customerEphemeralKeySecret: ephemeralKey,
        setupIntentClientSecret: setupIntentClientSecret,
        allowsDelayedPaymentMethods: true,
        returnURL,
        applePay: { merchantCountryCode: APPLE_PAY_COUNTRY_CODE },
      });

      if (error) {
        Alert.alert('Error', error.message);
        return null;
      }

      return { setupIntentId, customerId: customer };
    } catch (error) {
      const message = (error && error.message) ? String(error.message) : 'Network request failed';
      Alert.alert(
        'Network error',
        `Unable to reach the membership service.\n\nPlease make sure the backend is running and reachable at:\n${API_URL}\n\nDetails: ${message}`
      );
      console.error(error);
      return null;
    }
  };

  const handleContinue = async () => {
    if (!selectedTier) {
      Alert.alert('Select Membership', 'Please choose a membership to continue');
      return;
    }

    setSubmitting(true);

    // In production, backend membership endpoints require Firebase auth.
    // Ensure we have a Firebase session so apiFetch can attach an ID token.
    const authRes = await ensureFirebaseSignupAuth?.({ email, password, username });
    if (authRes && authRes.ok === false) {
      Alert.alert('Sign up failed', authRes.message || 'Unable to create account. Please try again.');
      setSubmitting(false);
      return;
    }

    const tier = subscriptionTiers[selectedTier];
    const localPrice = convertPrice(tier.price);
    const trialEndsAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));

    // Initialize payment sheet
    const subscriptionData = await initializePaymentSheet(selectedTier);
    if (!subscriptionData) {
      setSubmitting(false);
      return;
    }

    // Present payment sheet
    const { error } = await presentPaymentSheet();
    
    if (error) {
      Alert.alert('Payment cancelled', error.message);
      setSubmitting(false);
      return;
    }

    // Start 14-day free trial subscription (payment method is on file)
    const startResponse = await apiFetch(`${API_URL}/start-trial-subscription`, {
      requireAuth: true,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: subscriptionData.customerId,
        subscriptionTier: selectedTier.toUpperCase(),
        setupIntentId: subscriptionData.setupIntentId,
      }),
    });

    if (!startResponse.ok) {
      const err = await startResponse.json().catch(() => ({}));
      Alert.alert('Error', err.error || 'Unable to start free trial. Please try again.');
      setSubmitting(false);
      return;
    }

    const { subscriptionId } = await startResponse.json();

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
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: subscriptionData.customerId,
    });

    setSubmitting(false);

    if (!res.ok) {
      Alert.alert('Sign up failed', res.message || 'Try again');
      return;
    }

    Alert.alert(
      'Success!',
      `Your 14-day free trial has started. You will be charged ${localPrice.symbol}${localPrice.amount}/${tier.period} starting ${trialEndsAt.toLocaleDateString()} unless you cancel before then.`
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
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Add payment info to start a 14-day free trial. You won’t be charged until the trial ends.</Text>

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
          {submitting ? 'Creating account…' : 'Continue'}
        </Text>
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
