const pool = require('../db/pool');
const config = require('../config');
const { getChatProvider } = require('./providers');
const { getToolDefinitions, executeTool } = require('./tools');
const { checkForEmergency } = require('./safetyPreCheck');

const MAX_TOOL_ITERATIONS = 5;

const SYSTEM_PROMPT = [
  'You are the MyHealthPal assistant. You answer questions about the CURRENT user\'s own data anywhere in the app: health',
  'reports and lab measurements, trends over time, AI insights, AND their tracked medications/prescriptions (dose, form,',
  'frequency, what each is for, course/expiry dates, refill status, which lab parameters a medication is linked to, and',
  'whether enough time has passed to expect a linked result to have improved).',
  'You have tools that retrieve this user\'s data from MyHealthPal\'s records. For any question about the user\'s personal',
  'measurements, reports, trends, insights, or medications, you MUST call a tool rather than answering from memory or',
  'general knowledge — you have no other source of truth about this specific person. Never state a specific value, date,',
  'dose, or finding about the user that did not come from a tool result in this conversation.',
  'To answer about one specific medication (its linked parameters, dose assessment, or forecast), first call',
  'list_medications to find its id, then call get_medication_detail with that id — the same list-then-detail pattern used',
  'for insights.',
  'All deterministic numbers (min/max/average/percent change/direction, dose-vs-typical-range, standards-based in-range',
  'status, forecast stage) are already calculated for you in tool results — use those numbers and conclusions as given',
  'rather than recalculating or restating them differently.',
  'If a tool returns "found: false" or no relevant data, say plainly that you could not find that information rather than',
  'guessing or extrapolating.',
  'You are not a clinician. Never diagnose a condition, never state or imply a specific diagnosis, and never instruct the',
  'user to start, stop, or change a medication or dose — including in response to a forecast or an out-of-range result.',
  'You may explain what the recorded data shows and what a tool\'s own forecast/standards-range assessment already',
  'concluded, in plain language.',
  'When a finding is notable (abnormal flag, large change, sustained trend, a medication past its expected improvement',
  'window with no sign of the linked result moving, an expired medication), gently suggest discussing it with a',
  'healthcare professional rather than presenting your own clinical conclusion.',
  'Be concise. Do not include citation text or source links yourself — the application renders evidence links from the',
  'tool results separately.',
].join(' ');

async function logEvent(fields) {
  try {
    await pool.query(
      `INSERT INTO chat_events (session_id, event_type, tool_name, provider, model, latency_ms, tokens_in, tokens_out, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fields.sessionId || null,
        fields.eventType,
        fields.toolName || null,
        fields.provider || null,
        fields.model || null,
        fields.latencyMs ?? null,
        fields.tokensIn ?? null,
        fields.tokensOut ?? null,
        fields.success !== false,
      ]
    );
  } catch (err) {
    // Observability must never break the user-facing turn.
    // eslint-disable-next-line no-console
    console.error('Failed to log chat event:', err.message);
  }
}

function dedupeEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// One conversational turn: safety check, then a bounded tool-calling loop
// against the user's own data (scoped server-side, never by model input),
// ending in a final grounded answer plus the structured evidence IDs that
// back it. `priorMessages` is the session's prior user/assistant TEXT turns
// only — intermediate tool exchanges are not replayed across turns, so
// personal-data answers always come from a fresh tool call, never from
// memorized conversation history.
async function runTurn({ userId, sessionId, userMessage, priorMessages }) {
  const safety = checkForEmergency(userMessage);
  if (safety.isEmergency) {
    await logEvent({ sessionId, eventType: 'safety_intercept' });
    return { answer: safety.response, evidence: [] };
  }

  let provider;
  try {
    provider = getChatProvider();
  } catch (err) {
    return { answer: err.message, evidence: [] };
  }

  const messages = [...priorMessages, { role: 'user', content: userMessage }];
  const tools = getToolDefinitions();
  const allEvidence = [];
  let finalText = null;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const start = Date.now();
    let response;
    try {
      response = await provider.converse({ systemPrompt: SYSTEM_PROMPT, messages, tools });
    } catch (err) {
      await logEvent({ sessionId, eventType: 'error', provider: provider.name, success: false });
      return { answer: `Sorry, I ran into a problem answering that: ${err.message}`, evidence: [] };
    }

    await logEvent({
      sessionId,
      eventType: 'turn',
      provider: provider.name,
      model: config.anthropicModel,
      latencyMs: Date.now() - start,
      tokensIn: response.usage?.tokensIn,
      tokensOut: response.usage?.tokensOut,
    });

    if (response.type === 'text') {
      finalText = response.text;
      break;
    }

    messages.push({ role: 'assistant', text: response.text, toolCalls: response.calls });

    for (const call of response.calls) {
      const toolStart = Date.now();
      let result;
      let success = true;
      try {
        result = await executeTool(call.name, call.input, { userId });
      } catch (err) {
        success = false;
        result = { data: { error: err.message }, evidence: [] };
      }
      await logEvent({
        sessionId,
        eventType: 'tool_call',
        toolName: call.name,
        latencyMs: Date.now() - toolStart,
        success,
      });
      allEvidence.push(...result.evidence);
      messages.push({ role: 'tool_result', toolCallId: call.id, name: call.name, result: result.data });
    }
  }

  if (finalText === null) {
    finalText =
      "I wasn't able to finish answering that within the allowed number of steps. Could you ask a more specific question?";
  }

  return { answer: finalText, evidence: dedupeEvidence(allEvidence), provider: provider.name, model: config.anthropicModel };
}

module.exports = { runTurn };
