// Heuristic report summary generator. Kept behind a single function so a real
// LLM-backed summarizer can be swapped in later without touching call sites.

const ABNORMAL_FLAGS = new Set(['high', 'low', 'h', 'l', 'abnormal', 'positive', 'reactive']);

function generateSummary(measurements) {
  if (measurements.length === 0) {
    return 'No health parameters could be automatically extracted from this report. Please review the original document.';
  }

  const abnormal = measurements.filter((m) => m.status_flag && ABNORMAL_FLAGS.has(m.status_flag.toLowerCase()));
  const lowConfidence = measurements.filter((m) => m.needs_review);
  const duplicates = measurements.filter((m) => m.duplicate_status === 'suspected');

  const parts = [`Extracted ${measurements.length} health parameter${measurements.length === 1 ? '' : 's'}.`];

  if (abnormal.length > 0) {
    const names = abnormal.slice(0, 5).map((m) => m.raw_test_name).join(', ');
    parts.push(`${abnormal.length} flagged outside the reference range: ${names}${abnormal.length > 5 ? ', …' : ''}.`);
  } else {
    parts.push('All extracted values fall within their reference ranges.');
  }

  if (lowConfidence.length > 0) {
    parts.push(
      `${lowConfidence.length} value${lowConfidence.length === 1 ? '' : 's'} need manual review (low confidence or unmapped/ambiguous parameter).`
    );
  }

  if (duplicates.length > 0) {
    parts.push(`${duplicates.length} appear to duplicate a previously confirmed result.`);
  }

  return parts.join(' ');
}

// Heuristic summary for an imaging/radiology report (X-ray, CT, MRI, ...),
// which has narrative findings/impression rather than discrete parameters.
function generateImagingSummary(docInfo) {
  const studyLabel = [docInfo?.modality, docInfo?.bodyRegion].filter(Boolean).join(' — ') || 'Imaging study';
  const parts = [`${studyLabel} report processed.`];

  if (docInfo?.impression) {
    parts.push('See Impression and Findings below for the reported results.');
  } else if (docInfo?.findings) {
    parts.push('See Findings below for the reported results.');
  } else {
    parts.push('No findings or impression text could be automatically extracted. Please review the original document.');
  }

  if (docInfo?.recommendations) {
    parts.push('A follow-up recommendation was noted - see Recommendations below.');
  }

  return parts.join(' ');
}

module.exports = { generateSummary, generateImagingSummary };
