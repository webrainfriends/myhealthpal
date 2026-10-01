const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { callTool, toolList } = require('./gateway');
const { getTool } = require('./tools');
const { ToolError } = require('./toolError');
const { logError } = require('../lib/safeLog');

const INSTRUCTIONS =
  "EyeMyHealth: the user's own health records (lab reports, trends, insights, medicines). " +
  'Use list_profiles first if the user mentions a family member. Cite where numbers come from, ' +
  'explain in plain language, never diagnose, and tell the user to see a clinician or emergency services for urgent symptoms.';

// One server per request (stateless Streamable HTTP): `auth` is the verified
// grant for this request only, so nothing can leak between callers.
function createMcpServer(auth) {
  const server = new Server({ name: 'eyemyhealth', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList(auth) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const { data, evidence } = await callTool(auth, name, args);
      // `raw` tools (ChatGPT's standard search/fetch) return exactly the shape
      // that client expects, without our {data, evidence} envelope.
      if (getTool(name)?.raw) {
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ data, evidence }) }],
        structuredContent: { data, evidence },
      };
    } catch (err) {
      if (err instanceof ToolError) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.code, message: err.message }) }] };
      }
      if (err.code === 'consent_required' || err.code === 'ai_consent_required') {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.code, message: err.message }) }] };
      }
      // Services signal user-fixable problems (not found, bad input) with a
      // 4xx `status` and a message written for the person - the REST routes
      // pass those through too.
      if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && err.message) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_request', message: err.message }) }] };
      }
      logError(`mcp tool ${name}`, err);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'tool_failed', message: 'That request failed. Try again or narrow it.' }) }] };
    }
  });

  return server;
}

module.exports = { createMcpServer };
