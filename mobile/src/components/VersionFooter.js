import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

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

export default function VersionFooter({ navigationRef, currentRouteName }) {
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

  const activeTab = (() => {
    const r = currentRouteName;
    if (!r) return null;
    if (r === 'Membership' || r === 'ChooseSubscription') return 'Membership';
    if (r === 'Profile' || r === 'EmailNotifications') return 'Profile';
    // Default: Home + detail routes
    return 'Home';
  })();

  const safePush = (routeName) => {
    try {
      if (!navigationRef?.isReady?.()) return;
      const current = navigationRef.getCurrentRoute?.()?.name;
      if (current === routeName) return;
      navigationRef.dispatch(StackActions.push(routeName));
    } catch {
      // ignore
    }
  };

  const inactiveColor = theme.textMuted;
  const activeColor = theme.primary;

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
            style={styles.navButton}
            onPress={() => safePush('Home')}
            accessibilityRole="button"
            accessibilityLabel="Go to Home"
          >
            <Ionicons
              name={activeTab === 'Home' ? 'home' : 'home-outline'}
              size={22}
              color={activeTab === 'Home' ? activeColor : inactiveColor}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => safePush('Membership')}
            accessibilityRole="button"
            accessibilityLabel="Go to Membership"
          >
            <Ionicons
              name={activeTab === 'Membership' ? 'card' : 'card-outline'}
              size={22}
              color={activeTab === 'Membership' ? activeColor : inactiveColor}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => safePush('Profile')}
            accessibilityRole="button"
            accessibilityLabel="Go to Profile"
          >
            <Ionicons
              name={activeTab === 'Profile' ? 'person' : 'person-outline'}
              size={22}
              color={activeTab === 'Profile' ? activeColor : inactiveColor}
            />
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
    alignItems: 'center',
    justifyContent: 'center',
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
