import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const RESULT_STATUS_KEYS = {
  normal: 'organDetail.resultNormal',
  abnormal: 'organDetail.resultAbnormal',
  unknown: 'organDetail.resultUnevaluated',
};

// The printed range when the report had one, else the app's own standards
// table (see organHealthService.js) - whichever the score actually used.
function rangeText(parameter, t) {
  if (parameter.referenceRangeRaw) return parameter.referenceRangeRaw;
  const std = parameter.standardRange;
  if (std && std.low !== null && std.low !== undefined && std.high !== null && std.high !== undefined) {
    return t('resultModal.generalReference', { low: std.low, high: std.high, source: std.source.toUpperCase() });
  }
  return null;
}

// Mirrors organHealthService.js's anchored parseRange on the server (a
// plain "min-max", optionally with a trailing unit - kept in sync by hand,
// small and stable) - used here only to compute "how far off" for display.
// A multi-tier band like HbA1c's isn't handled here either, same as
// server-side: it falls through to the standard range below instead.
const SIMPLE_RANGE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*[^\d]*$/;

function parsedRangeFor(parameter) {
  const match = parameter.referenceRangeRaw ? SIMPLE_RANGE_PATTERN.exec(parameter.referenceRangeRaw) : null;
  if (match) return { low: Number.parseFloat(match[1]), high: Number.parseFloat(match[2]) };

  const std = parameter.standardRange;
  if (std && std.low !== null && std.low !== undefined && std.high !== null && std.high !== undefined) {
    return { low: std.low, high: std.high };
  }
  return null;
}

function directionText(parameter, t) {
  const value = Number.parseFloat(parameter.value);
  const range = parsedRangeFor(parameter);
  if (parameter.resultStatus !== 'abnormal' || !Number.isFinite(value) || !range) return null;
  if (Number.isFinite(range.low) && value < range.low) {
    return t('resultModal.belowLow', { delta: (range.low - value).toFixed(1), low: range.low });
  }
  if (Number.isFinite(range.high) && value > range.high) {
    return t('resultModal.aboveHigh', { delta: (value - range.high).toFixed(1), high: range.high });
  }
  return null;
}

// A factual, non-diagnostic summary for one result - deliberately no
// fabricated "what this means for your health" content (this app's
// extraction system is itself built around never adding clinical
// interpretation beyond what a report states, and a plausible-sounding but
// unverified claim here would be worse than no popup at all). What it does
// show: the value, the range it was judged against, and by how much it's
// off - the same "why" a clinician would want, without guessing at cause.
export default function ResultSummaryModal({ parameter, onClose, onViewTrend }) {
  const t = useT();
  const visible = Boolean(parameter);
  if (!visible) return null;

  const palette = healthStatusColors[parameter.resultStatus === 'normal' ? 'good' : 'attention'] || healthStatusColors.no_data;
  const range = rangeText(parameter, t);
  const direction = directionText(parameter, t);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={typography.heading} numberOfLines={2}>
              {parameter.displayName}
            </Text>
            <View style={[styles.pill, { backgroundColor: palette.bg }]}>
              <Text style={[styles.pillText, { color: palette.fg }]}>
                {t(RESULT_STATUS_KEYS[parameter.resultStatus] || RESULT_STATUS_KEYS.unknown)}
              </Text>
            </View>
          </View>

          <Text style={styles.value}>
            {parameter.value ?? '—'} <Text style={styles.unit}>{parameter.unit || ''}</Text>
          </Text>

          {range && <Text style={typography.bodySecondary}>{t('resultModal.referenceRange', { range })}</Text>}
          {direction && <Text style={[typography.bodySecondary, { color: palette.fg }]}>{direction}</Text>}
          {!range && <Text style={typography.bodySecondary}>{t('resultModal.noRange')}</Text>}

          <Text style={styles.disclaimer}>{t('resultModal.disclaimer')}</Text>

          <View style={styles.actionsRow}>
            {onViewTrend && (
              <TouchableOpacity style={styles.secondaryButton} onPress={onViewTrend}>
                <Text style={styles.secondaryButtonLabel}>{t('resultModal.viewTrend')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonLabel}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },
  unit: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  primaryButtonLabel: {
    color: colors.surface,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  secondaryButtonLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
});
