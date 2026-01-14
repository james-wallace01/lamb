# LAMB Backend

This backend uses Apple In-App Purchases for subscription verification.

## Apple IAP receipt verification

The mobile app calls `POST /iap/verify` with Apple receipt data. The backend verifies the receipt with Apple and upserts the authenticated user’s document in `userSubscriptions/{uid}`.

Required env var:

```
APPLE_IAP_SHARED_SECRET=your_app_store_connect_shared_secret
```

## Setup Backend Server
```bash
cd backend
npm install
cp .env.example .env
```

### Start Backend Server
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

### 3) (Optional) Require Firebase auth for protected endpoints
Set:
```
REQUIRE_FIREBASE_AUTH=true
```

When enabled, the backend expects an `Authorization: Bearer <Firebase_ID_Token>` header.

### 4) Test Firebase token verification
Once configured, you can hit:
- `GET /me` with `Authorization: Bearer <token>` to verify the server is validating tokens.

### 5) Test the Integration
1. Start the mobile app: `cd mobile && npm run ios`
2. Sign up with a new account
3. Select a membership plan
4. Complete an Apple subscription purchase in the iOS sandbox
5. The app will call `POST /iap/verify` and your `userSubscriptions/{uid}` doc should update

## Remote Data Wipe (DANGEROUS)

This repo includes a CLI script to wipe *remote* account data in Firebase Auth.

It is **dry-run by default** and requires explicit confirmations to actually delete anything.

### What it deletes
- **Firebase Auth:** deletes all Firebase Auth users in the Firebase project configured for Admin SDK

### Dry run
```bash
cd backend
npm run wipe-remote
```

### Execute
```bash
cd backend
REMOTE_WIPE_CONFIRM=DELETE_ALL_REMOTE_DATA \
ALLOW_FIREBASE_WIPE=true \
npm run wipe-remote -- --execute
```

### Notes
- You can limit scope/size:
  - `--scope firebase` (default `firebase`)
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

## Maintenance Scripts (Firebase Admin required)

These scripts help manage data lifecycle and keep Firestore collections bounded.

All scripts require Firebase Admin credentials (see **Firebase (optional)** above).

### Prune invitations
Deletes invitation docs older than a retention window (default 30 days).

```bash
cd backend
npm run prune-invitations -- --dry-run
npm run prune-invitations -- --days 30
```

Env var: `INVITATIONS_RETENTION_DAYS`

### Prune daily usage docs
Deletes `stats/dailyUsage_YYYY-MM-DD` docs older than a retention window (default 90 days).

```bash
cd backend
npm run prune-daily-usage -- --dry-run
npm run prune-daily-usage -- --days 90
```

Env var: `DAILY_USAGE_RETENTION_DAYS`

### Prune audit events
Deletes per-vault `auditEvents` older than tier-based retention:
- BASIC: 30 days
- PREMIUM: 180 days
- PRO: 365 days

```bash
cd backend
npm run prune-audit-events -- --dry-run

# Override retention for all vaults
npm run prune-audit-events -- --days 90

# Limit how many vaults to scan (useful for testing)
npm run prune-audit-events -- --vault-limit 10
```

Env var: `PRUNE_AUDIT_VAULT_LIMIT`

### Scheduling (Render)

If you deploy with Render, this repo includes sample cron job definitions in [render.yaml](../render.yaml) that run the prune scripts daily and usage reconciliation weekly.

Notes:
- Cron jobs need Firebase Admin credentials, so ensure `FIREBASE_SERVICE_ACCOUNT_JSON` is set for the cron service in Render.
- The blueprint defines both **staging** and **production** services with the same setup.

## Paid Owner Invitations

The backend exposes a minimal invitation flow that writes canonical Firestore docs:

- `POST /vaults/:vaultId/invitations` (Firebase auth required)
  - Owner-only, paid-vault only
  - Body: `{ "email": "invitee@example.com" }`
  - Returns an invite `code`
  - If email is configured on the backend, also sends an email to the invitee with the invite code.

