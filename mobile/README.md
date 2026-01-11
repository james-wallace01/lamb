# LAMB Mobile (Expo)

React Native (Expo) client for LAMB. iOS-focused, no offline mode.

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
