import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useData } from '../context/DataContext';
import LambHeader from '../components/LambHeader';

export default function ChooseSubscription({ navigation, route }) {
  const { subscriptionTiers } = useData();
  const { firstName, lastName, email, username, password } = route.params || {};
  const [selectedTier, setSelectedTier] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, loading } = useData();

  const handleContinue = () => {
    if (!selectedTier) {
      Alert.alert('Select Plan', 'Please choose a subscription plan to continue');
      return;
    }

    setSubmitting(true);
    const res = register({
      firstName,
      lastName,
      email,
      username,
      password,
      subscriptionTier: selectedTier
    });
    setSubmitting(false);

    if (!res.ok) {
      Alert.alert('Sign up failed', res.message || 'Try again');
      return;
    }
  };

  const tiers = Object.values(subscriptionTiers);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <LambHeader />
      <Text style={styles.title}>Choose Your Plan</Text>
      <Text style={styles.subtitle}>Select a subscription to get started with LAMB</Text>

      <View style={styles.plansContainer}>
        {tiers.map((tier) => (
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
              <Text style={styles.price}>${tier.price}</Text>
              <Text style={styles.period}>/{tier.period}</Text>
            </View>
            {selectedTier === tier.id && (
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
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
    padding: 24,
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
  },
});
