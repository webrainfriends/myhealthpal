// Bounds how long a parser may run on an untrusted upload. The underlying
// work can't be cancelled in-process, but the pipeline stops waiting and
// fails the report instead of hanging on a hostile file.
function withTimeout(promise, ms, label = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took too long and was stopped.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
