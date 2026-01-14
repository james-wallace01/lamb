import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import appConfig from '../../app.json';
import versionInfo from '../../../public/version.json';
import { API_URL } from '../config/api';
import { useData } from '../context/DataContext';
import { apiFetch } from '../utils/apiFetch';

const version = versionInfo?.version || '';
const iosBuildNumber = appConfig?.expo?.ios?.buildNumber || '';
const androidVersionCode = appConfig?.expo?.android?.versionCode;

const build =
  Platform.OS === 'ios'
    ? iosBuildNumber
      ? `build ${iosBuildNumber}`
      : ''
    : Platform.OS === 'android'
      ? androidVersionCode
        ? `build ${androidVersionCode}`
        : ''
      : '';

const versionText = version ? `v${version}${build ? ` (${build})` : ''}` : 'Version unavailable';

export default function VersionFooter({ navigationRef }) {
  const { theme, currentUser } = useData();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('connecting'); // connecting | connected | offline
  const checkingRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;

      setStatus((prev) => (prev === 'connected' ? prev : 'connecting'));

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await apiFetch(`${API_URL}/health`, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (!mounted) return;
        setStatus(res.ok ? 'connected' : 'offline');
      } catch (e) {
        if (!mounted) return;
        setStatus('offline');
      } finally {
        clearTimeout(t);
        checkingRef.current = false;
      }
    };

    check();
    const interval = setInterval(check, 15000);

    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === 'inactive' || prev === 'background') && nextState === 'active') {
        check();
      }
    });

    return () => {
      mounted = false;
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  const dotStyle =
    status === 'connected' ? styles.dotGreen : status === 'offline' ? styles.dotRed : styles.dotAmber;

  const statusLabel = status === 'connected' ? 'Connected' : status === 'offline' ? 'Offline — read-only' : 'Connecting…';

  const canShowNav = !!currentUser;

  const safeNavigate = (routeName) => {
    try {
      if (!navigationRef?.isReady?.()) return;
      navigationRef.navigate(routeName);
    } catch {
      // ignore
    }
  };

  const navButtonTextColor = theme.text;

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: theme.background,
          borderTopColor: theme.border,
        },
      ]}
    >
      {canShowNav && (
        <View style={styles.navRow}>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => safeNavigate('Home')}
            accessibilityRole="button"
            accessibilityLabel="Go to Home"
          >
            <Text style={[styles.navButtonText, { color: navButtonTextColor }]}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => safeNavigate('Membership')}
            accessibilityRole="button"
            accessibilityLabel="Go to Membership"
          >
            <Text style={[styles.navButtonText, { color: navButtonTextColor }]}>Membership</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => safeNavigate('Profile')}
            accessibilityRole="button"
            accessibilityLabel="Go to Profile"
          >
            <Text style={[styles.navButtonText, { color: navButtonTextColor }]}>Profile</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.infoRow} pointerEvents="none">
        <View style={styles.leftGroup}>
          <View style={[styles.dot, dotStyle]} />
          <Text style={[styles.statusText, { color: theme.textMuted }]}>{statusLabel}</Text>
        </View>
        <Text style={[styles.text, { color: theme.textMuted }]}>{versionText}</Text>
      </View>
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
    flexDirection: 'column',
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#1f2738',
    gap: 12,
  },
  navRow: {
    flexDirection: 'row',
    gap: 8,
  },
  navButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 11,
  },
  statusText: {
    fontSize: 11,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: '#16a34a',
  },
  dotAmber: {
    backgroundColor: '#f59e0b',
  },
  dotRed: {
    backgroundColor: '#dc2626',
  },
});
