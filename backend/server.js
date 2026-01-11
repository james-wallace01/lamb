// LAMB Backend Server for Stripe Payment Processing
// Install dependencies: npm install express stripe cors dotenv
// Run: node server.js

const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = typeof stripeSecretKey === 'string' && stripeSecretKey.trim() ? require('stripe')(stripeSecretKey.trim()) : null;
const { initFirebaseAdmin, firebaseEnabled, requireFirebaseAuth } = require('./firebaseAdmin');
const firebaseAdmin = require('firebase-admin');

const app = express();

app.enable('trust proxy');

const enforceTls = String(process.env.ENFORCE_TLS).toLowerCase() === 'true' || process.env.NODE_ENV === 'production';
if (enforceTls) {
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const isSecure = req.secure || forwardedProto === 'https';
    if (isSecure) return next();
    return res.status(400).json({ error: 'TLS required' });
  });
}

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Email enumeration protection: keep this tighter than other auth-adjacent endpoints.
// This endpoint intentionally reveals whether an email exists, so we rate limit aggressively.
const emailAvailabilityRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(cors());

// Serve branded static images (used for default hero images on mobile).
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

const PORT = process.env.PORT || 3001;

const isStripeConfigured = () => !!stripe;

// Optional Firebase Admin initialization (used for verifying Firebase ID tokens)
initFirebaseAdmin();

// If Stripe isn't configured, still allow /health and /me so Firebase auth can be tested.
app.use((req, res, next) => {
  if (isStripeConfigured()) return next();
  if (req.path === '/health' || req.path === '/me' || req.path === '/public-config' || req.path === '/email-available') return next();
  return res.status(503).json({ error: 'Stripe is not configured on this server' });
});

app.get('/public-config', (req, res) => {
  res.json({
    stripePublishableKey: (process.env.STRIPE_PUBLISHABLE_KEY || '').trim() || null,
  });
});

const maybeRequireFirebaseAuth = (req, res, next) => {
  const requireAuth = process.env.NODE_ENV === 'production' || String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true';
  if (!requireAuth) return next();
  return requireFirebaseAuth(req, res, next);
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const assertStripeCustomerOwnedByFirebaseUser = async (customerId, firebaseUser) => {
  if (!customerId) return { ok: false, status: 400, error: 'Missing customerId' };
  if (!firebaseUser?.uid) return { ok: false, status: 401, error: 'Missing authenticated user' };

  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || customer.deleted) return { ok: false, status: 404, error: 'Stripe customer not found' };

  const uid = String(firebaseUser.uid);
  const tokenEmail = normalizeEmail(firebaseUser.email);

  const metaUid = typeof customer.metadata?.firebaseUid === 'string' ? customer.metadata.firebaseUid : '';
  const customerEmail = normalizeEmail(customer.email);

  const matchesUid = metaUid && metaUid === uid;
  const matchesEmail = tokenEmail && customerEmail && tokenEmail === customerEmail;

  if (matchesUid || matchesEmail) {
    // Best-effort: stamp ownership metadata for future strict checks.
    if (!matchesUid) {
      try {
        await stripe.customers.update(customerId, {
          metadata: {
            ...(customer.metadata || {}),
            firebaseUid: uid,
            firebaseEmail: tokenEmail || customerEmail || null,
          },
        });
      } catch {
        // ignore
      }
    }
    return { ok: true, customer };
  }

  return { ok: false, status: 403, error: 'Forbidden' };
};

