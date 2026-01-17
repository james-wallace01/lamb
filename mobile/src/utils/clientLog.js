import { getItem, setItem } from '../storage';

const CLIENT_LOG_KEY = 'lamb-mobile-client-log-v1';
const MAX_ENTRIES = 120;

const safeString = (v) => {
  if (v == null) return '';
  try {
    return String(v);
  } catch {
    return '';
  }
};

export async function appendClientLog({ level = 'info', event = 'event', message = '', meta = null } = {}) {
  const entry = {
    ts: Date.now(),
    level: safeString(level || 'info').slice(0, 16),
    event: safeString(event || 'event').slice(0, 48),
    message: safeString(message || '').slice(0, 240),
    meta,
  };

  try {
    const existing = await getItem(CLIENT_LOG_KEY, []);
    const list = Array.isArray(existing) ? existing : [];
    const next = [entry, ...list].slice(0, MAX_ENTRIES);
    await setItem(CLIENT_LOG_KEY, next);
  } catch {
    // ignore
  }

  try {
    if (entry.level === 'error') console.warn('[client]', entry.event, entry.message);
  } catch {
    // ignore
  }

  return entry;
}
