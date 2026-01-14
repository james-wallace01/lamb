// Apple In-App Purchase product identifiers.
// These must match the products you create in App Store Connect.

export const IAP_PRODUCTS = Object.freeze({
	BASIC_MONTHLY: 'com.lamb.basic.monthly',
	PREMIUM_MONTHLY: 'com.lamb.premium.monthly',
	PRO_MONTHLY: 'com.lamb.pro.monthly',
	BASIC_ANNUAL: 'com.lamb.basic.annual',
	PREMIUM_ANNUAL: 'com.lamb.premium.annual',
	PRO_ANNUAL: 'com.lamb.pro.annual',
});

export const IAP_SUBSCRIPTION_PRODUCT_IDS = Object.freeze([
	IAP_PRODUCTS.BASIC_MONTHLY,
	IAP_PRODUCTS.PREMIUM_MONTHLY,
	IAP_PRODUCTS.PRO_MONTHLY,
	IAP_PRODUCTS.BASIC_ANNUAL,
	IAP_PRODUCTS.PREMIUM_ANNUAL,
	IAP_PRODUCTS.PRO_ANNUAL,
]);

export const tierForProductId = (productId) => {
	const id = String(productId || '');
	if (id.includes('.basic.')) return 'BASIC';
	if (id.includes('.premium.')) return 'PREMIUM';
	if (id.includes('.pro.')) return 'PRO';
	return null;
};

export const intervalForProductId = (productId) => {
	const id = String(productId || '');
	if (id.endsWith('.annual')) return 'year';
	if (id.endsWith('.monthly')) return 'month';
	return null;
};
