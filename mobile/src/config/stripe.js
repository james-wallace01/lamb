// Stripe Configuration
// For production, use environment variables or secure storage

const getPublicEnv = (key, fallback) => {
	try {
		const v = typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
		return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
	} catch {
		return fallback;
	}
};

export const STRIPE_PUBLISHABLE_KEY = getPublicEnv(
	'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
	'pk_test_51SmPtKGfJUDcxcWzCZGOUyiTBNTgmC8zJjYmIJncmez9g1O8mJODJexNhVOJdWZQsxFhF9qIFbniQqVGzlThCAL700j1BKEQeK'
);

// Backend API endpoint for creating payment intents
// Replace with your actual backend URL
export const API_URL = getPublicEnv('EXPO_PUBLIC_LAMB_API_URL', 'https://lamb-backend-staging.onrender.com');

export const STRIPE_MERCHANT_NAME = 'LAMB';
