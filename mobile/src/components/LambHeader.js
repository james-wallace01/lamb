import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';

export default function LambHeader({ style }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, backendReachable } = useData();
  const isOffline = backendReachable === false;
  
  const handlePress = () => {
    const state = navigation.getState?.();
    const initialRouteName = state?.routeNames?.[0];
    const routeNames = state?.routeNames || [];

    if (routeNames.includes('Home')) {
      navigation.navigate('Home');
      return;
    }

    // Auth stack doesn't have Home; treat its first screen as "home".
    if (initialRouteName && navigation.reset) {
      navigation.reset({ index: 0, routes: [{ name: initialRouteName }] });
    }
  };

  return (
    <View style={[styles.wrapper, { marginTop: Math.max(insets.top, 8) }, style]}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
        style={styles.container}
      >
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.text }]}>LAMB</Text>
        </View>
      </TouchableOpacity>

      {isOffline && (
        <View style={[styles.offlineBanner, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.offlineText, { color: theme.textMuted }]}>Offline — read-only</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', alignSelf: 'center', marginBottom: 16 },
  container: { width: '100%', height: 44, justifyContent: 'center', alignItems: 'center' },
  titleWrap: { paddingVertical: 0, paddingHorizontal: 0 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
  offlineBanner: { alignSelf: 'center', marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  offlineText: { fontSize: 12, fontWeight: '700' },
});
