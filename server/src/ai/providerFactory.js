const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

// The only place in the server that constructs an AI provider client.
// Everything else goes through ai/privacyGateway.js (a test enforces that
// nothing outside src/ai/ imports the SDK), so provider configuration and
// the consent/audit boundary live in one spot.
let client = null;
let override = null;

function getProviderClient() {
  if (override) return override;
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

// Tests inject a fake client here instead of calling the real API.
function setProviderClientForTests(fake) {
  override = fake;
}

module.exports = { getProviderClient, setProviderClientForTests, providerName: 'anthropic' };
