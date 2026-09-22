import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';

// A compact, tappable count card for the dashboard - the same shape as
// OrganHealthCard (icon badge, big number, label) but for a count of items
// elsewhere in the app (insights, needs-attention) rather than a health
// score, so tapping always opens the full list behind the number.
export default function SummaryCard({ icon, count, label, subtitle, palette, onPress }) {
  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={[styles.count, { color: palette.fg }]}>{count}</Text>
      </View>
      <Text style={typography.heading} numberOfLines={1}>
        {label}
      </Text>
      <Text style={typography.caption} numberOfLines={1}>
        {subtitle}
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
    gap: 2,
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
  count: {
    fontSize: 24,
    fontWeight: '800',
  },
});
