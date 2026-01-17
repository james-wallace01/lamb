import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const DEFAULT_THRESHOLD = 60;

export default function PullToRefreshIndicator({ pullDistance = 0, refreshing = false, theme, threshold = DEFAULT_THRESHOLD }) {
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!refreshing) {
      rotate.stopAnimation();
      rotate.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      })
    );

    loop.start();
    return () => loop.stop();
  }, [refreshing, rotate]);

  const clamped = Math.max(0, Math.min(threshold, pullDistance || 0));
  const shown = refreshing || clamped > 0;
  const progress = threshold > 0 ? Math.max(0, Math.min(1, clamped / threshold)) : 0;

  const iconName = refreshing || clamped >= threshold ? 'refresh' : 'arrow-down';

  const opacity = refreshing ? 1 : progress;

  const transform = useMemo(() => {
    const rotateZ = rotate.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return [
      { translateY: clamped },
      refreshing ? { rotateZ } : { rotateZ: '0deg' },
      { scale: refreshing ? 1 : 0.9 + 0.1 * progress },
    ];
  }, [clamped, progress, refreshing, rotate]);

  if (!shown) return null;

  const color = theme?.textMuted || theme?.textSecondary || theme?.text;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Animated.View style={{ opacity, transform }}>
        <Ionicons name={iconName} size={18} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
});
