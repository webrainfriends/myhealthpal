// A failure the model/user should see and can act on. Anything else thrown
// inside a tool becomes a generic message (no internals leak).
class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { ToolError };
