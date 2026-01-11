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
- A starter rules template is in [firestore.rules](firestore.rules). It currently denies all access until you customize it.

- `.env*` files are gitignored; add mobile-specific vars under `mobile/.env` if needed.
