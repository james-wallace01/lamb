import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useData } from '../context/DataContext';

export default function LambHeader({ style }) {
  const { theme, backendReachable, lastSyncedAt } = useData();
  const isOffline = backendReachable === false;

  const formatLastSynced = (ts) => {
    const n = typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
    if (!n) return null;
    try {
      return new Date(n).toLocaleString();
    } catch {
      return null;
    }
  };

  const lastSyncedLabel = formatLastSynced(lastSyncedAt);
  if (!isOffline && !lastSyncedLabel) return null;

  return (
    <View style={[styles.wrapper, style]}>
      <View style={[styles.offlineBanner, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
        {isOffline ? <Text style={[styles.offlineText, { color: theme.textMuted }]}>Offline — read-only</Text> : null}
        {lastSyncedLabel ? (
          <Text style={[styles.syncedText, { color: theme.textMuted }]}>Last synced: {lastSyncedLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', alignSelf: 'center', marginBottom: 10 },
  offlineBanner: { alignSelf: 'center', marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  offlineText: { fontSize: 12, fontWeight: '700' },
  syncedText: { fontSize: 12, fontWeight: '700', marginTop: 4 },
});
