import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useData } from '../context/DataContext';

export default function SubscriptionManager() {
  const { currentUser, subscriptionTiers, updateSubscription } = useData();
  const [selectedTier, setSelectedTier] = useState(currentUser?.subscription?.tier || null);
  const [submitting, setSubmitting] = useState(false);

  if (!currentUser?.subscription) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>No active subscription</Text>
      </View>
    );
  }

  const currentTier = subscriptionTiers[currentUser.subscription.tier];
  const tiers = Object.values(subscriptionTiers);
  const renewalDate = new Date(currentUser.subscription.renewalDate);

  const handleChangePlan = () => {
    if (!selectedTier || selectedTier === currentUser.subscription.tier) {
      Alert.alert('Select Plan', 'Please choose a different plan');
      return;
    }

    Alert.alert(
      'Change Plan',
      `Switch to ${subscriptionTiers[selectedTier].name}? Changes take effect next billing cycle.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          style: 'default',
          onPress: () => {
            setSubmitting(true);
            const res = updateSubscription(selectedTier);
            setSubmitting(false);
            if (res.ok) {
              Alert.alert('Success', 'Your plan has been updated');
            } else {
              Alert.alert('Error', res.message);
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Subscription</Text>

      <View style={styles.currentPlanBox}>
        <Text style={styles.currentPlanLabel}>Current Plan</Text>
        <Text style={styles.currentPlanName}>{currentTier?.name || 'Unknown'}</Text>
        <Text style={styles.currentPlanPrice}>
          ${currentTier?.price || 0}/{currentTier?.period || 'month'}
        </Text>
        <Text style={styles.renewalText}>
          Renews on {renewalDate.toLocaleDateString()}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Change Your Plan</Text>

      <View style={styles.plansContainer}>
        {tiers.map((tier) => (
          <TouchableOpacity
            key={tier.id}
            style={[
              styles.planCard,
              selectedTier === tier.id && styles.planCardSelected,
              currentUser.subscription.tier === tier.id && styles.planCardCurrent
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
            {currentUser.subscription.tier === tier.id && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {selectedTier !== currentUser.subscription.tier && (
        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleChangePlan}
          disabled={submitting}
        >
          <Text style={styles.buttonText}>
            {submitting ? 'Updating…' : 'Update Plan'}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
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
});
