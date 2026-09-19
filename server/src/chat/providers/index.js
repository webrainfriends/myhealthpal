const config = require('../../config');
const claudeChatProvider = require('./claudeChatProvider');
const unavailableProvider = require('./unavailableProvider');

const PROVIDERS = {
  claude: claudeChatProvider,
  unavailable: unavailableProvider,
};

function getChatProvider(name = config.chatProvider) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown chat provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getChatProvider };
