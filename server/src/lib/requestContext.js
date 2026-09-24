const { AsyncLocalStorage } = require('async_hooks');

// Carries "which user / which sign-in session is this work for" through a
// request's whole async call chain - including work it hands off with
// setImmediate (report ingestion, diet/medication scans), which
// AsyncLocalStorage propagates too. Lets deep services like the Claude
// providers attribute AI token usage (aiUsageService.js) without threading
// a userId parameter through every function signature in between.
const storage = new AsyncLocalStorage();

function runWithContext(context, fn) {
  return storage.run(context, fn);
}

function getContext() {
  return storage.getStore() || {};
}

module.exports = { runWithContext, getContext };
