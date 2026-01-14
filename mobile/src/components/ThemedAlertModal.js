import React, { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';

const normalizeButtons = (buttons) => {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    return [{ text: 'OK' }];
  }
  return buttons.slice(0, 3).map((b) => ({
    text: b?.text ? String(b.text) : 'OK',
    onPress: typeof b?.onPress === 'function' ? b.onPress : null,
    style: b?.style ? String(b.style) : undefined,
  }));
};

export default function ThemedAlertModal({ visible, theme, title, message, buttons, onDismiss }) {
  const safeButtons = useMemo(() => normalizeButtons(buttons), [buttons]);

  if (!visible) return null;

  const tint = theme?.isDark ? 'dark' : 'light';

  const handlePress = (btn) => {
    try {
      onDismiss?.();
    } finally {
      try {
        btn?.onPress?.();
      } catch {
        // ignore
      }
    }
  };

  const buttonStyleFor = (btn) => {
    if (btn?.style === 'destructive') {
      return { borderColor: theme.dangerBorder };
    }
    return { borderColor: theme.border };
  };

  const buttonTextStyleFor = (btn) => {
    if (btn?.style === 'cancel') {
      return { color: theme.textMuted };
    }
    if (btn?.style === 'destructive') {
      return { color: theme.dangerBorder };
    }
    return { color: theme.primary };
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <BlurView intensity={75} tint={tint} style={StyleSheet.absoluteFill} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
          {!!title && <Text style={[styles.title, { color: theme.text }]}>{title}</Text>}
          {!!message && <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>}

          <View style={[styles.actions, { borderTopColor: theme.border }]}> 
            {safeButtons.map((btn, idx) => (
              <TouchableOpacity
                key={`${btn.text}-${idx}`}
                onPress={() => handlePress(btn)}
                style={[styles.button, idx > 0 ? styles.buttonSpacer : null, buttonStyleFor(btn)]}
                accessibilityRole="button"
              >
                <Text style={[styles.buttonText, buttonTextStyleFor(btn)]}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 6 },
      ios: {},
    }),
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  message: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 20,
  },
  actions: {
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 10,
  },
  buttonSpacer: {
    marginLeft: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
