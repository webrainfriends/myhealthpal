const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { render } = require('../scripts/mcp-tools-doc');
const { listTools } = require('../src/mcp/tools');

// docs/mcp-tools.md is generated from the registry; a stale copy means a tool
// was added or changed without regenerating (run `npm run mcp:docs`).
test('docs/mcp-tools.md matches the live tool registry', () => {
  const committed = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'mcp-tools.md'), 'utf8');
  assert.equal(committed, render(), 'docs/mcp-tools.md is out of date - run `npm run mcp:docs` in server/');
});

test('the Claude skill mentions every tool it relies on and no tool that does not exist', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'integrations', 'claude', 'eyemyhealth', 'skills', 'eyemyhealth', 'SKILL.md'), 'utf8');
  const names = new Set(listTools().map((t) => t.name));
  // Error codes the skill documents; they look like tool names but are not.
  const errorCodes = new Set(['consent_required', 'insufficient_scope', 'view_only', 'profile_forbidden', 'confirmation_invalid', 'rate_limited', 'invalid_request']);
  const mentioned = [...skill.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]).filter((n) => n.includes('_'));
  const toolLike = mentioned.filter((n) => !errorCodes.has(n) && /^(get|list|log|create|delete|remove|add|set|search|fetch|dismiss|rate|snooze|retest|upsert|find|compare|explain)_/.test(n));
  assert.ok(toolLike.length > 5, 'skill should reference concrete tools');
  for (const n of toolLike) assert.ok(names.has(n), `skill references unknown tool ${n}`);
});
