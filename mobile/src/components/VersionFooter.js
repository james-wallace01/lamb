import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import versionInfo from '../../../public/version.json';

const version = versionInfo?.version || '';

export default function VersionFooter() {
  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.text}>Liquid Asset Management Board</Text>
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
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
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
    fontSize: 12,
    fontWeight: '600',
  },
});
