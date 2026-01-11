import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, Modal } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { useData } from '../context/DataContext';
import { useStripe } from '@stripe/stripe-react-native';
import { API_URL, APPLE_PAY_COUNTRY_CODE, STRIPE_MERCHANT_DISPLAY_NAME } from '../config/stripe';
import { apiFetch } from '../utils/apiFetch';

export default function SubscriptionManager() {
  const {
    currentUser,
    subscriptionTiers,
    updateSubscription,
    syncSubscriptionFromServer,
    calculateProration,
    getFeaturesComparison,
    convertPrice,
    setCancelAtPeriodEnd,
    logout,
    theme,
  } = useData();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [selectedTier, setSelectedTier] = useState(currentUser?.subscription?.tier.toUpperCase() || null);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmData, setConfirmData] = useState(null);
  const [scheduledChange, setScheduledChange] = useState(null); // { tierId: string, changeDateMs: number }

  useEffect(() => {
    const tier = currentUser?.subscription?.tier ? String(currentUser.subscription.tier).toUpperCase() : null;
    if (tier) setSelectedTier(tier);
  }, [currentUser?.subscription?.tier]);

  if (!currentUser?.subscription) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No active membership</Text>
      </View>
    );
  }

  const currentTier = subscriptionTiers[currentUser.subscription.tier.toUpperCase()];
  const tiers = Object.values(subscriptionTiers);
  const renewalDate = new Date(currentUser.subscription.renewalDate);
  const trialEndsAt = currentUser.subscription?.trialEndsAt ? new Date(currentUser.subscription.trialEndsAt) : null;
  const isInTrial = !!trialEndsAt && Date.now() < trialEndsAt.getTime();

  const initializePaymentSheet = async (tier) => {
    try {
      const returnURL = ExpoLinking.createURL('stripe-redirect');
      const response = await apiFetch(`${API_URL}/create-payment-intent`, {
        requireAuth: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(subscriptionTiers[tier].price * 100),
          currency: 'usd',
          email: currentUser.email,
          subscriptionTier: tier,
        }),
      });

      const { paymentIntent, ephemeralKey, customer } = await response.json();

      const { error } = await initPaymentSheet({
        merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
        customerId: customer,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: paymentIntent,
        allowsDelayedPaymentMethods: true,
        returnURL,
        applePay: { merchantCountryCode: APPLE_PAY_COUNTRY_CODE },
      });

      if (error) {
        Alert.alert('Error', error.message);
        return false;
      }

      return true;
    } catch (error) {
      Alert.alert('Error', 'Unable to initialize payment. Please try again.');
      console.error(error);
      return false;
    }
  };

  const readBackendError = async (response) => {
    const status = response?.status;
    const json = await response?.json?.().catch(() => null);
    const messageFromJson = typeof json?.error === 'string' ? json.error : null;
    if (messageFromJson) return messageFromJson;
    return `Request failed (${status})`;
  };

  const handleChangePlan = async () => {
    console.log('handleChangePlan called', { selectedTier, currentTier: currentUser.subscription.tier });
    
    if (!selectedTier || selectedTier === currentUser.subscription.tier.toUpperCase()) {
      Alert.alert('Select Membership', 'Please choose a different membership');
      return;
    }

    const newTier = subscriptionTiers[selectedTier];
    const isUpgrade = newTier.price > currentTier.price;
    const prorationData = calculateProration(currentUser.subscription.tier, selectedTier);
    const { featuresLost, featuresGained } = getFeaturesComparison(currentUser.subscription.tier, selectedTier);

    console.log('Plan change details:', { newTier, isUpgrade, prorationData });

    // Show confirmation modal with detailed proration info
    setConfirmData({
      isUpgrade,
      newTierName: newTier.name,
      prorationData,
      featuresLost,
      featuresGained,
      selectedTier
    });
    setShowConfirmModal(true);
  };

  const handleConfirmChange = async () => {
    setShowConfirmModal(false);
    setSubmitting(true);

    try {
      if (confirmData.isUpgrade) {
        setScheduledChange(null);
        if (!currentUser.subscription?.stripeSubscriptionId) {
          throw new Error('Missing billing subscription. Please sign out/in and try again.');
        }

        // For upgrades, we need to collect payment for the prorated amount
        const response = await apiFetch(`${API_URL}/update-subscription`, {
          requireAuth: true,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subscriptionId: currentUser.subscription.stripeSubscriptionId,
            newSubscriptionTier: confirmData.selectedTier,
          }),
        });

        if (!response.ok) {
          throw new Error(await readBackendError(response));
        }

        const { requiresPayment, clientSecret, ephemeralKey, customer, invoiceId } = await response.json();

        if (requiresPayment && clientSecret) {
          console.log('Processing upgrade payment...');
          console.log('Client secret received:', clientSecret?.substring(0, 20) + '...');
          console.log('Customer ID:', customer);
          console.log('Invoice ID:', invoiceId);
          
          // Initialize payment sheet for proration payment
          const { error: initError } = await initPaymentSheet({
            merchantDisplayName: STRIPE_MERCHANT_DISPLAY_NAME,
            customerId: customer,
            customerEphemeralKeySecret: ephemeralKey,
            paymentIntentClientSecret: clientSecret,
            allowsDelayedPaymentMethods: true,
            returnURL: ExpoLinking.createURL('stripe-redirect'),
            applePay: { merchantCountryCode: APPLE_PAY_COUNTRY_CODE },
          });

          if (initError) {
            console.error('Init payment sheet error:', JSON.stringify(initError));
            Alert.alert('Error', initError.message);
            setSubmitting(false);
            return;
          }

          console.log('Payment sheet initialized successfully');

          // Present payment sheet
          console.log('About to present payment sheet...');
          const { error: presentError } = await presentPaymentSheet();
          console.log('presentPaymentSheet completed');
          console.log('Present error:', JSON.stringify(presentError, null, 2));
          
          if (presentError) {
            console.error('Payment sheet error details:', JSON.stringify(presentError));
            console.error('Error code:', presentError.code);
            console.error('Error message:', presentError.message);
            console.error('Error type:', presentError.type);
            Alert.alert('Payment error', `${presentError.message}\n\nPlease try again or contact support.`);
            setSubmitting(false);
            return;
          }
          
          console.log('Payment sheet closed successfully, verifying with invoiceId:', invoiceId);
          
          // Verify the payment actually went through
          try {
            const confirmResponse = await apiFetch(`${API_URL}/confirm-payment`, {
              requireAuth: true,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                invoiceId: invoiceId,
              }),
            });
            
            console.log('Confirm response status:', confirmResponse.status);
            const confirmData = await confirmResponse.json();
            console.log('Confirm payment data:', JSON.stringify(confirmData));
            
            if (!confirmData.success) {
              Alert.alert('Payment failed', 
                `Payment status: ${confirmData.status}. ${confirmData.error || 'Please try again.'}`);
              setSubmitting(false);
              return;
            }
            
            console.log('Payment verified successfully');
          } catch (confirmError) {
            console.error('Error confirming payment:', confirmError);
            Alert.alert('Error', confirmError?.message || 'Failed to verify payment. Please contact support.');
            setSubmitting(false);
            return;
          }
        }

        // Update local subscription
        console.log('Updating subscription in database...');
        const res = updateSubscription(confirmData.selectedTier, currentUser.subscription.stripeSubscriptionId);
        setSubmitting(false);
        
        if (res.ok) {
          console.log('Subscription updated successfully');
          setSelectedTier(confirmData.selectedTier);
          setScheduledChange(null);
          try {
            await syncSubscriptionFromServer?.({ force: true });
          } catch {
            // ignore
          }
          Alert.alert('Success', `Your membership has been upgraded to ${confirmData.newTierName}!`);
        } else {
          console.log('Subscription update failed:', res.message);
          Alert.alert('Error', res.message);
        }
      } else {
        // For downgrades, schedule the change for the next billing cycle
        if (currentUser.subscription.stripeSubscriptionId) {
          const response = await apiFetch(`${API_URL}/schedule-subscription-change`, {
            requireAuth: true,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              subscriptionId: currentUser.subscription.stripeSubscriptionId,
              newSubscriptionTier: confirmData.selectedTier,
            }),
          });

          if (!response.ok) {
            throw new Error(await readBackendError(response));
          }

          const json = await response.json().catch(() => null);
          const changeDateRaw = json?.changeDate;
          const parsedMs = changeDateRaw ? Date.parse(String(changeDateRaw)) : NaN;
          setScheduledChange({
            tierId: String(confirmData.selectedTier),
            changeDateMs: Number.isFinite(parsedMs) ? parsedMs : confirmData.prorationData?.nextBillDate?.getTime?.() || Date.now(),
          });
        } else {
          // No Stripe subscription yet (seeded users), just update locally
          console.log('No Stripe subscription found, updating locally only');
          const res = updateSubscription(confirmData.selectedTier, null);
          if (!res.ok) {
            throw new Error(res.message);
          }
          setScheduledChange(null);
        }

        setSubmitting(false);

        // Reset selection to the current tier so the UI doesn't keep offering the same change.
        setSelectedTier(currentUser.subscription.tier.toUpperCase());
        try {
          await syncSubscriptionFromServer?.({ force: true });
        } catch {
          // ignore
        }

        Alert.alert(
          'Success', 
          `Your membership will change to ${confirmData.newTierName} on ${confirmData.prorationData.nextBillDate.toLocaleDateString()}.`
        );
      }
    } catch (error) {
      console.error('Error changing subscription:', error);
      const msg = error?.message || 'Unable to change membership. Please try again.';
      if (/session expired|sign in with your password/i.test(String(msg))) {
        Alert.alert('Session expired', String(msg), [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', style: 'destructive', onPress: () => logout?.() },
        ]);
      } else {
        Alert.alert('Error', msg);
      }
      setSubmitting(false);
    }
  };

  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancel Membership',
      'Are you sure you want to cancel? Your membership will remain active until the end of the current billing period.',
      [
        { text: 'Keep Membership', style: 'cancel' },
        {
          text: 'Cancel Membership',
          style: 'destructive',
          onPress: () => {
            setCancelAtPeriodEnd(true);
            setSelectedTier(null);
            Alert.alert(
              'Membership Cancelled',
              `Your ${currentTier.name} membership will remain active until ${renewalDate.toLocaleDateString()}.`
            );
            // In a real app, you would call a backend endpoint to cancel the Stripe subscription
          }
        }
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Current Membership</Text>

      <View style={[styles.currentPlanBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.currentPlanLabel, { color: theme.textMuted }]}>Current Membership</Text>
        <Text style={styles.currentPlanName}>{currentTier?.name || 'Unknown'}</Text>
        <Text style={[styles.currentPlanPrice, { color: theme.text }]}>
          {convertPrice(currentTier?.price || 0).symbol}{convertPrice(currentTier?.price || 0).amount}/{currentTier?.period || 'month'}
        </Text>
        <Text style={[styles.renewalText, { color: theme.textMuted }]}>
          {currentUser.subscription.cancelAtPeriodEnd
            ? `Cancels on ${renewalDate.toLocaleDateString()}`
            : isInTrial
              ? `Free trial ends on ${trialEndsAt.toLocaleDateString()}`
              : `Renews on ${renewalDate.toLocaleDateString()}`}
        </Text>
        {!!scheduledChange?.tierId && typeof scheduledChange?.changeDateMs === 'number' && (
          <Text style={[styles.renewalText, { color: theme.textMuted }]}>
            Scheduled: changes to {subscriptionTiers[scheduledChange.tierId]?.name || scheduledChange.tierId} on{' '}
            {new Date(scheduledChange.changeDateMs).toLocaleDateString()}
          </Text>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>Change Your Membership</Text>

      <View style={styles.plansContainer}>
        {tiers.map((tier) => {
          // Only treat as "current/disabled" if it's the active subscription AND not cancelled
          const isCurrent = currentUser.subscription.tier.toUpperCase() === tier.id && !currentUser.subscription.cancelAtPeriodEnd;
          const localPrice = convertPrice(tier.price);
          return (
            <TouchableOpacity
              key={tier.id}
              style={[
                styles.planCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
                selectedTier === tier.id && [styles.planCardSelected, { backgroundColor: theme.surface }],
                isCurrent && styles.planCardCurrent,
                isCurrent && styles.planCardDisabled
              ]}
              onPress={() => !isCurrent && setSelectedTier(tier.id)}
              disabled={isCurrent}
              activeOpacity={isCurrent ? 1 : 0.7}
            >
              <Text style={[styles.planName, { color: theme.text }]}>{tier.name}</Text>
              <Text style={[styles.planDescription, { color: theme.textMuted }]}>{tier.description}</Text>
              <View style={styles.priceContainer}>
                <Text style={styles.price}>{localPrice.symbol}{localPrice.amount}</Text>
                <Text style={[styles.period, { color: theme.textMuted }]}>/{tier.period}</Text>
              </View>
              {selectedTier === tier.id && !isCurrent && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
              {isCurrent && (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>Current Membership</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedTier && selectedTier !== currentUser.subscription.tier.toUpperCase() && (
        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleChangePlan}
          disabled={submitting}
        >
          <Text style={styles.buttonText}>
            {submitting 
              ? 'Processing…' 
              : subscriptionTiers[selectedTier].price > currentTier.price 
                ? `Upgrade to ${subscriptionTiers[selectedTier].name}` 
                : `Change to ${subscriptionTiers[selectedTier].name}`
            }
          </Text>
        </TouchableOpacity>
      )}

      {!currentUser.subscription.cancelAtPeriodEnd && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancelSubscription}
        >
          <Text style={styles.cancelButtonText}>Cancel Membership</Text>
        </TouchableOpacity>
      )}

      {/* Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={[styles.modalContent, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Confirm Membership Change</Text>

            {confirmData && (
              <>
                {/* Features section */}
                {confirmData.featuresLost && confirmData.featuresLost.length > 0 && (
                  <View style={[styles.featureSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <Text style={[styles.featureSectionTitle, { color: theme.text }]}>Features You'll Lose</Text>
                    {confirmData.featuresLost.map((feature, idx) => (
                      <Text key={idx} style={styles.featureLost}>
                        • {feature}
                      </Text>
                    ))}
                  </View>
                )}

                {confirmData.featuresGained && confirmData.featuresGained.length > 0 && (
                  <View style={[styles.featureSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <Text style={[styles.featureSectionTitle, { color: theme.text }]}>Features You'll Gain</Text>
                    {confirmData.featuresGained.map((feature, idx) => (
                      <Text key={idx} style={styles.featureGained}>
                        ✓ {feature}
                      </Text>
                    ))}
                  </View>
                )}

                {/* Pricing Details */}
                <View style={[styles.pricingSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.pricingSectionTitle, { color: theme.text }]}>Billing Details</Text>

                  {confirmData.isUpgrade ? (
                    <>
                      {confirmData.prorationData.chargeNow > 0 && (
                        <View style={styles.pricingRow}>
                          <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>You'll be charged today:</Text>
                          <Text style={styles.pricingAmount}>
                            {convertPrice(confirmData.prorationData.chargeNow).symbol}{convertPrice(confirmData.prorationData.chargeNow).amount}
                          </Text>
                        </View>
                      )}
                      {confirmData.prorationData.chargeNow === 0 && (
                        <View style={styles.pricingRow}>
                          <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>No additional charge today</Text>
                        </View>
                      )}
                      <View style={[styles.pricingDivider, { backgroundColor: theme.border }]} />
                      <View style={styles.pricingRow}>
                        <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>Your next bill:</Text>
                        <Text style={styles.pricingAmount}>
                          {convertPrice(confirmData.prorationData.nextBillAmount).symbol}{convertPrice(confirmData.prorationData.nextBillAmount).amount}
                        </Text>
                      </View>
                      <View style={styles.pricingRow}>
                        <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>Next billing date:</Text>
                        <Text style={[styles.pricingValue, { color: theme.text }]}>
                          {confirmData.prorationData.nextBillDate.toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={styles.effectiveRow}>
                        <Text style={styles.effectiveLabel}>⚡ Changes take effect immediately</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.pricingRow}>
                        <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>Your next bill:</Text>
                        <Text style={styles.pricingAmount}>
                          {convertPrice(confirmData.prorationData.nextBillAmount).symbol}{convertPrice(confirmData.prorationData.nextBillAmount).amount}
                        </Text>
                      </View>
                      <View style={styles.pricingRow}>
                        <Text style={[styles.pricingLabel, { color: theme.textMuted }]}>Change effective date:</Text>
                        <Text style={[styles.pricingValue, { color: theme.text }]}>
                          {confirmData.prorationData.nextBillDate.toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={styles.effectiveRow}>
                        <Text style={styles.effectiveLabel}>📅 Changes take effect at next billing cycle</Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Action Buttons */}
                <View style={styles.modalButtonContainer}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={() => setShowConfirmModal(false)}
                  >
                    <Text style={[styles.modalCancelButtonText, { color: theme.textMuted }]}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalConfirmButton, submitting && styles.buttonDisabled]}
                    onPress={handleConfirmChange}
                    disabled={submitting}
                  >
                    <Text style={styles.modalConfirmButtonText}>
                      {submitting ? 'Processing…' : confirmData.isUpgrade ? 'Upgrade & Pay' : 'Confirm Change'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
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
