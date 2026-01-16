import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useIsFocused } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import LambHeader from '../components/LambHeader';
import { useData } from '../context/DataContext';
import { firestore } from '../firebase';
import { runWithMinimumDuration } from '../utils/timing';

const titleize = (raw) => {
  const s = typeof raw === 'string' ? raw : '';
  if (!s) return 'Unknown';
  return s
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const toMillis = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value?.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  return null;
};

const startOfLocalDayMs = (date) => {
  const d = date instanceof Date ? date : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
};

const addDays = (date, days) => {
  const d = date instanceof Date ? date : new Date();
  const next = new Date(d);
  next.setDate(d.getDate() + Number(days || 0));
  return next;
};

const isSameLocalDay = (a, b) => {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

const formatDdMmYyyy = (date) => {
  if (!(date instanceof Date)) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
};

const formatDatePillLabel = (date) => {
  const d = date instanceof Date ? date : new Date();
  const today = new Date();
  if (isSameLocalDay(d, today)) return 'Date: Today';
  return `Date: ${formatDdMmYyyy(d)}`;
};

const formatDayLabel = (date) => {
  if (!(date instanceof Date)) return 'Date';
  const today = new Date();
  if (isSameLocalDay(date, today)) return 'Today';
  if (isSameLocalDay(date, addDays(today, -1))) return 'Yesterday';
  try {
    return date.toLocaleDateString();
  } catch {
    return 'Date';
  }
};

const getEntityLabel = (rawType) => {
  const t = String(rawType || '').toUpperCase();
  if (t.includes('ASSET')) return 'Asset';
  if (t.includes('COLLECTION')) return 'Collection';
  if (t.includes('VAULT')) return 'Vault';
  if (t.includes('PERMISSION_GRANT')) return 'Access';
  if (t.includes('MEMBERSHIP')) return 'Access';
  return 'Item';
};

const isCloneEvent = ({ rawType, payload }) => {
  const t = String(rawType || '').toUpperCase();
  if (t.includes('CLONED') || t.includes('CLONE')) return true;
  // Heuristic: the Clone button creates a "(Copy)" asset.
  const title = payload?.title != null ? String(payload.title) : '';
  return t === 'ASSET_CREATED' && title.includes('(Copy)');
};

const isMoveEvent = ({ rawType, payload }) => {
  const t = String(rawType || '').toUpperCase();
  if (t.includes('MOVED')) return true;
  const changes = payload?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
  // Most move operations change one of these identifiers.
  return (
    Object.prototype.hasOwnProperty.call(changes, 'collectionId') ||
    Object.prototype.hasOwnProperty.call(changes, 'collection_id') ||
    Object.prototype.hasOwnProperty.call(changes, 'vaultId') ||
    Object.prototype.hasOwnProperty.call(changes, 'vault_id')
  );
};

const getActionLabel = ({ rawType, payload }) => {
  const t = String(rawType || '').toUpperCase();
  if (!t) return 'Event';

  // View/access
  if (t.endsWith('_VIEWED')) return 'Viewed';

  if (isCloneEvent({ rawType: t, payload })) return 'Cloned';
  if (isMoveEvent({ rawType: t, payload })) return 'Moved';

  // Create
  if (t.endsWith('_CREATED') || t.includes('_CREATED')) return 'Created';

  // Delete intent + result
  // UX: treat "delete requested" as Deleted (the user action is deletion).
  if (t.endsWith('_DELETE_REQUESTED') || t.includes('DELETE_REQUESTED')) return 'Deleted';
  if (t.endsWith('_DELETED') || t.includes('_DELETED') || t === 'VAULT_DELETED') return 'Deleted';

  // Sharing / access
  if (t.includes('GRANT_CREATED') || t.includes('MEMBERSHIP_CREATED')) return 'Delegate';
  if (t.includes('GRANT_UPDATED') || t.includes('MEMBERSHIP_UPDATED') || t.includes('SHARE_UPDATED')) return 'Edited';
  if (t.includes('SHARE_REVOKED') || t.includes('REVOKED') || t.includes('GRANT_DELETED') || t.includes('MEMBERSHIP_DELETED')) return 'Deleted';
  if (t.includes('SHARED')) return 'Delegate';

  // Update/save
  if (t.endsWith('_UPDATED') || t.includes('_UPDATED')) return 'Edited';

  // Ownership transfer
  if (t.includes('OWNERSHIP_TRANSFERRED') || t.includes('TRANSFERRED')) return 'Transfer';

  return 'Event';
};

const formatActor = (actorUid, meUid, users) => {
  if (!actorUid) return 'Unknown';
  const raw = String(actorUid);
  if (meUid && raw === String(meUid)) return 'You';

  const match = (users || []).find((u) => {
    const id = u?.id != null ? String(u.id) : null;
    const userId = u?.user_id != null ? String(u.user_id) : null;
    const firebaseUid = u?.firebaseUid != null ? String(u.firebaseUid) : null;
    return (id && id === raw) || (userId && userId === raw) || (firebaseUid && firebaseUid === raw);
  });

  return match?.username || match?.email || raw;
};

const describePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  if (typeof payload.name === 'string' && payload.name.trim()) return payload.name.trim();
  if (typeof payload.title === 'string' && payload.title.trim()) return payload.title.trim();
  if (typeof payload.collection_id === 'string') return `Collection ${payload.collection_id}`;
  if (typeof payload.asset_id === 'string') return `Asset ${payload.asset_id}`;
  if (typeof payload.invitation_id === 'string') return `Invite ${payload.invitation_id}`;

  return null;
};

