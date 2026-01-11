import { getFirebaseIdToken } from '../firebase';

export async function apiFetch(url, options = {}) {
  const requireAuth = !!options?.requireAuth;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const allowInsecureHttp = String(
    (typeof process !== 'undefined' && process?.env ? process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP : '') || ''
  ).toLowerCase() === 'true';

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && !allowInsecureHttp) {
      throw new Error(`Insecure HTTP is blocked: ${parsed.origin}`);
    }
  } catch {
    // If parsing fails (unexpected/relative URL), fall through and let fetch handle it.
  }

  const headers = { ...(options.headers || {}) };

  let token = await getFirebaseIdToken();
  if (requireAuth && !token) {
    // Firebase persistence can hydrate asynchronously on cold start/resume.
    // Briefly retry so we don't force-log-out active users due to a transient null currentUser.
    for (let i = 0; i < 6 && !token; i += 1) {
      // 0ms, 150ms, 300ms, ... up to ~750ms total delay
      // (kept short to avoid UI feeling stuck)
      await sleep(i === 0 ? 0 : 150);
      token = await getFirebaseIdToken();
    }
  }
  if (requireAuth && !token) {
    throw new Error('Session expired. Please sign in with your password.');
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Strip non-fetch option keys.
  const { requireAuth: _requireAuth, ...fetchOptions } = options || {};
  return fetch(url, { ...fetchOptions, headers });
}