// Stripe webhooks require the raw request body to validate signatures.
// This MUST be registered before express.json().
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Stripe is not configured on this server' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !String(secret).trim()) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not set' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe-Signature header' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, String(secret).trim());
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err?.message || 'invalid signature'}` });
  }

  try {
    switch (event.type) {
      // Subscription lifecycle
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        console.log('[stripe webhook]', event.type, {
          id: sub?.id,
          status: sub?.status,
          customer: sub?.customer,
          cancel_at_period_end: sub?.cancel_at_period_end,
          current_period_end: sub?.current_period_end,
        });
        break;
      }

      // Invoicing/payment status
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('[stripe webhook]', event.type, {
          id: invoice?.id,
          customer: invoice?.customer,
          subscription: invoice?.subscription,
          status: invoice?.status,
          paid: invoice?.paid,
        });
        break;
      }

      default:
        // Keep logs quiet for unhandled events.
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Error handling webhook:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// JSON parser for all non-webhook routes.
app.use(express.json());

// Email availability check used by the signup UI (runs before the user is authenticated).
// Note: This endpoint intentionally reveals whether an email exists. Keep the rate limit tight.
app.post('/email-available', emailAvailabilityRateLimiter, async (req, res) => {
  try {
    // Ensure intermediaries don't cache an email existence response.
    res.set('Cache-Control', 'no-store');
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'Missing email' });
    if (!firebaseEnabled()) {
      return res.status(503).json({ error: 'Firebase is not configured on this server' });
    }

    try {
      await firebaseAdmin.auth().getUserByEmail(email);
      return res.json({ available: false });
    } catch (err) {
      const code = err?.code ? String(err.code) : '';
      if (code === 'auth/user-not-found') {
        return res.json({ available: true });
      }
      console.error('Email availability check failed:', err?.message || err);
      return res.status(500).json({ error: 'Email check failed' });
    }
  } catch (error) {
    console.error('Email availability endpoint error:', error);
    return res.status(500).json({ error: 'Email check failed' });
  }
});

// Price amounts in cents
const PRICE_MAP = {
  BASIC: 249,
  PREMIUM: 499,
  PRO: 999
};

// Cache for Stripe Price IDs
let stripePriceIds = {};

// Initialize Stripe Products and Prices
async function initializeStripePrices() {
  try {
    if (!isStripeConfigured()) {
      console.warn('Skipping Stripe price initialization: STRIPE_SECRET_KEY is not set.');
      stripePriceIds = {};
      return;
    }
    console.log('Initializing Stripe products and prices...');
    
    for (const [tier, amount] of Object.entries(PRICE_MAP)) {
      const products = await stripe.products.search({
        query: `name:'LAMB ${tier} Plan'`,
      });

      let product;
      if (products.data.length > 0) {
        product = products.data[0];
      } else {
        product = await stripe.products.create({
          name: `LAMB ${tier} Plan`,
          description: `${tier} subscription plan`,
        });
      }

      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
      });

      let price;
      const existingPrice = prices.data.find(p => p.unit_amount === amount && p.recurring?.interval === 'month');
      
      if (existingPrice) {
        price = existingPrice;
      } else {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: amount,
          currency: 'usd',
          recurring: { interval: 'month' },
        });
      }

      stripePriceIds[tier] = price.id;
    }
    
    console.log('Stripe prices ready:', stripePriceIds);
  } catch (error) {
    console.error('Error initializing Stripe prices:', error);
  }
}

async function getOrCreateCustomer(email, name, firebaseUser) {
  const normalized = normalizeEmail(email);
  const customers = await stripe.customers.list({ email: normalized, limit: 1 });
  if (customers.data.length > 0) {
    const existing = customers.data[0];
    // Best-effort: stamp ownership metadata if we can.
    if (firebaseUser?.uid) {
      const uid = String(firebaseUser.uid);
      const metaUid = typeof existing.metadata?.firebaseUid === 'string' ? existing.metadata.firebaseUid : '';
      if (!metaUid || metaUid !== uid) {
        try {
          await stripe.customers.update(existing.id, {
            metadata: {
              ...(existing.metadata || {}),
              firebaseUid: uid,
              firebaseEmail: normalizeEmail(firebaseUser.email) || normalized || null,
            },
          });
        } catch {
          // ignore
        }
      }
    }
    return existing;
  }

  const metadata = firebaseUser?.uid
    ? { firebaseUid: String(firebaseUser.uid), firebaseEmail: normalizeEmail(firebaseUser.email) || normalized || null }
    : undefined;

  return await stripe.customers.create({ email: normalized, name, metadata });
}

// Signup flow: runs before the user has an ID token, so this endpoint must not require Firebase auth.
app.post('/create-subscription', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const tokenEmail = normalizeEmail(req.firebaseUser?.email);
    const email = tokenEmail || normalizeEmail(req.body?.email);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'LAMB User';
    const { subscriptionTier } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const customer = await getOrCreateCustomer(email, name, req.firebaseUser);
    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customer.id, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-11-20.acacia' }
    );

    // Collect a valid payment method up-front (no charge yet)
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { tier: subscriptionTier }
    });

    if (!setupIntent.client_secret) {
      throw new Error('Failed to create setup intent');
    }

    res.json({
      setupIntentClientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Signup flow: runs before the user has an ID token, so this endpoint must not require Firebase auth.
app.post('/start-trial-subscription', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { customerId, subscriptionTier, setupIntentId } = req.body;
    if (!customerId || !subscriptionTier || !setupIntentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent?.customer && String(setupIntent.customer) !== String(customerId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const paymentMethodId = setupIntent.payment_method;
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'No payment method found' });
    }

    // Set default payment method for future invoices
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: stripePriceIds[subscriptionTier] }],
      trial_period_days: 14,
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      metadata: { tier: subscriptionTier }
    });

    res.json({ subscriptionId: subscription.id });
  } catch (error) {
    console.error('Error starting trial subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/update-subscription', maybeRequireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, newSubscriptionTier } = req.body;
    console.log(`Updating subscription ${subscriptionId} to ${newSubscriptionTier}`);
    
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: stripePriceIds[newSubscriptionTier],
      }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'default_incomplete',
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription'
      },
      metadata: { tier: newSubscriptionTier }
    });

    if (updatedSubscription.latest_invoice) {
      let invoice = await stripe.invoices.retrieve(updatedSubscription.latest_invoice, {
        expand: ['payment_intent']
      });
      
      console.log(`Invoice status: ${invoice.status}, amount_due: ${invoice.amount_due}`);
      
      if (invoice.amount_due > 0) {
        // If invoice is in draft, we need to finalize it to get a payment intent
        // But we set collection_method to prevent automatic charge attempt
        if (invoice.status === 'draft') {
          console.log('Finalizing invoice with manual collection...');
          
          // Update invoice to prevent automatic charge
          await stripe.invoices.update(invoice.id, {
            collection_method: 'charge_automatically',
            auto_advance: false  // Prevents automatic payment attempt
          });
          
          // Now finalize to create payment intent
          invoice = await stripe.invoices.finalize(invoice.id);
          
          // Re-retrieve with payment_intent expanded
          invoice = await stripe.invoices.retrieve(invoice.id, {
            expand: ['payment_intent']
          });
        }
        
        if (invoice.payment_intent) {
          console.log(`Payment intent status: ${invoice.payment_intent.status}`);
          console.log(`Payment intent client_secret exists: ${!!invoice.payment_intent.client_secret}`);
          
          const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: subscription.customer },
            { apiVersion: '2024-11-20.acacia' }
          );
          
          return res.json({
            requiresPayment: true,
            clientSecret: invoice.payment_intent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customer: subscription.customer,
            invoiceId: invoice.id,
          });
        }
      }
    }

    console.log('No payment required for subscription update');
    res.json({ requiresPayment: false, subscriptionId: updatedSubscription.id });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/confirm-payment', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { invoiceId } = req.body;
    
    // Retrieve the invoice to get the payment intent
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['payment_intent']
    });

    if (req.firebaseUser?.uid) {
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    if (!invoice.payment_intent) {
      return res.json({ success: false, status: 'no_payment' });
    }
    
    const paymentIntent = invoice.payment_intent;
    
    console.log('Payment intent status:', paymentIntent.status, 'Invoice status:', invoice.status);
    
    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      // Payment succeeded, mark invoice as paid if needed
      if (invoice.status === 'open') {
        await stripe.invoices.pay(invoiceId);
      }
      return res.json({ success: true, status: 'succeeded' });
    }
    
    // Check for other statuses
    if (paymentIntent.status === 'processing') {
      return res.json({ success: false, status: 'processing' });
    }
    
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action') {
      return res.json({ success: false, status: 'requires_payment_method' });
    }
    
    // Payment failed or cancelled
    return res.json({ success: false, status: paymentIntent.status, error: 'Payment did not complete' });
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/confirm-subscription-payment', maybeRequireFirebaseAuth, authRateLimiter, async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    
    // Retrieve the subscription to get the latest invoice
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent']
    });

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    
    if (!subscription.latest_invoice) {
      return res.json({ success: false, status: 'no_invoice' });
    }
    
    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice.payment_intent;
    
    if (!paymentIntent) {
      return res.json({ success: false, status: 'no_payment_intent' });
    }
    
    console.log('Subscription payment intent status:', paymentIntent.status, 'Invoice status:', invoice.status);
    
    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      return res.json({ success: true, status: 'succeeded' });
    }
    
    // Check for other statuses
    if (paymentIntent.status === 'processing') {
      return res.json({ success: false, status: 'processing' });
    }
    
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'requires_action') {
      return res.json({ success: false, status: 'requires_payment_method' });
    }
    
    // Payment failed or cancelled
    return res.json({ success: false, status: paymentIntent.status, error: 'Payment did not complete' });
  } catch (error) {
    console.error('Error confirming subscription payment:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/schedule-subscription-change', maybeRequireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, newSubscriptionTier } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Missing subscriptionId' });
    }
    if (!newSubscriptionTier || !stripePriceIds[newSubscriptionTier]) {
      return res.status(400).json({ error: 'Invalid newSubscriptionTier' });
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    // Stripe allows only one schedule per subscription.
    // If the subscription already has a schedule, reuse it; otherwise create a new one.
    const existingScheduleId =
      (typeof subscription.schedule === 'string' && subscription.schedule) ||
      (typeof subscription.subscription_schedule === 'string' && subscription.subscription_schedule) ||
      null;

    const schedule = existingScheduleId
      ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
      : await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId });

    const phaseStart = schedule?.phases?.[0]?.start_date || Math.floor(Date.now() / 1000);
    const currentPriceId = subscription?.items?.data?.[0]?.price?.id;
    if (!currentPriceId) {
      return res.status(500).json({ error: 'Subscription is missing price information' });
    }

    const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: [{ price: currentPriceId }],
          start_date: phaseStart,
          end_date: subscription.current_period_end,
        },
        {
          items: [{ price: stripePriceIds[newSubscriptionTier] }],
          start_date: subscription.current_period_end,
        },
      ],
      end_behavior: 'release',
    });

    res.json({
      scheduleId: updatedSchedule.id,
      changeDate: new Date(subscription.current_period_end * 1000),
    });
  } catch (error) {
    console.error('Error scheduling subscription change:', error);
    res.status(500).json({ error: error?.message || 'Failed to schedule subscription change' });
  }
});

app.post('/cancel-subscription', maybeRequireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const { subscriptionId, immediate } = req.body;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    if (req.firebaseUser?.uid) {
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customerId, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }

    if (immediate) {
      const canceled = await stripe.subscriptions.cancel(subscriptionId);
      res.json({ subscriptionId: canceled.id, status: 'canceled' });
    } else {
      const updated = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      res.json({ 
        subscriptionId: updated.id, 
        status: 'canceling',
        cancelAt: new Date(updated.current_period_end * 1000)
      });
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-payment-intent', maybeRequireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    const { amount, currency, subscriptionTier } = req.body;
    const tokenEmail = normalizeEmail(req.firebaseUser?.email);
    const email = tokenEmail || normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const customer = await getOrCreateCustomer(email, 'LAMB User', req.firebaseUser);
    if (req.firebaseUser?.uid) {
      const ownership = await assertStripeCustomerOwnedByFirebaseUser(customer.id, req.firebaseUser);
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error });
    }
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-11-20.acacia' }
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: { subscriptionTier },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    stripe: isStripeConfigured() ? 'configured' : 'not_configured',
    stripePrices: stripePriceIds,
    firebase: firebaseEnabled() ? 'enabled' : 'disabled',
    requireFirebaseAuth: String(process.env.REQUIRE_FIREBASE_AUTH).toLowerCase() === 'true',
  });
});

// Server-side subscription validation/sync.
// Requires a Firebase ID token and uses Stripe as the source of truth.
app.post('/subscription-status', requireFirebaseAuth, sensitiveRateLimiter, async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured on this server' });
    }

    const { subscriptionId, customerId } = req.body || {};
    if (!subscriptionId && !customerId) {
      return res.status(400).json({ error: 'Missing subscriptionId or customerId' });
    }

    const loadSubscription = async () => {
      if (subscriptionId) {
        return await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price', 'customer'],
        });
      }

      // Fallback: pick the most relevant subscription for the customer.
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 50,
        expand: ['data.items.data.price'],
      });

      const ranked = (subs.data || []).slice().sort((a, b) => {
        const score = (s) => {
          const status = s?.status;
          if (status === 'active') return 5;
          if (status === 'trialing') return 4;
          if (status === 'past_due') return 3;
          if (status === 'unpaid') return 2;
          if (status === 'canceled') return 1;
          return 0;
        };
        const byScore = score(b) - score(a);
        if (byScore !== 0) return byScore;
        return (b?.created || 0) - (a?.created || 0);
      });

      return ranked[0] || null;
    };

    const subscription = await loadSubscription();
    if (!subscription) {
      return res.json({
        ok: true,
        subscription: null,
      });
    }

    const derivedTier = (() => {
      const metaTier = subscription?.metadata?.tier;
      if (metaTier && typeof metaTier === 'string') return metaTier.toUpperCase();

      const priceId = subscription?.items?.data?.[0]?.price?.id || subscription?.items?.data?.[0]?.price;
      if (!priceId) return null;
      const match = Object.entries(stripePriceIds || {}).find(([, id]) => id === priceId);
      return match ? match[0] : null;
    })();

    res.json({
      ok: true,
      subscription: {
        id: subscription.id,
        customer: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        status: subscription.status,
        tier: derivedTier,
        cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
        currentPeriodStartMs: subscription.current_period_start ? subscription.current_period_start * 1000 : null,
        currentPeriodEndMs: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
      },
    });
  } catch (error) {
    console.error('Error validating subscription status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Convenience: Render service root should respond in-browser.
app.get('/', (req, res) => {
  res.redirect('/health');
});

// Simple endpoint to validate Firebase auth wiring.
app.get('/me', requireFirebaseAuth, (req, res) => {
  res.json({ uid: req.firebaseUser?.uid, email: req.firebaseUser?.email || null });
});

// Dangerous cleanup endpoints are disabled by default.
// Use the CLI script instead: `npm run wipe-remote`.
if (String(process.env.ENABLE_STRIPE_CLEANUP_ENDPOINTS).toLowerCase() === 'true') {
  // Get all subscriptions for cleanup
  app.get('/all-subscriptions', async (req, res) => {
    try {
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        status: 'all'
      });
      
      res.json({
        total: subscriptions.data.length,
        subscriptions: subscriptions.data.map(sub => ({
          id: sub.id,
          customer: sub.customer,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000),
          items: sub.items.data.map(item => ({
            price: item.price.id,
            quantity: item.quantity
          }))
        }))
      });
    } catch (error) {
      console.error('Error listing subscriptions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel all test subscriptions
  app.post('/cleanup-subscriptions', async (req, res) => {
    try {
      console.log('Starting subscription cleanup...');
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        status: 'all'
      });
      
      const canceled = [];
      const errors = [];
      
      for (const sub of subscriptions.data) {
        try {
          if (sub.status !== 'canceled') {
            console.log(`Canceling subscription ${sub.id}...`);
            await stripe.subscriptions.cancel(sub.id);
            canceled.push(sub.id);
          }
        } catch (error) {
          errors.push({ subscriptionId: sub.id, error: error.message });
        }
      }
      
      // Delete test customers
      const customers = await stripe.customers.list({
        limit: 100
      });
      
      const deletedCustomers = [];
      for (const customer of customers.data) {
        try {
          console.log(`Deleting customer ${customer.id}...`);
          await stripe.customers.del(customer.id);
          deletedCustomers.push(customer.id);
        } catch (error) {
          // Some customers may have active subscriptions, that's okay
          console.log(`Could not delete customer ${customer.id}: ${error.message}`);
        }
      }
      
      res.json({
        message: 'Cleanup completed',
        canceledSubscriptions: canceled,
        deletedCustomers: deletedCustomers,
        errors: errors
      });
    } catch (error) {
      console.error('Error during cleanup:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

async function startServer() {
  await initializeStripePrices();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
