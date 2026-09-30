import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { card3D, colors, radii, spacing, typography } from '../theme/theme';

// Each recent workout is its own raised, framed row with an icon badge and a
// chevron, so it reads as something to tap. The accent rotates per row (by
// `index`) to keep a list of them lively rather than one flat block.
const ACCENTS = [
  { fg: colors.primary, bg: colors.primaryMuted, icon: '🏋️' },
  { fg: colors.accent, bg: colors.accentMuted, icon: '💪' },
  { fg: colors.teal, bg: colors.tealMuted, icon: '🔥' },
  { fg: colors.success, bg: colors.successMuted, icon: '⚡' },
  { fg: colors.warning, bg: colors.warningMuted, icon: '🎯' },
];

export function workoutMeta(w) {
  const kcal = w.estimated_calories_low != null ? ` · ${w.estimated_calories_low}-${w.estimated_calories_high} kcal` : '';
  return `${new Date(w.completed_at).toLocaleDateString()} · ${w.valid_reps} reps${kcal}`;
}

export default function WorkoutHistoryRow({ workout, index = 0, onPress, onLongPress, leading, selected, accessibilityRole = 'button', accessibilityState }) {
  const accent = ACCENTS[index % ACCENTS.length];
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: accent.bg }, card3D(accent.fg), selected && styles.selected]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
    >
      {leading}
      <View style={[styles.badge, { backgroundColor: colors.surface }, card3D(accent.fg)]}>
        <Text style={styles.icon}>{accent.icon}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[typography.heading, styles.title]} numberOfLines={1}>{workout.exercise_name}</Text>
        <Text style={typography.bodySecondary} numberOfLines={2}>{workoutMeta(workout)}</Text>
      </View>
      <Text style={[styles.chevron, { color: accent.fg }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  selected: { borderWidth: 2, borderColor: colors.primary },
  badge: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3 },
  icon: { fontSize: 22 },
  body: { flex: 1, gap: 2 },
  title: { fontWeight: '800' },
  chevron: { fontSize: 32, lineHeight: 34, fontWeight: '700' },
});
