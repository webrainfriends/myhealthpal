import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { cardCounts, cardHeadline, cardNotCheckedNote, describeFlag, directionArrow } from '../utils/organReadout';

const STATUS_LABEL_KEYS = {
  good: 'organDetail.statusGood',
  watch: 'organDetail.statusWatch',
  attention: 'organDetail.statusAttention',
  no_data: 'organDetail.statusNoData',
};

// One segment per tracked test - green for in range, the card's status
// color for out of range, grey for not checked (no range to compare) - so the bar reads as "how many of these tests
// came back normal", never as "how full / how well this organ works" the
// way a single percentage fill did. Out-of-range segments come first so
// they're visible even on a long panel.
const MAX_SEGMENTS = 12;

function ResultSegments({ normal, outOfRange, notChecked, palette }) {
  const unchecked = healthStatusColors.no_data.track;
  const segments = [
    ...Array.from({ length: outOfRange }, () => palette.fg),
    ...Array.from({ length: normal }, () => healthStatusColors.good.fg),
    ...Array.from({ length: notChecked }, () => unchecked),
  ];
  if (segments.length === 0) return <View style={[styles.segmentTrack, { backgroundColor: palette.track }]} />;
  // A long panel (a full blood count is 20+ tests) would turn into slivers -
  // past that point, show the same two groups as two proportional blocks.
  if (segments.length > MAX_SEGMENTS) {
    return (
      <View style={styles.segmentRow}>
        {outOfRange > 0 && <View style={[styles.segment, { flex: outOfRange, backgroundColor: palette.fg }]} />}
        {normal > 0 && <View style={[styles.segment, { flex: normal, backgroundColor: healthStatusColors.good.fg }]} />}
        {notChecked > 0 && <View style={[styles.segment, { flex: notChecked, backgroundColor: unchecked }]} />}
      </View>
    );
  }
  return (
    <View style={styles.segmentRow}>
      {segments.map((color, index) => (
        <View key={index} style={[styles.segment, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

// Names up to two out-of-range tests with an arrow for which way they're
// off - the thing a patient actually wants to know from a report - plus
// "+N more" for the rest (all of them are listed on the detail screen).
const MAX_NAMED_RESULTS = 2;

export default function OrganHealthCard({ organ, onPress }) {
  const t = useT();
  const palette = healthStatusColors[organ.status] || healthStatusColors.no_data;
  const { evaluated, normal, outOfRange, notChecked } = cardCounts(organ);
  const headline = cardHeadline(organ, t);
  const named = outOfRange.slice(0, MAX_NAMED_RESULTS);
  const moreCount = outOfRange.length - named.length;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
        <Text style={styles.icon}>{organ.icon}</Text>
      </View>

      <Text style={typography.heading} numberOfLines={2}>
        {organ.label}
      </Text>

      <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
        <Text style={[styles.statusPillText, { color: palette.fg }]}>
          {t(STATUS_LABEL_KEYS[organ.status] || STATUS_LABEL_KEYS.no_data)}
        </Text>
      </View>

      {headline ? (
        <Text style={[styles.headline, { color: outOfRange.length ? palette.fg : healthStatusColors.good.fg }]}>
          {headline}
        </Text>
      ) : null}

      {evaluated > 0 && <ResultSegments normal={normal} outOfRange={outOfRange.length} notChecked={notChecked} palette={palette} />}

      {named.map((result) => (
        <Text key={result.code || result.displayName} style={styles.flagLine} numberOfLines={2}>
          <Text style={{ color: palette.fg, fontWeight: '800' }}>{directionArrow(result)} </Text>
          {result.displayName} · {describeFlag(result, t)}
        </Text>
      ))}
      {moreCount > 0 && <Text style={typography.caption}>{t('organDetail.moreCount', { count: moreCount })}</Text>}
      {evaluated > 0 && notChecked > 0 && <Text style={typography.caption}>{cardNotCheckedNote(organ, t)}</Text>}

      {organ.trackedCount === 0 ? (
        <Text style={typography.caption} numberOfLines={1}>
          {t(organ.suggestedTests?.length ? 'organDetail.tapToAddTests' : 'organDetail.noResultsTrackedYet')}
        </Text>
      ) : evaluated === 0 ? (
        <Text style={typography.caption} numberOfLines={2}>
          {t('organDetail.cardNotEvaluated', { count: organ.trackedCount, plural: organ.trackedCount === 1 ? '' : 's' })}
        </Text>
      ) : null}
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
  headline: {
    fontSize: 13,
    fontWeight: '700',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 2,
    height: 8,
    marginTop: 2,
  },
  segment: {
    flex: 1,
    borderRadius: radii.pill,
  },
  segmentTrack: {
    height: 8,
    borderRadius: radii.pill,
    marginTop: 2,
  },
  flagLine: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
