import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
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

const formatActor = (actorUid, meUid) => {
  if (!actorUid) return 'Unknown';
  if (meUid && String(actorUid) === String(meUid)) return 'You';
  return String(actorUid);
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

export default function Tracking() {
  const { theme, currentUser, vaults, backendReachable } = useData();
  const isOffline = backendReachable === false;

  const uid = currentUser?.id ? String(currentUser.id) : null;

  const ownedVaults = useMemo(() => {
    if (!uid) return [];
    return (vaults || [])
      .filter((v) => v?.ownerId != null && String(v.ownerId) === uid)
      .map((v) => ({ id: String(v.id), name: v.name || 'Vault' }));
  }, [vaults, uid]);

  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const mountedRef = useRef(true);

  const load = async () => {
    if (!uid) return;
    if (!firestore) return;

    setLoadError(null);

    try {
      const perVault = await Promise.all(
        ownedVaults.map(async (v) => {
          const q = query(
            collection(firestore, 'vaults', String(v.id), 'auditEvents'),
            orderBy('createdAt', 'desc'),
            limit(50)
          );
          const snap = await getDocs(q);
          return snap.docs.map((d) => ({
            id: d.id,
            vaultId: String(v.id),
            vaultName: v.name,
            ...(d.data() || {}),
          }));
        })
      );

      const merged = perVault.flat().filter(Boolean);
      merged.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

      if (!mountedRef.current) return;
      setEvents(merged);
    } catch (err) {
      const msg = err?.message || String(err);
      if (!mountedRef.current) return;
      setLoadError(msg);
      setEvents([]);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ownedVaults.length]);

  const handleRefresh = async () => {
    if (refreshing) return;
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.isDark ? '#fff' : '#111827'}
            progressViewOffset={24}
          />
        }
      >
        <LambHeader />
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: theme.text }]}>Tracking</Text>
        </View>

        {isOffline ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Offline — tracking is unavailable.</Text>
        ) : !uid ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Sign in to view tracking.</Text>
        ) : ownedVaults.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No owned vaults to track.</Text>
        ) : loadError ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Tracking unavailable: {loadError}</Text>
        ) : events.length === 0 ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>No tracking events yet.</Text>
        ) : (
          events.map((evt) => {
            const when = evt?.createdAt ? new Date(Number(evt.createdAt)).toLocaleString() : '';
            const type = titleize(evt?.type || 'UNKNOWN');
            const actor = formatActor(evt?.actor_uid, uid);
            const detail = describePayload(evt?.payload);

            return (
              <View
                key={`${evt.vaultId}:${evt.id}`}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Text style={[styles.cardTitle, { color: theme.text }]}>{type}</Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                  {evt?.vaultName ? `Vault: ${evt.vaultName}` : 'Vault'}
                  {when ? ` • ${when}` : ''}
                </Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>By: {actor}</Text>
                {detail ? <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>{detail}</Text> : null}
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
  container: { padding: 20, backgroundColor: '#0b0b0f', gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#c5c5d0' },

  card: { padding: 14, borderRadius: 10, backgroundColor: '#11121a', borderWidth: 1, borderColor: '#1f2738' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#9aa1b5', marginTop: 4, fontSize: 13 },
});
