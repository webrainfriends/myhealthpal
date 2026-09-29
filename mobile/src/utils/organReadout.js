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

// The same flag as a standalone label ("Well above range", "Slightly
// low") for a per-test pill - capitalized, since it isn't mid-sentence.
export function flagLabel(result, t) {
  const text = describeFlag(result, t);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Older/cached payloads may predate evaluatedCount/outOfRange - derive them
// from the counts every payload has always carried.
export function cardCounts(organ) {
  const outOfRange = organ.outOfRange || [];
  const evaluated = organ.evaluatedCount ?? (organ.normalCount || 0) + (organ.attentionCount || 0);
  const notChecked = Math.max(0, (organ.trackedCount || 0) - evaluated);
  return { evaluated, normal: organ.normalCount || 0, outOfRange, notChecked };
}

// The one-line headline for a card: "All 5 tests normal" / "5 of 8 tests
// outside normal range", or null when nothing has been evaluated yet. The
// total is every tracked test - the same number of tests the detail screen
// lists - so a card never says "5 of 5" over a list of 8. Tests that
// couldn't be checked are named separately (notCheckedNote). Used verbatim
// by both the dashboard card and the detail screen's hero, so tapping a
// card never re-states the same numbers a different way.
export function cardHeadline(organ, t) {
  const { evaluated, normal, outOfRange, notChecked } = cardCounts(organ);
  if (evaluated === 0) return null;
  const total = evaluated + notChecked;
  if (outOfRange.length === 0) {
    return notChecked === 0
      ? t('organDetail.cardAllNormal', { count: total, plural: total === 1 ? '' : 's' })
      : t('organDetail.cardSomeNormal', { count: normal, total });
  }
  return t('organDetail.cardOutOfRange', { count: outOfRange.length, total });
}

// "LDL Cholesterol (well above range), HDL Cholesterol (slightly low)"
export function outOfRangeList(organ, t) {
  return cardCounts(organ)
    .outOfRange.map((result) => `${result.displayName} (${describeFlag(result, t)})`)
    .join(', ');
}

// "3 not checked (no reference range): Beta Cell Function, ...", or null.
// Names them, since these are exactly the tests someone looks for when the
// counts don't add up to what they remember being on the report.
export function notCheckedNote(organ, t) {
  const { notChecked } = cardCounts(organ);
  if (notChecked === 0) return null;
  const names = (organ.parameters || []).filter((p) => p.resultStatus === 'unknown').map((p) => p.displayName);
  return t('organDetail.notCheckedNote', { count: notChecked, list: names.join(', ') || '—' });
}

// The card's short form: "3 not checked (no reference range)".
export function cardNotCheckedNote(organ, t) {
  const { notChecked } = cardCounts(organ);
  return notChecked === 0 ? null : t('organDetail.cardNotChecked', { count: notChecked });
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
