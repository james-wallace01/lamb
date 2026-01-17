import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function NotificationBanner({ visible, message, variant = 'info', theme, onHidden }) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const bgColor = useMemo(() => {
    if (!theme) return '#2563eb';
    if (variant === 'error') return theme.danger;
    return theme.primary;
  }, [theme, variant]);

  useEffect(() => {
    const show = () => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    };

    const hide = () => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -80, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    };

    if (visible) show();
    else hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!message) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { paddingTop: Math.max(insets.top, 10) }]}>
      <Animated.View
        style={[
          styles.banner,
          {
            backgroundColor: bgColor,
            transform: [{ translateY }],
            opacity,
          },
        ]}
      >
        <Text style={[styles.text, { color: theme?.onAccentText || '#fff' }]} numberOfLines={2}>
          {String(message)}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  banner: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  text: {
    fontWeight: '700',
    fontSize: 14,
  },
});
