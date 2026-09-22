import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';

// A dependency-free progress bar (no react-native-svg in this app) - a
// rounded track with a colored fill, good enough to read "how full" a
// percentage is at a glance.
function ScoreBar({ percent, palette }) {
  const width = percent === null ? 0 : Math.max(4, Math.min(100, percent));
  return (
    <View style={[styles.barTrack, { backgroundColor: palette.track }]}>
      <View style={[styles.barFill, { width: `${width}%`, backgroundColor: palette.fg }]} />
    </View>
  );
}

export default function OrganHealthCard({ organ, onPress }) {
  const palette = healthStatusColors[organ.status] || healthStatusColors.no_data;
  const scoreLabel = organ.scorePercent === null ? '—' : `${organ.scorePercent}%`;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
          <Text style={styles.icon}>{organ.icon}</Text>
        </View>
        <Text style={[styles.score, { color: palette.fg }]}>{scoreLabel}</Text>
      </View>

      <Text style={typography.heading} numberOfLines={2}>
        {organ.label}
      </Text>

      <ScoreBar percent={organ.scorePercent} palette={palette} />

      <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
        <Text style={[styles.statusPillText, { color: palette.fg }]}>{organ.statusLabel}</Text>
      </View>

      <Text style={typography.caption} numberOfLines={1}>
        {organ.trackedCount === 0
          ? organ.suggestedTests?.length
            ? 'Tap to see what tests to add'
            : 'No results tracked yet'
          : `${organ.trackedCount} test${organ.trackedCount === 1 ? '' : 's'} tracked`}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
  },
  score: {
    fontSize: 24,
    fontWeight: '800',
  },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
    marginTop: 2,
  },
  barFill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 2,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
