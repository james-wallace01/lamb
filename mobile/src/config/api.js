const getPublicEnv = (key, fallback) => {
	try {
		const v = typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
		return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
	} catch {
		return fallback;
	}
};

// Backend API base URL
export const API_URL = getPublicEnv('EXPO_PUBLIC_LAMB_API_URL', 'https://lamb-backend-staging.onrender.com');
