const getPublicEnv = (key, fallback) => {
	try {
		const v = typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
		return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
	} catch {
		return fallback;
	}
};

// Backend API endpoint for creating payment intents
// Replace with your actual backend URL
export const API_URL = getPublicEnv('EXPO_PUBLIC_LAMB_API_URL', 'https://lamb-backend-staging.onrender.com');

// Shown in Stripe PaymentSheet.
export const STRIPE_MERCHANT_DISPLAY_NAME = 'LAMB';

// Apple Pay merchant identifier (must match your Apple Developer Merchant ID and Expo plugin config).
export const APPLE_PAY_MERCHANT_ID = 'merchant.com.lamb';

// Apple Pay country code (ISO 3166-1 alpha-2). Keep simple unless you support multiple regions.
export const APPLE_PAY_COUNTRY_CODE = getPublicEnv('EXPO_PUBLIC_APPLE_PAY_COUNTRY_CODE', 'US');

export async function fetchStripePublishableKey() {
	const url = `${API_URL}/public-config`;
	const res = await fetch(url);
	if (!res.ok) {
		// Dev-only escape hatch: allow local development to proceed even if the backend
		// hasn't been redeployed with /public-config yet.
		const devFallback = getPublicEnv('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
		if (typeof __DEV__ !== 'undefined' && __DEV__ && devFallback) {
			return devFallback;
		}
		throw new Error(`Failed to load public config (${res.status}) at ${url}`);
	}
	const json = await res.json();
	const key = typeof json?.stripePublishableKey === 'string' ? json.stripePublishableKey.trim() : '';
	if (!key) {
		const devFallback = getPublicEnv('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
		if (typeof __DEV__ !== 'undefined' && __DEV__ && devFallback) {
			return devFallback;
		}
		throw new Error('Missing STRIPE_PUBLISHABLE_KEY on backend');
	}
	return key;
}
