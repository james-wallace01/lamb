# lamb
Liquid Asset Management Board

## Repo layout

## Versioning

## Mobile setup
1) Install: `cd mobile && npm install`
2) iOS simulator: `npm run ios`
3) Physical device (more reliable QR): `npm run tunnel` (or `npx expo start --tunnel`) and scan with Expo Go
4) Health check: `npm run doctor`
5) Stop Metro when done: Ctrl+C

## Web (CRA) setup

1) Install: `npm install`
2) Configure env vars (CRA only reads `REACT_APP_*` at build time):

Create `.env.local` in repo root:

```bash
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=...
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...

# Backend base URL for hard ops (vault delete, cross-vault moves)
REACT_APP_API_URL=http://localhost:3001
```

3) Run: `npm start`

Notes:
- The web app uses Firebase Auth + Firestore directly; Firestore Security Rules are the canonical auth layer.
- Some operations are intentionally routed through the backend (recursive delete, cross-vault moves) and require `REACT_APP_API_URL`.

## Firebase (mobile + backend)

### Mobile
- Firebase client SDK is installed in the Expo app.
- Fill in the Firebase web config in [mobile/src/config/firebase.js](mobile/src/config/firebase.js) from Firebase Console → Project settings → Your apps → Firebase SDK snippet.
- Stripe/backend calls now use an authenticated fetch wrapper that will attach `Authorization: Bearer <Firebase ID token>` when a Firebase user is signed in.

### Backend
- Firebase Admin is configured in [backend/server.js](backend/server.js) and [backend/firebaseAdmin.js](backend/firebaseAdmin.js).
- Set credentials via `GOOGLE_APPLICATION_CREDENTIALS` (recommended) or `FIREBASE_SERVICE_ACCOUNT_JSON` as described in [backend/README.md](backend/README.md).
- To require auth on Stripe endpoints, set `REQUIRE_FIREBASE_AUTH=true` in `backend/.env`.

### Firestore Rules
- Canonical Firestore authorization is defined in [firestore.rules](firestore.rules) (vault membership, permissions, paid gating, single active owner).
- Deploy rules via the Firebase CLI (e.g. firebase deploy --only firestore:rules) for them to take effect.

- `.env*` files are gitignored; add mobile-specific vars under `mobile/.env` if needed.
