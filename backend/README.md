# LAMB Stripe Payment Integration Guide

## Setup Instructions

### 1. Get Stripe API Keys
1. Sign up at https://stripe.com
2. Go to Developers > API Keys
3. Copy your Publishable Key and Secret Key

### 2. Update Mobile App Configuration
Edit `mobile/src/config/stripe.js`:
```javascript
export const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_KEY_HERE';
```

### 3. Setup Backend Server
```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` file and add your Stripe keys:
```
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

### 4. Start Backend Server
```bash
cd backend
npm start
```

Server will run on http://localhost:3001

### 5. Test the Integration
1. Start the mobile app: `cd mobile && npm run ios`
2. Sign up with a new account
3. Select a subscription plan
4. Use Stripe test card: `4242 4242 4242 4242`
5. Any future expiry date and any CVC

## Stripe Test Cards
- **Success**: 4242 4242 4242 4242
- **Declined**: 4000 0000 0000 0002
- **Requires Auth**: 4000 0025 0000 3155

Any future expiration date (e.g., 12/34)
Any 3-digit CVC

## Production Deployment

### Backend Hosting Options:
1. **Heroku**: Easy deployment, free tier available
2. **Railway**: Modern platform, simple setup
3. **AWS EC2**: More control, scalable
4. **DigitalOcean**: Affordable VPS hosting

### Security Checklist:
- [ ] Use environment variables for all keys
- [ ] Never commit .env files to git
- [ ] Enable HTTPS in production
- [ ] Verify webhook signatures
- [ ] Implement rate limiting
- [ ] Add authentication to endpoints
- [ ] Use Stripe's live keys (not test keys)

## Webhook Setup
1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://your-domain.com/webhook`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy webhook secret to `.env`

## API Endpoints

### POST /create-payment-intent
Creates a payment intent for subscription purchase
```json
{
  "amount": 249,
  "currency": "usd",
  "email": "user@example.com",
  "subscriptionTier": "basic"
}
```

### POST /webhook
Handles Stripe webhook events (payment success/failure)

### GET /health
Health check endpoint

## Next Steps
- Implement subscription management (cancel, upgrade, downgrade)
- Add recurring billing with Stripe Subscriptions
- Implement invoice generation
- Add customer portal for self-service
- Set up email notifications for payment events
