// A user-fixable problem raised by a shared service (bad input, not found,
// conflicting state). `status` is the HTTP code the REST routes answer with
// and the MCP connector treats any 4xx as a message to show the person -
// anything else thrown is an unexpected failure and is never echoed.
class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { ServiceError };
