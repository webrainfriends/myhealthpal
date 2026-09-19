// Light theme tokens for MyHealthPal. Every screen and component pulls
// colors/spacing from here so the app reads as one consistent, light,
// clinical-but-friendly system.

export const colors = {
  background: '#F7F9FC',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F7',
  border: '#E1E7EF',
  textPrimary: '#101828',
  textSecondary: '#475467',
  textTertiary: '#98A2B3',
  primary: '#2F6FED',
  primaryMuted: '#EAF1FE',
  success: '#12B76A',
  successMuted: '#E7F8EF',
  warning: '#F79009',
  warningMuted: '#FFF4E5',
  danger: '#F04438',
  dangerMuted: '#FEECEC',
  overlay: 'rgba(16, 24, 40, 0.4)',
};

export const statusColors = {
  Uploaded: { fg: colors.textSecondary, bg: colors.surfaceMuted },
  Processing: { fg: colors.primary, bg: colors.primaryMuted },
  'Needs Review': { fg: colors.warning, bg: colors.warningMuted },
  Completed: { fg: colors.success, bg: colors.successMuted },
  Failed: { fg: colors.danger, bg: colors.dangerMuted },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const typography = {
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  heading: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400', color: colors.textPrimary },
  bodySecondary: { fontSize: 14, fontWeight: '400', color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '500', color: colors.textTertiary },
};

const theme = { colors, statusColors, spacing, radii, typography };

export default theme;
