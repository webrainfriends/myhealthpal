// Theme tokens for MyHealthPal. Every screen and component pulls
// colors/spacing from here so the app reads as one consistent system: a
// bright, energetic violet-to-pink brand over soft lavender surfaces, with
// clear (still accessible) status colors for anything health-related.

export const colors = {
  background: '#F7F5FF',
  surface: '#FFFFFF',
  surfaceMuted: '#F0EDFF',
  border: '#E6E1FA',
  textPrimary: '#1A1433',
  textSecondary: '#57527A',
  textTertiary: '#9A95B5',
  primary: '#6C4DFF',
  primaryMuted: '#EFEBFF',
  accent: '#FF4F9A',
  accentMuted: '#FFE8F2',
  success: '#0FB981',
  successMuted: '#E2F9F0',
  warning: '#FF9500',
  warningMuted: '#FFF3E0',
  danger: '#FF3B5C',
  dangerMuted: '#FFEBEF',
  overlay: 'rgba(26, 20, 51, 0.45)',
  onBrand: '#FFFFFF',
  onBrandMuted: 'rgba(255, 255, 255, 0.82)',
};

// Multi-stop gradients (top-left -> bottom-right) rendered by
// GradientFill. `brand` is the signature look - the login screen, the
// dashboard hero, primary buttons and the mascot all use it so the app is
// instantly recognisable.
export const gradients = {
  brand: ['#6C4DFF', '#A94BFF', '#FF4F9A'],
  sunrise: ['#FF8A4C', '#FF4F9A'],
  ocean: ['#1FD1C1', '#4F7BFF'],
  lime: ['#34D399', '#0FB981'],
};

export const statusColors = {
  Uploaded: { fg: colors.textSecondary, bg: colors.surfaceMuted },
  Processing: { fg: colors.primary, bg: colors.primaryMuted },
  'Needs Review': { fg: colors.warning, bg: colors.warningMuted },
  Completed: { fg: colors.success, bg: colors.successMuted },
  Failed: { fg: colors.danger, bg: colors.dangerMuted },
  'AI estimate': { fg: colors.primary, bg: colors.primaryMuted },
};

// A medication's own lifecycle status (distinct from a scan's
// ingestion_status above, which reuses statusColors as-is).
export const medicationStatusColors = {
  active: { fg: colors.success, bg: colors.successMuted },
  completed: { fg: colors.textSecondary, bg: colors.surfaceMuted },
  discontinued: { fg: colors.textTertiary, bg: colors.surfaceMuted },
};

// Medication alert severity -> color, shared by the alert banner and
// medication detail screen.
export const alertSeverityColors = {
  info: { fg: colors.primary, bg: colors.primaryMuted },
  attention: { fg: colors.warning, bg: colors.warningMuted },
  important: { fg: colors.danger, bg: colors.dangerMuted },
};

// Organ Health Score status -> color, shared by the dashboard's organ cards
// and the organ detail screen so the same percentage always reads the same
// color everywhere.
export const healthStatusColors = {
  good: { fg: colors.success, bg: colors.successMuted, track: '#CBF3DF' },
  watch: { fg: colors.warning, bg: colors.warningMuted, track: '#FDE3B8' },
  attention: { fg: colors.danger, bg: colors.dangerMuted, track: '#FBCFCB' },
  no_data: { fg: colors.textTertiary, bg: colors.surfaceMuted, track: colors.border },
};

// One fixed color per meal type - a label, not a good/bad status, so
// (unlike statusColors/healthStatusColors) every entry uses a neutral tone
// from the existing palette rather than success/warning/danger.
export const mealTypeColors = {
  breakfast: { fg: colors.warning, bg: colors.warningMuted },
  lunch: { fg: colors.success, bg: colors.successMuted },
  snack: { fg: colors.textSecondary, bg: colors.surfaceMuted },
  dinner: { fg: colors.primary, bg: colors.primaryMuted },
  supper: { fg: '#0E9FB4', bg: '#E1F7FA' },
};

// Apple Health-style activity rings - one fixed color per ring (not a
// good/bad status like healthStatusColors above), reusing this theme's own
// palette rather than Apple's neon red/green/cyan so it still reads as part
// of the same clinical-but-friendly system.
export const activityRingColors = {
  steps: { fg: colors.accent, track: colors.accentMuted },
  exerciseMinutes: { fg: colors.success, track: colors.successMuted },
  standHours: { fg: colors.primary, track: colors.primaryMuted },
};

// A soft, violet-tinted card elevation used across the dashboard's cards -
// subtle on both platforms rather than a hard drop-shadow.
export const cardShadow = {
  shadowColor: '#4B2BD6',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius: 16,
  elevation: 3,
};

// A stronger glow for brand-colored surfaces (hero banners, primary buttons).
export const brandShadow = {
  shadowColor: '#6C4DFF',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.3,
  shadowRadius: 20,
  elevation: 6,
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
  lg: 20,
  xl: 28,
  pill: 999,
};

export const typography = {
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400', color: colors.textPrimary },
  bodySecondary: { fontSize: 14, fontWeight: '400', color: colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '500', color: colors.textTertiary },
};

const theme = {
  colors,
  gradients,
  statusColors,
  healthStatusColors,
  medicationStatusColors,
  mealTypeColors,
  alertSeverityColors,
  activityRingColors,
  cardShadow,
  brandShadow,
  spacing,
  radii,
  typography,
};

export default theme;
