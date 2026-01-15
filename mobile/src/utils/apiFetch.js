import { getFirebaseIdToken } from '../firebase';

export async function apiFetch(url, options = {}) {
  const requireAuth = !!options?.requireAuth;
  const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 12000;

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
  const { requireAuth: _requireAuth, timeoutMs: _timeoutMs, ...fetchOptions } = options || {};

  const canAbort = typeof AbortController !== 'undefined';
  const hasSignal = !!fetchOptions?.signal;
  const controller = !hasSignal && canAbort && timeoutMs > 0 ? new AbortController() : null;
  const signal = hasSignal ? fetchOptions.signal : controller?.signal;

  const finalOptions = signal ? { ...fetchOptions, signal, headers } : { ...fetchOptions, headers };

  let timeoutId;
  try {
    if (controller && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }, timeoutMs);
    }

    return await fetch(url, finalOptions);
  } catch (err) {
    const name = typeof err?.name === 'string' ? err.name : '';
    const msg = typeof err?.message === 'string' ? err.message : '';
    if (name === 'AbortError' || msg.toLowerCase().includes('aborted')) {
      throw new Error('Request timed out. Check your connection and try again.');
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
