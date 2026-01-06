import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';
import { API_URL } from '../config/stripe';

export default function ChooseSubscription({ navigation, route }) {
  const { subscriptionTiers, convertPrice } = useData();
  const { firstName, lastName, email, username, password } = route.params || {};
  const [selectedTier, setSelectedTier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, loading } = useData();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const initializePaymentSheet = async (tier) => {
    try {
      // Create Stripe subscription
      const response = await fetch(`${API_URL}/create-subscription`, {
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

      const { subscriptionId, clientSecret, ephemeralKey, customer } = await response.json();

      const { error } = await initPaymentSheet({
        merchantDisplayName: 'LAMB',
        customerId: customer,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: clientSecret,
        allowsDelayedPaymentMethods: true,
      });

      if (error) {
        Alert.alert('Error', error.message);
        return null;
      }

      return { subscriptionId, customerId: customer };
    } catch (error) {
      Alert.alert('Error', 'Unable to initialize payment. Please try again.');
      console.error(error);
      return null;
    }
  };

  const handleContinue = async () => {
    if (!selectedTier) {
      Alert.alert('Select Plan', 'Please choose a subscription plan to continue');
      return;
    }

    setSubmitting(true);

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

    // Verify the payment actually went through
    console.log('Payment sheet closed, verifying payment for subscription...');
    const confirmResponse = await fetch(`${API_URL}/confirm-subscription-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriptionId: subscriptionData.subscriptionId,
      }),
    });
    
    const confirmResult = await confirmResponse.json();
    
    if (!confirmResult.success) {
      Alert.alert('Payment failed', 
        `Payment status: ${confirmResult.status}. ${confirmResult.error || 'Please try again.'}`);
      setSubmitting(false);
      return;
    }

    console.log('Payment successful - creating account');
    const res = register({
      firstName,
      lastName,
      email,
      username,
      password,
      subscriptionTier: selectedTier.toUpperCase(),
      stripeSubscriptionId: subscriptionData.subscriptionId,
      stripeCustomerId: subscriptionData.customerId
    });

    setSubmitting(false);

    if (!res.ok) {
      Alert.alert('Sign up failed', res.message || 'Try again');
      return;
    }

    Alert.alert('Success!', 'Your account has been created and subscription is active.');
  };

  const tiers = Object.values(subscriptionTiers);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <LambHeader />
      <Text style={styles.title}>Choose Your Plan</Text>
      <Text style={styles.subtitle}>Select a subscription to get started with LAMB</Text>

      <View style={styles.plansContainer}>
        {tiers.map((tier) => {
          const localPrice = convertPrice(tier.price);
          return (
            <TouchableOpacity
              key={tier.id}
              style={[
                styles.planCard,
                selectedTier === tier.id && styles.planCardSelected
              ]}
              onPress={() => setSelectedTier(tier.id)}
            >
              <Text style={styles.planName}>{tier.name}</Text>
              <Text style={styles.planDescription}>{tier.description}</Text>
              <View style={styles.priceContainer}>
                <Text style={styles.price}>{localPrice.symbol}{localPrice.amount}</Text>
                <Text style={styles.period}>/{tier.period}</Text>
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
        <Text style={styles.link}>Back</Text>
      </TouchableOpacity>
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
    backgroundColor: '#0f1419',
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
});
