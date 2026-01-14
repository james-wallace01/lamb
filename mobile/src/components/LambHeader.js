import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';

export default function LambHeader({ style }) {
  const insets = useSafeAreaInsets();
  const { theme, backendReachable } = useData();
  const isOffline = backendReachable === false;

  if (!isOffline) return null;

  return (
    <View style={[styles.wrapper, { marginTop: Math.max(insets.top, 8) }, style]}>
      <View style={[styles.offlineBanner, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
        <Text style={[styles.offlineText, { color: theme.textMuted }]}>Offline — read-only</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', alignSelf: 'center', marginBottom: 10 },
  offlineBanner: { alignSelf: 'center', marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  offlineText: { fontSize: 12, fontWeight: '700' },
});
