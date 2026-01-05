import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function LambHeader({ style }) {
  const navigation = useNavigation();
  const handlePress = () => {
    const state = navigation.getState?.();
    const canGoHome = state?.routeNames?.includes('Home');
    if (canGoHome) {
      navigation.navigate('Home');
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      style={[styles.container, style]}
    >
      <View style={styles.titleWrap}>
        <Text style={styles.title}>LAMB</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
    container: { width: '100%', alignItems: 'center', marginBottom: 16, alignSelf: 'center' },
    titleWrap: { paddingVertical: 0, paddingHorizontal: 0 },
    title: { fontSize: 26, fontWeight: '800', color: '#e8edff', letterSpacing: 1.5, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
