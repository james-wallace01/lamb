import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

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
  const { theme, currentUser, vaults, collections } = useData();
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
    if (r === 'Membership' || r === 'ChooseSubscription') return 'Profile';
    if (r === 'Settings' || r === 'EmailNotifications') return 'Profile';
    if (r === 'Profile') return 'Profile';
    if (r === 'PrivateVaults') return 'PrivateVaults';
    if (r === 'SharedVaults') return 'SharedVaults';
    if (r === 'Tracking') return 'Tracking';
    if (r === 'Vault' || r === 'Collection' || r === 'Asset') {
      try {
        const route = navigationRef?.getCurrentRoute?.();
        const params = route?.params || {};
        let vaultId = null;
        if (r === 'Vault') vaultId = params.vaultId;
        if (r === 'Asset') vaultId = params.vaultId || params.routeVaultId;
        if (r === 'Collection') {
          const c = (collections || []).find((col) => String(col?.id) === String(params.collectionId));
          vaultId = c?.vaultId;
        }

        const v = vaultId ? (vaults || []).find((vv) => String(vv?.id) === String(vaultId)) : null;
        if (v && currentUser?.id && String(v.ownerId) === String(currentUser.id)) return 'PrivateVaults';
        if (v) return 'SharedVaults';
      } catch {
        // ignore
      }
      return 'Home';
    }

    return 'Home';
  })();

  const tabForRouteName = (routeName) => {
    const r = String(routeName || '');
    if (r === 'Membership' || r === 'ChooseSubscription') return 'Profile';
    if (r === 'Settings' || r === 'EmailNotifications') return 'Profile';
    if (r === 'Profile') return 'Profile';
    if (r === 'PrivateVaults') return 'PrivateVaults';
    if (r === 'SharedVaults') return 'SharedVaults';
    if (r === 'Tracking') return 'Tracking';
    return 'Home';
  };

  const safeNavigate = (routeName, params) => {
    try {
      if (!navigationRef?.isReady?.()) return;
      const current = navigationRef.getCurrentRoute?.()?.name;
      if (current === routeName) return;

      navigationRef.dispatch(CommonActions.navigate({ name: routeName, params }));
    } catch {
      // ignore
    }
  };

  const hasProMembership = String(currentUser?.subscription?.tier || '').toUpperCase() === 'PRO';

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
            onPress={() => safeNavigate('Home')}
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
            onPress={() => safeNavigate('PrivateVaults')}
            accessibilityRole="button"
            accessibilityLabel="Go to Private Vaults"
          >
            <MaterialCommunityIcons
              name="folder-arrow-right"
              size={22}
              color={activeTab === 'PrivateVaults' ? activeColor : inactiveColor}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => safeNavigate('SharedVaults')}
            accessibilityRole="button"
            accessibilityLabel="Go to Shared Vaults"
          >
            <MaterialCommunityIcons
              name="folder-arrow-left-right"
              size={22}
              color={activeTab === 'SharedVaults' ? activeColor : inactiveColor}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => {
              if (!hasProMembership) {
                safeNavigate('Membership');
                return;
              }
              safeNavigate('Tracking');
            }}
            accessibilityRole="button"
            accessibilityLabel="Go to Tracking"
          >
            <Ionicons
              name={activeTab === 'Tracking' ? 'time' : 'time-outline'}
              size={22}
              color={activeTab === 'Tracking' ? activeColor : inactiveColor}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => safeNavigate('Profile')}
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
