// Honest fallback rather than a fake heuristic chatbot: natural-language
// intent resolution over arbitrary questions isn't something a
// deterministic/regex layer can meaningfully do (unlike extraction, where a
// heuristic parser is a real option). When no LLM is configured, the chat
// feature says so clearly instead of guessing.
async function converse() {
  throw new Error(
    'The conversational assistant requires an LLM provider. Set ANTHROPIC_API_KEY (and optionally CHAT_PROVIDER=claude) to enable it.'
  );
}

module.exports = { name: 'unavailable', converse };
