const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { executeTool } = require('../src/chat/tools');

// This is the concrete verification of "a user cannot retrieve another
// user's data through prompt manipulation": every tool takes its userId
// from the orchestrator's injected context, never from model-supplied
// arguments, so even a valid-looking reportId/measurementId belonging to a
// different user must resolve to "not found" rather than leaking data.

let userAId;
let userBId;
let userBReportId;

test.before(async () => {
  const userA = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('chat-test-a@example.com', 'Test A') RETURNING id`
  );
  userAId = userA.rows[0].id;

  const userB = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('chat-test-b@example.com', 'Test B') RETURNING id`
  );
  userBId = userB.rows[0].id;

  const report = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path)
     VALUES ($1, 'secret.csv', 'text/csv', 'csv', 10, '/tmp/secret.csv') RETURNING id`,
    [userBId]
  );
  userBReportId = report.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userAId, userBId]]);
  await pool.end();
});

test('get_report_by_id refuses to return another user\'s report', async () => {
  const asAttacker = await executeTool('get_report_by_id', { reportId: userBReportId }, { userId: userAId });
  assert.equal(asAttacker.data.found, false);
  assert.deepEqual(asAttacker.evidence, []);
});

test('get_report_by_id returns the report to its actual owner', async () => {
  const asOwner = await executeTool('get_report_by_id', { reportId: userBReportId }, { userId: userBId });
  assert.equal(asOwner.data.report.id, userBReportId);
  assert.ok(asOwner.evidence.some((e) => e.type === 'report' && e.id === userBReportId));
});

test('an injected userId-shaped argument is ignored — context always wins', async () => {
  // Even if a caller tried to smuggle a user id into the tool arguments
  // (which the schema doesn't declare, but defends anyway), execute() never
  // reads args.userId — only context.userId.
  const result = await executeTool(
    'get_report_by_id',
    { reportId: userBReportId, userId: userBId, user_id: userBId },
    { userId: userAId }
  );
  assert.equal(result.data.found, false);
});

test('get_latest_report is scoped per-user and finds nothing for a user with no reports', async () => {
  const result = await executeTool('get_latest_report', {}, { userId: userAId });
  assert.equal(result.data.found, false);
});
