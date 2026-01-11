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
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optional; defaults to the repo's test key)

For convenience, see [mobile/.env.example](mobile/.env.example).

Examples:
- Staging (Render):
	- `EXPO_PUBLIC_LAMB_API_URL=https://lamb-backend-staging.onrender.com`
- Local (LAN):
	- `EXPO_PUBLIC_LAMB_API_URL=http://192.168.7.112:3001`

## Testing/Health
- Expo doctor: `npx expo-doctor`

## Notes
- Navigation: `@react-navigation/native` + native stack
- Storage: AsyncStorage helper in `src/storage.js`
- Placeholder screens live under `src/screens` (Home, Vault, Collection, Asset)
