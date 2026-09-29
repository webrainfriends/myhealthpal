const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

// Guards against a broken merge leaving the app unable to start (a missing
// require once took production down with a 502): loading the app and
// hitting a public route plus every router mount must work.
test('app loads and public/auth-guarded routes respond', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/auth/config`)).status, 200);
    for (const path of ['/api/activity/workouts/exercises', '/api/activity/summary', '/api/water/summary']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401, path);
    }
  } finally {
    server.close();
    await require('../src/db/pool').end();
  }
});
