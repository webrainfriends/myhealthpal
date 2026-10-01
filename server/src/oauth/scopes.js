// Scopes a connector grant can carry. A tool declares the one scope it needs
// (src/mcp/tools); the grant holder chose which of these to allow on the
// consent screen, so "full parity" exists but is opt-in per connection.
const SCOPES = {
  'health:read': 'See your reports, trends, insights, medicines, diet, water, workouts, retests and insurance.',
  'health:log': 'Log things on your behalf: water, meals, medicine doses, weight, retest check-ins.',
  'health:write': 'Edit or delete records, and add uploads and scans.',
  'family:manage': 'See and manage family profiles, invites and sponsor dashboards.',
};

const ALL_SCOPES = Object.keys(SCOPES);
// Offered pre-ticked on the consent screen; the rest are opt-in.
const DEFAULT_SCOPES = ['health:read'];

function parseScopes(value) {
  if (Array.isArray(value)) return value.filter((s) => typeof s === 'string');
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).filter(Boolean);
}

function normalizeScopes(requested) {
  const wanted = parseScopes(requested);
  const unknown = wanted.filter((s) => !SCOPES[s]);
  if (unknown.length > 0) {
    const err = new Error(`Unknown scope: ${unknown.join(' ')}`);
    err.oauthError = 'invalid_scope';
    throw err;
  }
  return [...new Set(wanted)];
}

module.exports = { SCOPES, ALL_SCOPES, DEFAULT_SCOPES, parseScopes, normalizeScopes };
