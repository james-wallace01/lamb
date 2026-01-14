import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useData } from '../context/DataContext';

export default function BackButton({ style }) {
  const navigation = useNavigation();
  const { theme } = useData();
  
  const handlePress = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    const state = navigation.getState?.();
    const initialRouteName = state?.routeNames?.[0];
    const currentRouteName = state?.routes?.[state?.index]?.name;
    if (initialRouteName && currentRouteName && initialRouteName !== currentRouteName && navigation.reset) {
      navigation.reset({ index: 0, routes: [{ name: initialRouteName }] });
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[styles.container, style]}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <View
        style={[
          styles.buttonInner,
          {
            backgroundColor: theme.isDark ? 'rgba(232, 237, 255, 0.12)' : 'rgba(17, 24, 39, 0.06)',
            borderColor: theme.isDark ? 'rgba(232, 237, 255, 0.2)' : 'rgba(17, 24, 39, 0.12)',
          },
        ]}
      >
        <Text style={[styles.arrow, { color: theme.text }]}>{'‹'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonInner: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  arrow: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 26,
  },
});
