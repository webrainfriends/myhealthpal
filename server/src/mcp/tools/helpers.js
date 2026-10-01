// Small constructors so each feature module reads as a list of tools rather
// than repeated boilerplate. All of them keep the contract the gateway
// relies on: { name, description, inputSchema, scope, annotations, execute }.
function schema(properties = {}, required = []) {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

function readTool({ name, description, properties, required, scope = 'health:read', accountLevel = false, execute }) {
  return {
    name,
    description,
    inputSchema: schema(properties, required),
    scope,
    accountLevel,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    execute,
  };
}

function evidence(type, rows, idField = 'id', labelField) {
  return (rows || []).filter((r) => r && r[idField]).map((r) => ({ type, id: r[idField], label: labelField ? r[labelField] : undefined }));
}

module.exports = { schema, readTool, evidence };
