import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';

export default function LambHeader({ style }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useData();
  
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
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      style={[styles.container, { marginTop: Math.max(insets.top, 8) }, style]}
    >
      <View style={styles.titleWrap}>
        <Text style={[styles.title, { color: theme.text }]}>LAMB</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 16, alignSelf: 'center' },
  titleWrap: { paddingVertical: 0, paddingHorizontal: 0 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
});
