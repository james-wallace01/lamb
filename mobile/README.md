# LAMB Mobile (Expo)

React Native (Expo) client for LAMB. iOS-focused, no offline mode.

## Hosted testing (no more `npm run ios`)

iOS apps can’t be “hosted” like a website. To test without running Xcode/Simulator locally, you normally distribute an installable build:
- **iOS:** TestFlight (recommended) or internal/ad-hoc distribution
- **Android:** internal APK/AAB distribution

This repo includes a minimal EAS configuration in [mobile/eas.json](mobile/eas.json).

### Option A: TestFlight (recommended)
Prereqs: Apple Developer account + App Store Connect access.

1) Install EAS CLI and log in:
- `npm i -g eas-cli`
- `eas login`

2) From the `mobile/` folder, configure EAS for this project (one-time):
- `eas build:configure`

3) Build an iOS “store” build and submit to TestFlight:
- `eas build -p ios --profile production`
- `eas submit -p ios --profile production --latest`

4) Invite testers in App Store Connect → TestFlight.

### Option B: Internal distribution (quick installs)
This produces an installable build you can share directly (not via TestFlight).
- `eas build -p ios --profile preview`

### Optional: Over-the-air JS updates (no reinstall)
After testers have a build installed, you can ship JS-only updates with EAS Update:
- `eas update --branch production --message "Describe change"`

## Prerequisites
- Node 18+
- Xcode + iOS Simulator (for `npm run ios`)
- Expo CLI (installed via npm on first run)

## Install
```
npm install
```

## Run

## Backend environment (local vs staging)

The app reads these Expo public environment variables:
- `EXPO_PUBLIC_LAMB_API_URL`

For convenience, see [mobile/.env.example](mobile/.env.example).

Examples:
- Staging (Render):
	- `EXPO_PUBLIC_LAMB_API_URL=https://lamb-backend-staging.onrender.com`

Notes:
- The mobile app enforces HTTPS-only networking and iOS App Transport Security is configured to disallow HTTP.
- For local development against a local backend, use an HTTPS tunnel (e.g. ngrok/cloudflared) or run your local backend behind HTTPS.

## Apple + Google sign-in

The app supports signing in with Apple and Google via Firebase Auth.

### Firebase console setup
- Enable **Apple** and **Google** providers in Firebase Console → Authentication → Sign-in method.
- Apple requires Apple Developer configuration (Sign in with Apple capability + keys). Google requires OAuth client IDs.

### Expo env vars (Google)

Set one or more of these Expo public environment variables:
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

If none are set, the app will show “Google sign-in is not configured for this build.”

### Expo Go vs builds
- **Apple Sign In** only appears on iOS.
- For production behavior, prefer an EAS build (TestFlight / internal distribution). OAuth credentials typically require a real iOS bundle ID + Android package name.

## Testing/Health
- Expo doctor: `npx expo-doctor`

## Notes
- Navigation: `@react-navigation/native` + native stack
- Storage: AsyncStorage helper in `src/storage.js`
- Placeholder screens live under `src/screens` (Home, Vault, Collection, Asset)
