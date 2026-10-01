const chatTools = require('./chatTools');
const profiles = require('./profiles');

// Every tool: { name, description, inputSchema, scope, annotations, execute,
// accountLevel?, mutates? }. Feature modules are added here as they land.
const ALL_TOOLS = [...profiles, ...chatTools];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

function listTools() {
  return ALL_TOOLS;
}

function getTool(name) {
  return byName.get(name) || null;
}

module.exports = { listTools, getTool };
