# LAMB Stripe Payment Integration Guide

## Setup Instructions

### 1. Get Stripe API Keys
1. Sign up at https://stripe.com
2. Go to Developers > API Keys
3. Copy your Publishable Key and Secret Key

Important:
- Never commit keys to git.
- Don’t paste secret keys into chat.

### 2. Update Mobile App Configuration
The mobile app loads the Stripe publishable key at runtime from the backend (`GET /public-config`).

Set the key on the backend via env var:
```
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
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
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

### 4. Start Backend Server
```bash
cd backend
npm start
```

Server will run on http://localhost:3001 (for local development).

For production deployments, terminate TLS at the edge and set `ENFORCE_TLS=true` to reject non-HTTPS requests (based on `X-Forwarded-Proto`).

## CORS (browser access)

This API is primarily consumed by the native mobile app (which is not restricted by browser CORS).

- In production, if you do **not** set `CORS_ORIGINS`, the server will **block any request that includes an `Origin` header**. This prevents arbitrary websites from calling your API in a browser context.
- If you *do* need browser access, set `CORS_ORIGINS` to a comma-separated list of allowed origins.

Example:

`CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com`

## Firebase (optional)

This backend can optionally use Firebase Admin to verify Firebase ID tokens.

### 1) Create a Firebase project
- Firebase Console → create/select your project
- Project settings → Service accounts → generate a new private key (JSON)

### 2) Provide credentials to the backend
Choose ONE option in [backend/.env](backend/.env):

- **Option A (recommended locally):** point to the service account JSON file
  - Set `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/serviceAccountKey.json`

- **Option B:** paste credentials as JSON or base64(JSON)
  - Set `FIREBASE_SERVICE_ACCOUNT_JSON=...`

- **Option C:** split env vars
  - `FIREBASE_PROJECT_ID=...`
  - `FIREBASE_CLIENT_EMAIL=...`
  - `FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`

### 3) (Optional) Require Firebase auth for Stripe endpoints
Set:
```
REQUIRE_FIREBASE_AUTH=true
```

When enabled, the backend expects an `Authorization: Bearer <Firebase_ID_Token>` header.

### 4) Test Firebase token verification
Once configured, you can hit:
- `GET /me` with `Authorization: Bearer <token>` to verify the server is validating tokens.

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

## Remote Data Wipe (DANGEROUS)

This repo includes a CLI script to wipe *remote* account data in the configured services (Stripe + Firebase Auth).

It is **dry-run by default** and requires explicit confirmations to actually delete anything.

### What it deletes
- **Stripe:** cancels all subscriptions, deletes all customers (for the Stripe account configured by `STRIPE_SECRET_KEY`)
- **Firebase Auth:** deletes all Firebase Auth users in the Firebase project configured for Admin SDK

### Dry run
```bash
cd backend
npm run wipe-remote
```

### Execute (test mode Stripe recommended)
```bash
cd backend
REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA \
ALLOW_FIREBASE_WIPE=true \
npm run wipe-remote -- --execute
```

### Notes
- The script **refuses to wipe Stripe live keys** unless you also set:
  - `ALLOW_LIVE_STRIPE_WIPE=true`
  - `LIVE_STRIPE_WIPE_CONFIRM=I_KNOW_THIS_IS_LIVE`
- You can limit scope/size:
  - `--scope stripe|firebase|all` (default `all`)
  - `--limit N`

## Firestore Vault Model Migration (DANGEROUS)

This repo includes a one-time admin script that migrates legacy vault sharing + per-user subscriptions into the canonical Firestore model:

- `/vaults/{vaultId}/memberships/{uid}` becomes the sole source of truth for roles (`OWNER | DELEGATE`).
- `vault.activeOwnerId` is normalized (exactly one active owner).
- Legacy `users/{uid}.subscription` is moved to `/vaultSubscriptions/{primaryVaultId}` where `primaryVaultId` is the earliest-created vault owned by that user.

The script is **dry-run by default**.

### Prereqs
- Firebase Admin credentials must be configured (see the **Firebase (optional)** section above).

### Dry run
```bash
cd backend
npm run migrate-vault-model
```

### Execute
```bash
cd backend
MIGRATE_CONFIRM=I_UNDERSTAND npm run migrate-vault-model -- --execute
```

### Options
- `--scope vaults|memberships|subscriptions|all` (default `all`)
- `--limit N`

### Notes
- When executing, the script will also clear legacy `vault.sharedWith` arrays to avoid dual sources of truth.
- Run this against a backup / test project first.

## Deploy Firestore Rules

Canonical authorization is enforced by Firestore Security Rules in the repo root at [firestore.rules](../firestore.rules).

To deploy rules, use the Firebase CLI from the repo root (recommended):

```bash
npm i -g firebase-tools
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:rules
```

If you prefer to run without a global install:

```bash
npx firebase-tools login
npx firebase-tools use <your-project-id>
npx firebase-tools deploy --only firestore:rules
```

## Paid Owner Invitations

The backend exposes a minimal invitation flow that writes canonical Firestore docs:

- `POST /vaults/:vaultId/invitations` (Firebase auth required)
  - Owner-only, paid-vault only
  - Body: `{ "email": "invitee@example.com" }`
  - Returns an invite `code`

- `GET /vaults/:vaultId/invitations` (Firebase auth required)
  - Owner-only, paid-vault only
  - Returns up to 50 most recent invitations

- `POST /invitations/accept` (Firebase auth required)
  - Body: `{ "code": "<invite code>" }`
  - Creates `/vaults/{vaultId}/memberships/{uid}` as `DELEGATE` and marks the invitation accepted

## Hard Ops (Owner-only)

Some operations cannot be safely performed client-side due to Firestore rule constraints (e.g. recursive deletion) or cross-vault moves.

- `POST /vaults/:vaultId/delete` (Firebase auth required)
  - Owner-only
  - Body: `{ "confirm": "DELETE" }`
  - Recursively deletes subcollections (`assets`, `collections`, `memberships`, `permissionGrants`, `invitations`, `auditEvents`) and then deletes the vault doc.

- `POST /vaults/:vaultId/assets/:assetId/move` (Firebase auth required)
  - Owner-only on BOTH source and destination vaults
  - Body: `{ "targetVaultId": "...", "targetCollectionId": "..." }`
  - Copies the asset to the target vault and deletes the source asset.

- `POST /vaults/:vaultId/collections/:collectionId/move` (Firebase auth required)
  - Owner-only on BOTH source and destination vaults
  - Body: `{ "targetVaultId": "..." }`
  - Copies the collection and moves its assets to the target vault.

## Downgrade cleanup (paid → unpaid)

When a vault transitions from a paid status (`active|trialing|past_due`) to an unpaid status, the backend will automatically clean up paid-only data:

- Revokes active `DELEGATE` memberships
- Deletes `permissionGrants`
- Revokes pending invitations

This is triggered during Stripe webhook subscription sync.

## Production Deployment

### Backend Hosting Options:
1. **Heroku**: Easy deployment, free tier available
2. **Railway**: Modern platform, simple setup
3. **AWS EC2**: More control, scalable
4. **DigitalOcean**: Affordable VPS hosting

## Staging on Render (recommended)

This repo includes a Render Blueprint at [render.yaml](render.yaml) that deploys the backend as a Render Web Service.

### 1) Create the Render service
1. Push your repo to GitHub.
2. In Render: **New** → **Blueprint** → select your repo.
3. Render will detect [render.yaml](render.yaml) and create `lamb-backend-staging`.

### 2) Set environment variables in Render
In Render → your service → **Environment**, set:
- `STRIPE_SECRET_KEY` (test secret key, starts with `sk_test_...`)
- `STRIPE_PUBLISHABLE_KEY` (publishable key, starts with `pk_test_...`)
- `STRIPE_WEBHOOK_SECRET` (starts with `whsec_...`)
- `FIREBASE_SERVICE_ACCOUNT_JSON`
  - Recommended: paste **base64(JSON)** of your Firebase service account key.
  - On macOS you can generate it with:
    - `base64 -i /absolute/path/to/serviceAccountKey.json | tr -d '\n'`
- `REQUIRE_FIREBASE_AUTH=true` (recommended)

Note: for Render you generally *don't* use `GOOGLE_APPLICATION_CREDENTIALS` because you don't have a stable file path on disk.

### 3) Add the Stripe webhook (Test mode)
Stripe Dashboard (Test mode) → **Developers** → **Webhooks** → **Add endpoint**
- Endpoint URL: `https://YOUR-RENDER-SERVICE.onrender.com/webhook`
- Select events (recommended for subscriptions):
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

After creating the endpoint, copy its **Signing secret** (`whsec_...`) into Render as `STRIPE_WEBHOOK_SECRET`.

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
3. Select events (recommended for subscriptions):
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
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
