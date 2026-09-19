// Deterministic insight detectors. Every number here is calculated in code
// from persisted, confirmed measurements — never asked of an LLM. Each rule
// takes the current (newest) confirmed measurement plus its prior confirmed
// history for the same canonical parameter (oldest -> newest, excluding
// current) and returns a candidate or null.

const CHANGE_THRESHOLD_PCT = 15;
const LARGE_CHANGE_THRESHOLD_PCT = 30;
const TREND_WINDOW = 3;
const REPEATED_ABNORMAL_WINDOW = 3;

function isAbnormalFlag(flag) {
  return Boolean(flag) && !/normal/i.test(flag);
}

function comparableValue(m) {
  return m.normalizedValue ?? m.numericValue ?? null;
}

function detectNewResult(current, priorSeries) {
  if (priorSeries.length > 0) return null;
  return {
    type: 'new_result',
    severity: 'info',
    evidenceMeasurementIds: [current.measurementId],
    evidenceReportIds: [current.reportId],
    effectiveStartDate: current.effectiveDate,
    effectiveEndDate: current.effectiveDate,
    templateData: {
      parameterName: current.parameterDisplayName,
      value: current.qualitativeValue ?? current.value,
      unit: current.normalizedUnit || current.rawUnit || '',
    },
  };
}

function detectChangeFromPrevious(current, priorSeries) {
  if (priorSeries.length === 0) return null;
  const prior = priorSeries[priorSeries.length - 1];

  if (current.qualitativeValue) {
    if (String(current.qualitativeValue).toLowerCase() === String(prior.qualitativeValue || '').toLowerCase()) {
      return null;
    }
    return {
      type: 'change_from_previous',
      severity: 'attention',
      evidenceMeasurementIds: [prior.measurementId, current.measurementId],
      evidenceReportIds: [prior.reportId, current.reportId],
      effectiveStartDate: prior.effectiveDate,
      effectiveEndDate: current.effectiveDate,
      templateData: {
        parameterName: current.parameterDisplayName,
        previousValue: prior.qualitativeValue,
        currentValue: current.qualitativeValue,
        unit: '',
        qualitative: true,
      },
    };
  }

  const currentValue = comparableValue(current);
  const previousValue = comparableValue(prior);
  if (currentValue === null || previousValue === null || previousValue === 0) return null;

  const pctChange = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  if (Math.abs(pctChange) < CHANGE_THRESHOLD_PCT) return null;

  return {
    type: 'change_from_previous',
    severity: Math.abs(pctChange) >= LARGE_CHANGE_THRESHOLD_PCT ? 'attention' : 'info',
    evidenceMeasurementIds: [prior.measurementId, current.measurementId],
    evidenceReportIds: [prior.reportId, current.reportId],
    effectiveStartDate: prior.effectiveDate,
    effectiveEndDate: current.effectiveDate,
    templateData: {
      parameterName: current.parameterDisplayName,
      previousValue,
      currentValue,
      unit: current.normalizedUnit || current.rawUnit || '',
      pctChange: Math.round(pctChange),
      direction: pctChange > 0 ? 'higher' : 'lower',
      qualitative: false,
    },
  };
}

function detectSustainedTrend(current, priorSeries) {
  if (priorSeries.length < TREND_WINDOW - 1) return null;
  const window = [...priorSeries.slice(-(TREND_WINDOW - 1)), current];
  const values = window.map(comparableValue);
  if (values.some((v) => v === null)) return null;

  let increasing = true;
  let decreasing = true;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] <= values[i - 1]) increasing = false;
    if (values[i] >= values[i - 1]) decreasing = false;
  }
  if (!increasing && !decreasing) return null;

  return {
    type: 'sustained_trend',
    severity: 'attention',
    evidenceMeasurementIds: window.map((m) => m.measurementId),
    evidenceReportIds: window.map((m) => m.reportId),
    effectiveStartDate: window[0].effectiveDate,
    effectiveEndDate: window[window.length - 1].effectiveDate,
    templateData: {
      parameterName: current.parameterDisplayName,
      direction: increasing ? 'rising' : 'falling',
      windowSize: window.length,
      firstValue: values[0],
      lastValue: values[values.length - 1],
      unit: current.normalizedUnit || current.rawUnit || '',
    },
  };
}

function detectNewAbnormalFlag(current, priorSeries) {
  if (!isAbnormalFlag(current.statusFlag)) return null;
  const prior = priorSeries[priorSeries.length - 1];
  if (prior && isAbnormalFlag(prior.statusFlag)) return null; // repeated, not new

  return {
    type: 'new_abnormal_flag',
    severity: 'attention',
    evidenceMeasurementIds: [current.measurementId],
    evidenceReportIds: [current.reportId],
    effectiveStartDate: current.effectiveDate,
    effectiveEndDate: current.effectiveDate,
    templateData: {
      parameterName: current.parameterDisplayName,
      value: current.qualitativeValue ?? current.value,
      unit: current.normalizedUnit || current.rawUnit || '',
      flag: current.statusFlag,
    },
  };
}

function detectRepeatedAbnormal(current, priorSeries) {
  if (priorSeries.length < REPEATED_ABNORMAL_WINDOW - 1) return null;
  const window = [...priorSeries.slice(-(REPEATED_ABNORMAL_WINDOW - 1)), current];
  if (!window.every((m) => isAbnormalFlag(m.statusFlag))) return null;

  return {
    type: 'repeated_abnormal',
    severity: 'important',
    evidenceMeasurementIds: window.map((m) => m.measurementId),
    evidenceReportIds: window.map((m) => m.reportId),
    effectiveStartDate: window[0].effectiveDate,
    effectiveEndDate: window[window.length - 1].effectiveDate,
    templateData: {
      parameterName: current.parameterDisplayName,
      windowSize: window.length,
      flag: current.statusFlag,
    },
  };
}

// Order matters only for readability of results — every rule is independent
// and a single measurement can legitimately produce several insights (e.g.
// both newly abnormal and part of a sustained trend).
const RULES = [
  detectNewResult,
  detectChangeFromPrevious,
  detectSustainedTrend,
  detectNewAbnormalFlag,
  detectRepeatedAbnormal,
];

function evaluateRules(current, priorSeries) {
  return RULES.map((rule) => rule(current, priorSeries)).filter(Boolean);
}

module.exports = {
  evaluateRules,
  detectNewResult,
  detectChangeFromPrevious,
  detectSustainedTrend,
  detectNewAbnormalFlag,
  detectRepeatedAbnormal,
  isAbnormalFlag,
};
