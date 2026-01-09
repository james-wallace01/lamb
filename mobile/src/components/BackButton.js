import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';

export default function BackButton({ style }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useData();
  
  const handlePress = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[styles.container, { top: Math.max(insets.top, 8) }, style]}
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
    position: 'absolute',
    left: 16,
    zIndex: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
