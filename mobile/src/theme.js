export const DEFAULT_DARK_MODE_ENABLED = true;

export const getTheme = (darkEnabled = DEFAULT_DARK_MODE_ENABLED) => {
  const isDark = darkEnabled !== false;

  if (isDark) {
    return {
      isDark: true,
      background: '#0b0b0f',
      surface: '#11121a',
      surfaceAlt: '#0f111a',
      border: '#1f2738',
      text: '#ffffff',
      textSecondary: '#c5c5d0',
      textMuted: '#9aa1b5',
      placeholder: '#80869b',
      primary: '#2563eb',
      link: '#9ab6ff',
      statusBar: 'light',
      dangerBg: '#3b0f0f',
      dangerBorder: '#ef4444',
      dangerText: '#fecaca',
      inputBg: '#11121a',
    };
  }

  // Light mode: mostly white UI.
  return {
    isDark: false,
    background: '#ffffff',
    surface: '#f6f7fb',
    surfaceAlt: '#ffffff',
    border: '#e5e7eb',
    text: '#111827',
    textSecondary: '#374151',
    textMuted: '#6b7280',
    placeholder: '#6b7280',
    primary: '#2563eb',
    link: '#2563eb',
    statusBar: 'dark',
    dangerBg: '#fee2e2',
    dangerBorder: '#ef4444',
    dangerText: '#991b1b',
    inputBg: '#ffffff',
  };
};
