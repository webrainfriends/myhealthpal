// Heuristic report summary generator. Kept behind a single function so a real
// LLM-backed summarizer can be swapped in later without touching call sites.

const ABNORMAL_FLAGS = new Set(['high', 'low', 'h', 'l', 'abnormal', 'positive', 'reactive']);

function generateSummary(parameters) {
  if (parameters.length === 0) {
    return 'No health parameters could be automatically extracted from this report. Please review the original document.';
  }

  const abnormal = parameters.filter((p) => p.status_flag && ABNORMAL_FLAGS.has(p.status_flag.toLowerCase()));
  const lowConfidence = parameters.filter((p) => p.needs_review);

  const parts = [`Extracted ${parameters.length} health parameter${parameters.length === 1 ? '' : 's'}.`];

  if (abnormal.length > 0) {
    const names = abnormal.slice(0, 5).map((p) => p.test_name).join(', ');
    parts.push(`${abnormal.length} flagged outside the reference range: ${names}${abnormal.length > 5 ? ', …' : ''}.`);
  } else {
    parts.push('All extracted values fall within their reference ranges.');
  }

  if (lowConfidence.length > 0) {
    parts.push(`${lowConfidence.length} value${lowConfidence.length === 1 ? '' : 's'} need manual review due to low extraction confidence.`);
  }

  return parts.join(' ');
}

module.exports = { generateSummary };
