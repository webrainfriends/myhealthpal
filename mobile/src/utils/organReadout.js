// Turns an organ/custom card payload (see server organHealthService.js)
// into the sentences a doctor would use reading a report back to a patient:
// "4 of 5 tests normal", "LDL Cholesterol: well above range". Shared by the
// dashboard card, the organ detail screen, and both read-aloud summaries so
// every surface describes the same card the same way - and none of them
// headlines a bare percentage that reads as "this organ works at 60%".

// A single out-of-range result, described by direction and how far past
// its limit it is: "slightly high" / "high" / "well above range" /
// "critical". An abnormal qualitative result (e.g. a "Positive" urine
// protein) has no direction and just reads "abnormal".
export function describeFlag(result, t) {
  if (result.severity === 'critical') return t('organDetail.flagCritical');
  if (result.direction === 'high') {
    if (result.severity === 'marked') return t('organDetail.flagWellHigh');
    return result.deviationPercent !== null && result.deviationPercent !== undefined
      ? t('organDetail.flagSlightlyHigh')
      : t('organDetail.flagHigh');
  }
  if (result.direction === 'low') {
    if (result.severity === 'marked') return t('organDetail.flagWellLow');
    return result.deviationPercent !== null && result.deviationPercent !== undefined
      ? t('organDetail.flagSlightlyLow')
      : t('organDetail.flagLow');
  }
  return t('organDetail.flagAbnormal');
}

export function directionArrow(result) {
  if (result.direction === 'high') return '↑';
  if (result.direction === 'low') return '↓';
  return '!';
}

// Older/cached payloads may predate evaluatedCount/outOfRange - derive them
// from the counts every payload has always carried.
export function cardCounts(organ) {
  const outOfRange = organ.outOfRange || [];
  const evaluated = organ.evaluatedCount ?? (organ.normalCount || 0) + (organ.attentionCount || 0);
  return { evaluated, normal: organ.normalCount || 0, outOfRange };
}

// The one-line headline for a card: "All 5 tests normal" / "2 of 5 tests
// outside normal range", or null when nothing has been evaluated yet.
export function cardHeadline(organ, t) {
  const { evaluated, outOfRange } = cardCounts(organ);
  if (evaluated === 0) return null;
  if (outOfRange.length === 0) {
    return t('organDetail.cardAllNormal', { count: evaluated, plural: evaluated === 1 ? '' : 's' });
  }
  return t('organDetail.cardOutOfRange', { count: outOfRange.length, total: evaluated });
}

// "LDL Cholesterol (well above range), HDL Cholesterol (slightly low)"
export function outOfRangeList(organ, t) {
  return cardCounts(organ)
    .outOfRange.map((result) => `${result.displayName} (${describeFlag(result, t)})`)
    .join(', ');
}

// Spoken summary of one card, used by the dashboard's read-aloud.
export function cardSpeech(organ, t) {
  const headline = cardHeadline(organ, t);
  if (!headline) return `${organ.label}: ${t('organDetail.statusNoData')}.`;
  const list = outOfRangeList(organ, t);
  return list
    ? `${organ.label}: ${headline}. ${t('organDetail.outOfRangeList', { list })}`
    : `${organ.label}: ${headline}.`;
}
