import { getFirebaseIdToken } from '../firebase';

export async function apiFetch(url, options = {}) {
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

  const token = await getFirebaseIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}
