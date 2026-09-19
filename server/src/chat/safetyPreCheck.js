// Deterministic, keyword-based emergency detector that runs BEFORE any model
// call. It is intentionally not exhaustive — it's a best-effort net, not a
// substitute for real triage — but it means a message describing urgent
// symptoms never depends on an LLM's judgment (or has a chance to be
// answered from MyHealthPal's historical data as if that were relevant to
// an active emergency).
const EMERGENCY_PATTERNS = [
  /chest pain/i,
  /can'?t breathe/i,
  /difficulty breathing/i,
  /shortness of breath/i,
  /suicidal|suicide|kill myself|self[- ]harm|hurt myself|harm myself|want to die|end my life/i,
  /severe bleeding|won'?t stop bleeding/i,
  /stroke|droop(ing)?|slurr(ed|ing)?|sudden numbness/i,
  /anaphylaxis|severe allergic reaction|throat (is )?closing/i,
  /overdose|took too many pills/i,
  /unconscious|unresponsive|passed out/i,
  /heart attack/i,
];

const EMERGENCY_RESPONSE =
  "This sounds like it could be a medical emergency. I can't help with that here — please call your local emergency " +
  'number (911 in the US) or go to the nearest emergency room right away. If you are in crisis or thinking about ' +
  'harming yourself, please contact a crisis line (in the US: call or text 988) immediately. Once you are safe, I can ' +
  'help you look at your MyHealthPal history.';

function checkForEmergency(message) {
  const matched = EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
  return matched ? { isEmergency: true, response: EMERGENCY_RESPONSE } : { isEmergency: false };
}

module.exports = { checkForEmergency };
