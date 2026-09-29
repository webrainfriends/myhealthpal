import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

const BAND_COLORS = {
  low: healthStatusColors.watch,
  in_range: healthStatusColors.good,
  high: healthStatusColors.attention,
};

function formatDay(value) {
  return formatCalendarDate(value, { weekday: 'short', month: 'short', day: 'numeric' });
}

// "11% above lab average" - shown per day so each day's average reads
// against the same last lab report.
function comparisonLabel(comparison, t) {
  if (!comparison) return null;
  const percent = Math.abs(comparison.diffPercent);
  if (comparison.direction === 'above') return t('organDetail.glucose.vsLabAbove', { percent });
  if (comparison.direction === 'below') return t('organDetail.glucose.vsLabBelow', { percent });
  return t('organDetail.glucose.vsLabSimilar');
}

function labLines(lab, t) {
  const lines = [];
  if (lab.average) {
    lines.push(
      lab.average.basis === 'hba1c'
        ? t('organDetail.glucose.labHba1c', { hba1c: lab.average.hba1c, value: lab.average.value })
        : t('organDetail.glucose.labEstimated', { value: lab.average.value })
    );
  }
  if (lab.fasting) lines.push(t('organDetail.glucose.labFasting', { value: lab.fasting.value }));
  return lines;
}

function DayRow({ day, t, expanded, onToggle }) {
  const palette = BAND_COLORS[day.band] || healthStatusColors.no_data;
  const vsLab = comparisonLabel(day.vsLabAverage, t);
  return (
    <View style={styles.dayCard}>
      <TouchableOpacity style={styles.dayHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.dayMain}>
          <Text style={typography.body}>{formatDay(day.date)}</Text>
          <Text style={typography.caption}>
            {t('organDetail.glucose.readingCount', { count: day.count, plural: day.count === 1 ? '' : 's' })}
            {day.count > 1 ? ` · ${day.min}–${day.max}` : ''}
          </Text>
          {vsLab ? (
            <Text
              style={[
                styles.vsLab,
                { color: day.vsLabAverage.direction === 'similar' ? healthStatusColors.good.fg : colors.textSecondary },
              ]}
            >
              {day.vsLabAverage.direction === 'above' ? '↑ ' : day.vsLabAverage.direction === 'below' ? '↓ ' : ''}
              {vsLab}
            </Text>
          ) : null}
        </View>
        <View style={styles.dayValue}>
          <Text style={typography.heading}>
            {day.average} <Text style={styles.unit}>mg/dL</Text>
          </Text>
          <View style={[styles.pill, { backgroundColor: palette.bg }]}>
            <Text style={[styles.pillText, { color: palette.fg }]}>{expanded ? '▲' : '▼'} {t('organDetail.glucose.average')}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.readings}>
          {day.vsLabFasting && day.fastingAverage !== null ? (
            <Text style={styles.fastingLine}>
              {t('organDetail.glucose.fastingVsLab', { value: day.fastingAverage, lab: day.vsLabFasting.labValue })}
              {' · '}
              {comparisonLabel(day.vsLabFasting, t).replace('lab average', 'lab')}
            </Text>
          ) : null}
          {day.readings.map((reading, index) => {
            const readingPalette = BAND_COLORS[reading.band] || healthStatusColors.no_data;
            return (
              <View key={`${reading.time}-${index}`} style={styles.readingRow}>
                <Text style={styles.readingTime}>{reading.time}</Text>
                <Text style={styles.readingMeal} numberOfLines={1}>
                  {reading.mealContext || t('organDetail.glucose.noMeal')}
                </Text>
                <Text style={[styles.readingValue, { color: reading.band === 'in_range' ? colors.textPrimary : readingPalette.fg }]}>
                  {reading.value}
                  {reading.band === 'high' ? ' ↑' : reading.band === 'low' ? ' ↓' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// The diabetes card's meter section: one row per day with that day's average
// (of every reading uploaded for it) compared against the last lab report,
// tap a day to see the extracted rows behind it.
export default function GlucoseDailyCard({ summary }) {
  const t = useT();
  // undefined = untouched (newest day open by default, even though the
  // summary arrives after first render); null = user closed every day.
  const [pickedDate, setPickedDate] = useState(undefined);
  if (!summary) return null;
  const expandedDate = pickedDate === undefined ? summary.days[0]?.date : pickedDate;

  if (summary.readingCount === 0) {
    return (
      <View style={[styles.box, cardShadow]}>
        <Text style={typography.heading}>{t('organDetail.glucose.title')}</Text>
        <Text style={typography.bodySecondary}>{t('organDetail.glucose.empty')}</Text>
      </View>
    );
  }

  const { overall, lab } = summary;
  const lines = labLines(lab, t);
  const labDate = (lab.average || lab.fasting)?.date;
  const overallVs = comparisonLabel(overall.vsLabAverage, t);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.box, cardShadow]}>
        <Text style={typography.heading}>{t('organDetail.glucose.title')}</Text>
        <Text style={typography.bodySecondary}>{t('organDetail.glucose.subtitle')}</Text>
        <Text style={typography.caption}>
          {t('organDetail.glucose.period', { days: summary.dayCount, count: summary.readingCount })}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{overall.average}</Text>
            <Text style={typography.caption}>{t('organDetail.glucose.average')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{overall.min}–{overall.max}</Text>
            <Text style={typography.caption}>{t('organDetail.glucose.range')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{overall.inRangePercent}%</Text>
            <Text style={typography.caption}>{t('organDetail.glucose.inRange')}</Text>
          </View>
        </View>

        <View style={styles.labBox}>
          {lines.length > 0 ? (
            <>
              <Text style={styles.labHeading}>
                {t('organDetail.glucose.labHeading', {
                  date: labDate ? formatCalendarDate(labDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
                })}
              </Text>
              {lines.map((line) => (
                <Text key={line} style={typography.body}>{line}</Text>
              ))}
              {overallVs ? <Text style={styles.labCompare}>{overallVs}</Text> : null}
            </>
          ) : (
            <Text style={typography.bodySecondary}>{t('organDetail.glucose.noLab')}</Text>
          )}
        </View>
      </View>

      {summary.days.map((day) => (
        <DayRow
          key={day.date}
          day={day}
          t={t}
          expanded={expandedDate === day.date}
          onToggle={() => setPickedDate(expandedDate === day.date ? null : day.date)}
        />
      ))}
      <Text style={styles.note}>{t('organDetail.glucose.note')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: spacing.lg },
  box: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  stat: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  labBox: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 2,
    marginTop: spacing.xs,
  },
  labHeading: { fontSize: 12, fontWeight: '700', color: colors.primary },
  labCompare: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  dayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  dayHeader: {
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dayMain: { flex: 1, gap: 2 },
  dayValue: { alignItems: 'flex-end', gap: 4 },
  vsLab: { fontSize: 12, fontWeight: '600' },
  unit: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  pill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 10, fontWeight: '700' },
  readings: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  fastingLine: { fontSize: 12, color: colors.textSecondary },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  readingTime: { width: 46, fontSize: 13, color: colors.textSecondary },
  readingMeal: { flex: 1, fontSize: 13, color: colors.textSecondary },
  readingValue: { fontSize: 15, fontWeight: '700' },
  note: { fontSize: 11, color: colors.textTertiary, fontStyle: 'italic', marginTop: spacing.sm },
});