- `GET /vaults/:vaultId/invitations` (Firebase auth required)
  - Owner-only, paid-vault only
  - Returns up to 50 most recent invitations

- `POST /invitations/accept` (Firebase auth required)
  - Body: `{ "code": "<invite code>" }`
  - Creates `/vaults/{vaultId}/memberships/{uid}` as `DELEGATE` and marks the invitation accepted

## Email notifications (optional)

Some notifications are intentionally sent from the backend (instead of clients) so we don't expose a global user directory and so delivery is reliable.

Supported providers:
- SendGrid (recommended on Render)
- SMTP

Configure via environment variables in [backend/.env.example](backend/.env.example):
- `EMAIL_PROVIDER=sendgrid|smtp|none`
- `EMAIL_FROM="LAMB <no-reply@yourdomain.com>"`
- `ADMIN_ALERT_EMAIL=ops@yourdomain.com` (optional; receives webhook/email failure alerts)

### Notification categories + preferences

Users opt in/out by **category** (not individual events). The backend enforces mandatory categories.

Categories:
- `billing` (mandatory; owners only)
- `security` (mandatory)
- `accessChanges`
- `destructiveActions`
- `structuralChanges`
- `activityDigest`

Firestore storage:
- `notificationSettings/{uid}`
  - `emailEnabled: boolean` (disables optional categories only)
  - `categories: { [category]: boolean }` (optional overrides)
  - `digestFrequency: "daily" | "weekly"`

API endpoints (Firebase auth required):
- `GET /notification-settings`
- `PUT /notification-settings`
  - Body: `{ "emailEnabled": true|false, "digestFrequency": "daily"|"weekly", "categories": { "accessChanges": true|false, ... } }`
  - `billing` and `security` cannot be disabled by clients.

### Idempotency + audit linkage

Email delivery is designed to be idempotent:
- Security notification endpoints require a client-provided `eventId` so retries do not re-send:
  - `POST /notifications/username-changed` body: `{ "eventId": "...", "oldUsername": "...", "newUsername": "..." }`
  - `POST /notifications/password-changed` body: `{ "eventId": "..." }`

Every attempted email writes an `emailEvents/{id}` document that includes an `audit_event_id` reference.

For SendGrid:
- `SENDGRID_API_KEY=...`

For SMTP:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`

Additional authenticated notification endpoints:
- `POST /notifications/username-changed` (Firebase auth required)
  - Body: `{ "oldUsername": "old", "newUsername": "new" }`
- `POST /notifications/password-changed` (Firebase auth required)

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

This is triggered when subscription status is updated on the server (e.g. via `POST /iap/verify`).

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
- `FIREBASE_SERVICE_ACCOUNT_JSON`
  - Recommended: paste **base64(JSON)** of your Firebase service account key.
  - On macOS you can generate it with:
    - `base64 -i /absolute/path/to/serviceAccountKey.json | tr -d '\n'`
- `REQUIRE_FIREBASE_AUTH=true` (recommended)
- `APPLE_IAP_SHARED_SECRET` (required for iOS receipt verification)

Note: for Render you generally *don't* use `GOOGLE_APPLICATION_CREDENTIALS` because you don't have a stable file path on disk.

### Security Checklist:
- [ ] Use environment variables for all keys
- [ ] Never commit .env files to git
- [ ] Enable HTTPS in production
- [ ] Verify Apple receipts server-side
- [ ] Implement rate limiting
- [ ] Add authentication to endpoints

## API Endpoints

### POST /iap/verify
Verifies an iOS subscription receipt with Apple and upserts `userSubscriptions/{uid}`.

### GET /health
Health check endpoint

## Next Steps
- Consider adding Apple Server Notifications (optional) for near real-time subscription updates
- Keep weekly usage reconciliation + retention pruning jobs running in Render