const formatChangeValue = (value) => {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getActionStyles = (action, theme) => {
  const a = String(action || '').toUpperCase();

  const base = {
    cardBorderColor: theme.border,
    badgeText: theme.onAccentText || '#fff',
  };

  if (a === 'DELETE' || a === 'DELETED') {
    return {
      ...base,
      badgeBg: theme.danger || theme.dangerBorder,
    };
  }

  if (a === 'MOVE' || a === 'MOVED') {
    return {
      ...base,
      badgeBg: theme.warning || theme.warningBorder || theme.primary,
    };
  }

  if (a === 'CLONE' || a === 'CLONED') {
    return {
      ...base,
      badgeBg: theme.clone || theme.cloneBorder || theme.primary,
    };
  }

  if (a === 'DELEGATE') {
    return {
      ...base,
      badgeBg: theme.success || theme.successBorder || theme.primary,
    };
  }

  if (a === 'EDIT' || a === 'EDITED') {
    return {
      ...base,
      badgeBg: theme.primary,
    };
  }

  return {
    ...base,
    badgeBg: theme.border,
    badgeText: theme.text,
  };
};

const EMAIL_SENT_MARKER_TYPE = 'NOTIFICATION_EMAIL_SENT';

export default function Tracking({ navigation }) {
  const { theme, currentUser, vaults, vaultMemberships, users, backendReachable } = useData();
  const isOffline = backendReachable === false;
  const isFocused = useIsFocused();

  const uid = currentUser?.id ? String(currentUser.id) : null;
  const hasProMembership = String(currentUser?.subscription?.tier || '').toUpperCase() === 'PRO';

  const vaultBuckets = useMemo(() => {
    if (!uid) return [];

    const activeVaultIds = new Set(
      (vaultMemberships || [])
        .filter((m) => m?.status === 'ACTIVE' && m?.user_id != null && String(m.user_id) === uid && m?.vault_id != null)
        .map((m) => String(m.vault_id))
    );

    const owned = [];
    const shared = [];

    for (const v of (vaults || [])) {
      const vId = v?.id != null ? String(v.id) : '';
      if (!vId) continue;
      const isOwner = v?.ownerId != null && String(v.ownerId) === uid;
      const isMember = activeVaultIds.has(vId);
      if (!isOwner && !isMember) continue;
      const entry = { id: vId, name: v?.name || 'Vault' };
      if (isOwner) owned.push(entry);
      else shared.push(entry);
    }

    return { owned, shared };
  }, [vaults, vaultMemberships, uid]);

  const initialFilter = useMemo(() => {
    if (!uid) return 'PRIVATE';
    return (vaultBuckets?.owned?.length || 0) > 0 ? 'PRIVATE' : 'SHARED';
  }, [uid, vaultBuckets]);

  const [vaultFilter, setVaultFilter] = useState(initialFilter);

  useEffect(() => {
    if (vaultFilter === 'PRIVATE' && (vaultBuckets?.owned?.length || 0) === 0 && (vaultBuckets?.shared?.length || 0) > 0) {
      setVaultFilter('SHARED');
    }
  }, [vaultFilter, vaultBuckets]);

  const trackedVaults = useMemo(() => {
    if (!uid) return [];
    return vaultFilter === 'PRIVATE' ? (vaultBuckets?.owned || []) : (vaultBuckets?.shared || []);
  }, [uid, vaultFilter, vaultBuckets]);

  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const mountedRef = useRef(true);

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const selectedDayStartMs = useMemo(() => startOfLocalDayMs(selectedDate), [selectedDate]);
  const selectedDayEndMs = useMemo(() => selectedDayStartMs + 24 * 60 * 60 * 1000, [selectedDayStartMs]);

  const load = async () => {
    if (!uid) return;
    if (!firestore) return;

    setLoadError(null);
    setLoadingEvents(true);

    try {
      let anyOk = false;
      let firstErr = null;

      const perVault = await Promise.all(
        trackedVaults.map(async (v) => {
          try {
            const q = query(
              collection(firestore, 'vaults', String(v.id), 'auditEvents'),
              // `createdAt` is stored as a millisecond number (Date.now()) by both
              // client + Cloud Functions, so we query using numeric bounds.
              where('createdAt', '>=', selectedDayStartMs),
              where('createdAt', '<', selectedDayEndMs),
              orderBy('createdAt', 'desc'),
              limit(250)
            );
            const snap = await getDocs(q);
            anyOk = true;
            return snap.docs.map((d) => ({
              id: d.id,
              vaultId: String(v.id),
              vaultName: v.name,
              ...(d.data() || {}),
            }));
          } catch (e) {
            if (!firstErr) firstErr = e?.message || String(e);
            return [];
          }
        })
      );

      const merged = perVault.flat().filter(Boolean);
      merged.sort((a, b) => (toMillis(b?.createdAt) || 0) - (toMillis(a?.createdAt) || 0));

      // Keep a safety filter in case some events are written outside expected ranges
      // or come through with a different timestamp field.
      const filtered = merged.filter((evt) => {
        const ts = toMillis(evt?.createdAt ?? evt?.timestamp);
        if (!ts) return false;
        return ts >= selectedDayStartMs && ts < selectedDayEndMs;
      });

      // Some backend emails write a marker audit event so we can show “Email sent” on
      // the related action without exposing private emailEvents documents to the client.
      const emailMarkerByRelatedAuditId = new Map();
      for (const evt of filtered) {
        if (String(evt?.type || '') !== EMAIL_SENT_MARKER_TYPE) continue;
        const related = evt?.payload?.related_audit_event_id;
        if (related) emailMarkerByRelatedAuditId.set(String(related), evt);
      }

      const filteredVisible = filtered
        .filter((evt) => String(evt?.type || '') !== EMAIL_SENT_MARKER_TYPE)
        .map((evt) => {
          const id = evt?.id != null ? String(evt.id) : null;
          const marker = id ? emailMarkerByRelatedAuditId.get(id) : null;
          return {
            ...evt,
            __emailSent: !!marker,
            __emailSentAt: marker ? toMillis(marker?.createdAt) : null,
          };
        });

      if (!mountedRef.current) return;
      setLoadError(!anyOk && firstErr ? String(firstErr) : null);
      setEvents(filteredVisible);
    } catch (err) {
      const msg = err?.message || String(err);
      if (!mountedRef.current) return;
      setLoadError(msg);
      setEvents([]);
    } finally {
      if (!mountedRef.current) return;
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Reload whenever the screen becomes active again.
    if (!isFocused) return;
    if (!hasProMembership) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, hasProMembership, uid, vaultFilter, trackedVaults.length, selectedDayStartMs]);

  const handleRefresh = async () => {
    if (refreshing) return;
    if (!hasProMembership) return;
    setRefreshing(true);
    try {
      await runWithMinimumDuration(async () => {
        await load();
      }, 800);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
        refreshControl={
          hasProMembership ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.isDark ? '#fff' : '#111827'}
              progressViewOffset={24}
            />
          ) : null
        }
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Tracking</Text>
        </View>

        {!hasProMembership ? (
          <View style={[styles.lockedCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
            <Text style={[styles.lockedTitle, { color: theme.text }]}>Tracking is a Pro feature</Text>
            <Text style={[styles.lockedText, { color: theme.textSecondary }]}>Upgrade to Pro to access Tracking.</Text>
            <Pressable
              onPress={() => navigation.navigate('ChooseSubscription', { mode: 'upgrade' })}
              style={[styles.lockedButton, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="View membership plans"
            >
              <Text style={[styles.lockedButtonText, { color: theme.onAccentText || '#fff' }]}>View plans</Text>
            </Pressable>
          </View>
        ) : null}

        {hasProMembership && !!uid ? (
          <View style={styles.filterRow}>
            <Pressable
              onPress={() => setVaultFilter('PRIVATE')}
              style={[
                styles.filterPill,
                {
                  backgroundColor: vaultFilter === 'PRIVATE' ? theme.surfaceAlt : theme.surface,
                  borderColor: vaultFilter === 'PRIVATE' ? theme.primary : theme.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: vaultFilter === 'PRIVATE' ? theme.text : theme.textMuted }]}>Private Vaults</Text>
            </Pressable>
            <Pressable
              onPress={() => setVaultFilter('SHARED')}
              style={[
                styles.filterPill,
                {
                  backgroundColor: vaultFilter === 'SHARED' ? theme.surfaceAlt : theme.surface,
                  borderColor: vaultFilter === 'SHARED' ? theme.primary : theme.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: vaultFilter === 'SHARED' ? theme.text : theme.textMuted }]}>Shared Vaults</Text>
            </Pressable>
          </View>
        ) : null}

        {hasProMembership && !!uid ? (
          <View style={styles.dateRow}>
            <Pressable
              onPress={() => {
                if (Platform.OS === 'ios') {
                  setShowDatePicker((v) => !v);
                } else {
                  setShowDatePicker(true);
                }
              }}
              style={[
                styles.datePill,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.primary,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: theme.onAccentText || '#fff' }]}>
                {formatDatePillLabel(selectedDate)}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => navigation?.navigate?.('EmailNotifications')}
              style={[
                styles.datePill,
                {
                  backgroundColor: theme.primary,
                  borderColor: theme.primary,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go to Email Notifications"
            >
              <Text style={[styles.filterText, { color: theme.onAccentText || '#fff' }]}>Notifications</Text>
            </Pressable>
          </View>
        ) : null}

        {hasProMembership && !!uid ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {isOffline
              ? 'Offline — tracking is unavailable.'
              : trackedVaults.length === 0
                ? vaultFilter === 'PRIVATE'
                  ? 'No private vaults to track.'
                  : 'No shared vaults to track.'
                : loadError
                  ? `Tracking unavailable: ${loadError}`
                  : loadingEvents
                    ? 'Loading activity…'
                    : `${events.length} event${events.length === 1 ? '' : 's'} on this day`}
          </Text>
        ) : null}

        {hasProMembership && !!uid && showDatePicker ? (
          <View style={[styles.datePickerWrap, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={new Date()}
              accentColor={theme.primary}
              textColor={theme.text}
              themeVariant={theme.isDark ? 'dark' : 'light'}
              onChange={(event, nextDate) => {
                if (Platform.OS !== 'ios') setShowDatePicker(false);
                if (event?.type === 'dismissed') return;
                if (!nextDate) return;
                setSelectedDate(nextDate);
              }}
            />
          </View>
        ) : null}

        {!uid ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Sign in to view tracking.</Text>
        ) : !hasProMembership ? null : isOffline || trackedVaults.length === 0 || loadError ? null : events.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No activity for this day.</Text>
        ) : (
          events.map((evt) => {
            const ts = toMillis(evt?.createdAt ?? evt?.timestamp);
            const when = ts ? new Date(ts).toLocaleString() : '';
            const rawType = evt?.type || evt?.action || 'UNKNOWN';
            const action = getActionLabel({ rawType, payload: evt?.payload || null });
            const entity = getEntityLabel(rawType);
            const type = `${action} ${entity}`;
            const actor = formatActor(evt?.actor_uid || evt?.actor_id, uid, users);
            const detail = describePayload(evt?.payload || evt?.target || evt?.after_state);
            const rawChanges = evt?.payload?.changes;
            const changeKeys = rawChanges && typeof rawChanges === 'object' && !Array.isArray(rawChanges) ? Object.keys(rawChanges) : [];
            const visibleKeys = changeKeys.slice(0, 3);
            const remaining = changeKeys.length - visibleKeys.length;
            const actionStyles = getActionStyles(action, theme);
            const badgeLabel = action;

            return (
              <View
                key={`${evt.vaultId}:${evt.id}`}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: actionStyles.cardBorderColor }]}
              >
                <View style={styles.cardHeaderRow}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{type}</Text>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: actionStyles.badgeBg,
                        borderWidth: 0,
                      },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: actionStyles.badgeText }]}>{badgeLabel}</Text>
                  </View>
                </View>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                  {evt?.vaultName ? `Vault: ${evt.vaultName}` : 'Vault'}
                  {when ? ` • ${when}` : ''}
                </Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>By: {actor}</Text>
                {evt?.__emailSent ? (
                  <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>Email sent</Text>
                ) : null}
                {detail ? <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>{detail}</Text> : null}
                {visibleKeys.map((k) => {
                  const ch = rawChanges?.[k] || null;
                  const from = formatChangeValue(ch?.from);
                  const to = formatChangeValue(ch?.to);
                  return (
                    <Text key={`${evt.vaultId}:${evt.id}:chg:${k}`} style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                      {k}: {from} → {to}
                    </Text>
                  );
                })}
                {remaining > 0 ? (
                  <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>+{remaining} more</Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#0b0b0f' },
  container: { padding: 20, paddingBottom: 160, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  lockedCard: { borderWidth: 1, borderColor: '#1f2738', borderRadius: 12, padding: 16, gap: 10 },
  lockedTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  lockedText: { fontSize: 14, color: '#c5c5d0' },
  lockedButton: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  lockedButtonText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  filterRow: { flexDirection: 'row', gap: 10 },
  filterPill: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  filterText: { fontSize: 13, fontWeight: '700' },

  dateRow: { flexDirection: 'row', gap: 10, width: '100%', alignItems: 'stretch' },
  datePill: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  datePickerWrap: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
