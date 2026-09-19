const config = require('../../config');
const heuristicProvider = require('./heuristicProvider');
const claudeProvider = require('./claudeProvider');

const PROVIDERS = {
  heuristic: heuristicProvider,
  claude: claudeProvider,
};

// Single call site for provider selection: routing to a different compatible
// LLM/document model means adding a module here, never touching the
// extraction/normalization/persistence logic that consumes it.
function getProvider(name = config.extractionProvider) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown extraction provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getProvider };
