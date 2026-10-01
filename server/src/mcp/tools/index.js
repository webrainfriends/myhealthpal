const chatTools = require('./chatTools');
const profiles = require('./profiles');
const wellness = require('./wellness');
const careAndCover = require('./careAndCover');

// Every tool: { name, description, inputSchema, scope, annotations, execute,
// accountLevel?, mutates? }. Feature modules are added here as they land.
const ALL_TOOLS = [...profiles, ...chatTools, ...wellness, ...careAndCover];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

function listTools() {
  return ALL_TOOLS;
}

function getTool(name) {
  return byName.get(name) || null;
}

module.exports = { listTools, getTool };
