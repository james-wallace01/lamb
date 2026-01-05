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
- iOS Simulator: `npm run ios`
- Web (for quick checks): `npm run web`

## Testing/Health
- Expo doctor: `npx expo-doctor`

## Notes
- Navigation: `@react-navigation/native` + native stack
- Storage: AsyncStorage helper in `src/storage.js`
- Placeholder screens live under `src/screens` (Home, Vault, Collection, Asset)
