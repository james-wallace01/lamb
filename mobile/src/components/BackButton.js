import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
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
      activeOpacity={0.8}
      style={[styles.container, { top: Math.max(insets.top, 8) }, style]}
    >
      <Text style={styles.text}>{'<'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  text: {
    fontSize: 26,
    fontWeight: '800',
    color: '#e8edff',
  },
});
