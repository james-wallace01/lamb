import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BackButton({ style }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  
  const handlePress = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[styles.container, { top: Math.max(insets.top, 8) + 4 }, style]}
    >
      <View style={styles.buttonInner}>
        <Text style={styles.arrow}>{'‹'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  buttonInner: {
    backgroundColor: 'rgba(232, 237, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(232, 237, 255, 0.2)',
  },
  arrow: {
    fontSize: 32,
    fontWeight: '700',
    color: '#e8edff',
    lineHeight: 32,
  },
});
