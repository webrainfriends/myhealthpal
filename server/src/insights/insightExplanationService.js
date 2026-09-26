const { getAiClient } = require('../ai/privacyGateway');
const config = require('../config');
const { languageInstruction, DEFAULT_LANGUAGE } = require('../services/languageService');

const SAFETY_TAIL =
  ' This is an automated observation based on your recorded data, not a diagnosis — consider discussing it with a healthcare professional if it is unexpected or concerning.';

function buildTitle(candidate) {
  const { type, templateData: d } = candidate;
  switch (type) {
    case 'new_result':
      return `First recorded ${d.parameterName}`;
    case 'change_from_previous':
      return d.qualitative
        ? `${d.parameterName} changed`
        : `${d.parameterName} is ${d.direction} than your last result`;
    case 'sustained_trend':
      return `${d.parameterName} has been ${d.direction} across your last ${d.windowSize} results`;
    case 'new_abnormal_flag':
      return `${d.parameterName} newly flagged ${d.flag}`;
    case 'repeated_abnormal':
      return `${d.parameterName} flagged abnormal ${d.windowSize} times in a row`;
    default:
      return d.parameterName;
  }
}

function buildHeuristicExplanation(candidate) {
  const { type, templateData: d, severity } = candidate;
  let text;
  switch (type) {
    case 'new_result':
      text = `This is the first confirmed ${d.parameterName} result in your history: ${d.value} ${d.unit}.`.trim();
      break;
    case 'change_from_previous':
      text = d.qualitative
        ? `Your ${d.parameterName} changed from "${d.previousValue}" to "${d.currentValue}" compared with your previous confirmed result.`
        : `Your ${d.parameterName} is ${Math.abs(d.pctChange)}% ${d.direction} than your previous confirmed result (${d.previousValue} ${d.unit} → ${d.currentValue} ${d.unit}).`;
      break;
    case 'sustained_trend':
      text = `Across your last ${d.windowSize} confirmed results, ${d.parameterName} moved from ${d.firstValue} ${d.unit} to ${d.lastValue} ${d.unit}, consistently ${d.direction}.`;
      break;
    case 'new_abnormal_flag':
      text = `Your latest ${d.parameterName} result (${d.value} ${d.unit}) was flagged "${d.flag}" by the source report; your previous confirmed result was not flagged.`;
      break;
    case 'repeated_abnormal':
      text = `Your last ${d.windowSize} confirmed ${d.parameterName} results have all been flagged "${d.flag}" by their source reports.`;
      break;
    default:
      text = `${d.parameterName} changed.`;
  }
  return severity === 'info' ? text : `${text}${SAFETY_TAIL}`;
}

// Every number that legitimately belongs in the explanation, derived only
// from the deterministic candidate data (never from a live DB lookup at
// phrasing time) — this is the allow-list the validator below checks
// against.
function allowedNumbers(templateData) {
  const numbers = new Set();
  for (const value of Object.values(templateData)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers.add(Math.round(value));
      numbers.add(Math.abs(Math.round(value)));
    }
  }
  return numbers;
}

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

// Rejects (rather than sanitizes) any generated explanation that mentions a
// number not traceable to the evidence payload — a hallucinated value must
// never reach the user, even rounded/reformatted. Deliberately strict: a
// false rejection just falls back to the always-correct heuristic template.
function explanationOnlyReferencesEvidenceNumbers(text, templateData) {
  const allowed = allowedNumbers(templateData);
  const found = text.match(NUMBER_PATTERN) || [];
  return found.every((token) => {
    const value = Math.round(Math.abs(Number.parseFloat(token)));
    return allowed.has(value);
  });
}

async function buildClaudeExplanation(candidate, language, userId) {
  const client = await getAiClient({ subjectUserId: userId, purpose: 'insight_explanation' });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 300,
    system: [
      'You rephrase a single structured health-data observation into one or two plain, warm sentences for a non-clinical reader.',
      'Use ONLY the numbers and facts given to you. Never introduce a number, date, or fact not present in the input.',
      'Never diagnose a condition or suggest starting, stopping, or changing a medication or dose.',
      'If the observation is at all notable, end with a short suggestion to discuss it with a healthcare professional if it is unexpected or concerning.',
    ].join(' ') + languageInstruction(language),
    messages: [
      { role: 'user', content: JSON.stringify({ type: candidate.type, severity: candidate.severity, data: candidate.templateData }) },
    ],
  });
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

// `language` is the user's preferred_language (see languageService.js).
// The heuristic fallback template is English-only (buildHeuristicExplanation
// has no per-language copy) - a non-English request with no AI provider
// configured, or where Claude's response fails the evidence-number check
// below, still gets a correct, safe explanation, just in English.
// `userId` is the data subject - without their AI-insights consent the
// gateway refuses and the heuristic text below is used.
async function generateExplanation(candidate, language = DEFAULT_LANGUAGE, userId = null) {
  const title = buildTitle(candidate);
  const heuristicText = buildHeuristicExplanation(candidate);

  if (config.insightProvider !== 'claude' || !config.anthropicApiKey) {
    return { title, explanation: heuristicText, provider: 'heuristic', model: null };
  }

  try {
    const claudeText = await buildClaudeExplanation(candidate, language, userId);
    if (claudeText && explanationOnlyReferencesEvidenceNumbers(claudeText, candidate.templateData)) {
      return { title, explanation: claudeText, provider: 'claude', model: config.anthropicModel };
    }
  } catch (err) {
    // Fall through to the heuristic explanation below.
  }
  return { title, explanation: heuristicText, provider: 'heuristic', model: null };
}

module.exports = { generateExplanation, buildHeuristicExplanation, explanationOnlyReferencesEvidenceNumbers, buildTitle };
