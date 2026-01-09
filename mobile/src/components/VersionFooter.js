import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import versionInfo from '../../../public/version.json';
import appConfig from '../../app.json';

const version = versionInfo?.version || '';
const iosBuildNumber = appConfig?.expo?.ios?.buildNumber || '';
const androidVersionCode = appConfig?.expo?.android?.versionCode;

const build = Platform.OS === 'ios'
  ? (iosBuildNumber ? `build ${iosBuildNumber}` : '')
  : Platform.OS === 'android'
    ? (androidVersionCode ? `build ${androidVersionCode}` : '')
    : '';

const versionText = version
  ? `v${version}${build ? ` (${build})` : ''}`
  : 'Version unavailable';

export default function VersionFooter() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]} pointerEvents="none">
      <Text style={styles.text}>LAMB</Text>
      <Text style={styles.text}>{versionText}</Text>
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
    backgroundColor: '#000000',
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
