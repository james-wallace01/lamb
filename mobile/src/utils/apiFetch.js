import { getFirebaseIdToken } from '../firebase';

export async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  const token = await getFirebaseIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
}
