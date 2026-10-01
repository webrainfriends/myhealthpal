// Small constructors so each feature module reads as a list of tools rather
// than repeated boilerplate. All of them keep the contract the gateway
// relies on: { name, description, inputSchema, scope, annotations, execute }.
function schema(properties = {}, required = []) {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

function readTool({ name, description, properties, required, scope = 'health:read', accountLevel = false, raw = false, execute }) {
  return {
    raw,
    name,
    description,
    inputSchema: schema(properties, required),
    scope,
    accountLevel,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    execute,
  };
}

// A tool that changes data. Anything non-read-only is refused for view-only
// family links by the gateway, whatever its scope.
function writeTool({ name, description, properties, required, scope = 'health:log', destructive = false, idempotent = false, execute }) {
  return {
    name,
    description,
    inputSchema: schema(properties, required),
    scope,
    accountLevel: false,
    mutates: true,
    annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false },
    execute,
  };
}

function evidence(type, rows, idField = 'id', labelField) {
  return (rows || []).filter((r) => r && r[idField]).map((r) => ({ type, id: r[idField], label: labelField ? r[labelField] : undefined }));
}

module.exports = { schema, readTool, writeTool, evidence };
