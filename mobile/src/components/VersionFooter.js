import React from 'react';
import { View, Text, StyleSheet, Platform, useSafeAreaInsets } from 'react-native';
import versionInfo from '../../../public/version.json';

const version = versionInfo?.version || '';

export default function VersionFooter() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="none">
      <Text style={styles.text}>LAMB</Text>
      <Text style={styles.text}>{version ? `v${version}` : 'Version unavailable'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 8 : 10,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(11, 11, 15, 0.9)',
    borderTopWidth: 1,
    borderTopColor: '#1f2738',
    gap: 12,
  },
  text: {
    color: '#9aa1b5',
    fontSize: 11,
    fontWeight: '600',
  },
});
