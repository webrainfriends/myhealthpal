const { TOOLS } = require('../../chat/tools');

// The 12 read tools the in-app assistant already uses, re-exposed to external
// AI apps unchanged. They only read the active profile's records.
const chatTools = TOOLS.map((tool) => ({
  ...tool,
  scope: 'health:read',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}));

module.exports = chatTools;
