import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';

const SEVERITY_COLORS = {
  info: colors.primary,
  attention: colors.warning,
  important: colors.danger,
};

export default function InsightCard({ insight, onPress, onDismiss, onFeedback }) {
  const accentColor = SEVERITY_COLORS[insight.severity] || colors.primary;
  const reportCount = new Set(insight.evidence.filter((e) => e.type === 'report').map((e) => e.id)).size;

  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: accentColor }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={[typography.heading, styles.title]} numberOfLines={2}>
          {insight.title}
        </Text>
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.dismissLabel}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={typography.bodySecondary}>{insight.explanation}</Text>
      <View style={styles.footerRow}>
        <Text style={typography.caption}>
          {reportCount} source{reportCount === 1 ? '' : 's'} · {new Date(insight.generated_at).toLocaleDateString()}
        </Text>
        {onFeedback && (
          <View style={styles.feedbackRow}>
            <TouchableOpacity onPress={() => onFeedback('useful')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.feedbackLabel}>Useful</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onFeedback('not_useful')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.feedbackLabel}>Not useful</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
  },
  dismissLabel: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  feedbackRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  feedbackLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
});
