const config = require('../config');
const { getAiClient, isAllowed } = require('../ai/privacyGateway');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');

// Grounded post-workout summary (issue #135 §10). The model only ever sees
// the aggregated metrics object built by workoutService - never video,
// landmarks or identifiers - and is told not to add anything not in it.

const SYSTEM_PROMPT = `You write a short post-workout summary for a fitness app from measured session data.
Rules:
- Use ONLY facts present in the JSON. Never invent observations, numbers or causes.
- 3-5 sentences, plain language, then one suggestion for next time. Mention tempo, left/right consistency, fatigue trend and comparison with the previous session only when those fields are present.
- Camera-based measurements are estimates; do not make medical, diagnostic or injury claims.
- You are not a trainer or physiotherapist; if form issues were flagged, suggest checking technique with a qualified trainer.`;

function templateSummary(m) {
  const parts = [];
  const planned = m.plannedReps ? ` of ${m.plannedReps} planned` : '';
  if (m.isHold) {
    parts.push(`You held ${m.exerciseName} for ${m.totalHoldSeconds || 0} seconds across ${m.completedSets} set(s).`);
  } else {
    parts.push(`You completed ${m.validReps} valid ${m.exerciseName} rep(s)${planned} across ${m.completedSets} of ${m.plannedSets} set(s).`);
    if (m.partialReps || m.invalidReps) {
      parts.push(`${m.partialReps} partial and ${m.invalidReps} invalid attempt(s) were not counted.`);
    }
  }
  if (m.topFormIssues.length) {
    const top = m.topFormIssues.map((f) => `${f.rule} (${f.count}x)`).join(', ');
    parts.push(`Most frequent form flags: ${top}.`);
  }
  if (m.tempo && m.tempo.actual) {
    const a = m.tempo.actual;
    const plan = m.tempo.planned && m.tempo.planned.down != null ? ` against a planned ${m.tempo.planned.down}s down / ${m.tempo.planned.up ?? '-'}s up` : '';
    parts.push(`Average tempo was ${a.downSeconds}s down${a.upSeconds != null ? ` / ${a.upSeconds}s up` : ''}${plan}.`);
  }
  if (m.symmetryPct != null) parts.push(`Left/right consistency was ${m.symmetryPct}%.`);
  if (m.trend) {
    parts.push(m.trend.fatigueDetected
      ? 'Movement quality dropped by the final set, which can be a sign of fatigue.'
      : 'Movement quality held steady from the first to the last set.');
  }
  if (m.comparison) {
    const c = m.comparison.validReps;
    parts.push(`Compared with your previous session you did ${Math.abs(c.change)} ${c.change >= 0 ? 'more' : 'fewer'} valid rep(s) (${c.current} vs ${c.previous}).`);
  }
  if (m.avgRestSeconds != null && m.targetRestSeconds != null) {
    parts.push(`Average rest was ${m.avgRestSeconds}s against a ${m.targetRestSeconds}s target.`);
  }
  parts.push('Estimates come from camera pose tracking and are not a substitute for a qualified trainer.');
  return parts.join(' ');
}

// Returns { text, source: 'ai' | 'template' }. Any failure or missing
// consent falls back to the deterministic template.
async function summarize(metrics, { userId }) {
  try {
    if (!config.anthropicApiKey || !(await isAllowed({ subjectUserId: userId, purpose: 'workout_coach' }))) {
      return { text: templateSummary(metrics), source: 'template' };
    }
    const client = await getAiClient({ subjectUserId: userId, purpose: 'workout_coach' });
    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(metrics) }],
    });
    recordAiUsage(FEATURES.WORKOUT_COACH, response);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return text ? { text, source: 'ai' } : { text: templateSummary(metrics), source: 'template' };
  } catch {
    return { text: templateSummary(metrics), source: 'template' };
  }
}

module.exports = { summarize, templateSummary };
