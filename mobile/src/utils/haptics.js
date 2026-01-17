import { Platform } from 'react-native';

let Haptics = null;
try {
  // eslint-disable-next-line global-require
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

const isSupported = () => Platform.OS === 'ios' && !!Haptics;

export async function hapticSelection() {
  if (!isSupported()) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // ignore
  }
}

export async function hapticSuccess() {
  if (!isSupported()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // ignore
  }
}

export async function hapticError() {
  if (!isSupported()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // ignore
  }
}
