import { getFirebaseIdToken } from '../firebase';

export const API_URL = process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || '';

export async function apiFetch(url, options = {}) {
  const token = await getFirebaseIdToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(url, {
    ...options,
    headers,
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const message = (json && (json.error || json.message)) || text || `Request failed (${resp.status})`;
    const err = new Error(message);
    err.status = resp.status;
    err.body = json;
    throw err;
  }

  return json;
}
