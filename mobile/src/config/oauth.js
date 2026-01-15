const val = (v) => (typeof v === 'string' ? v.trim() : '');

export const GOOGLE_IOS_CLIENT_ID = val(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
export const GOOGLE_ANDROID_CLIENT_ID = val(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);
export const GOOGLE_WEB_CLIENT_ID = val(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

export const isGoogleOAuthConfigured = () => {
  // In Expo Go with the proxy you can sometimes get away with only a web client id.
  // For production builds you typically want platform-specific IDs.
  return !!(GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID);
};
