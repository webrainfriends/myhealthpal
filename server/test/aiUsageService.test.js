const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { requireAuth } = require('../src/middleware/auth');
const { signSession, verifySession } = require('../src/services/authService');
const { runWithContext } = require('../src/lib/requestContext');
const { estimateCostUsd, pricingFor, normalizeUsage, recordAiUsage, getUserUsageSummary, FEATURES } = require(
  '../src/services/aiUsageService'
);

let userAId;
let userBId;

test.before(async () => {
  const a = await pool.query(`INSERT INTO users (display_name) VALUES ('AI usage test A') RETURNING id`);
  const b = await pool.query(`INSERT INTO users (display_name) VALUES ('AI usage test B') RETURNING id`);
  userAId = a.rows[0].id;
  userBId = b.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM ai_usage_events WHERE user_id = ANY($1)', [[userAId, userBId]]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userAId, userBId]]);
  await pool.end();
});

async function listen(handler) {
  const server = handler.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('pricingFor resolves exact, dated, and longest-prefix model ids', () => {
  assert.deepEqual(pricingFor('claude-sonnet-5'), { input: 2, output: 10 });
  assert.equal(pricingFor('claude-sonnet-5-20260101').input, 2);
  // Must not fall through to the shorter "claude-opus-5" entry.
  assert.equal(pricingFor('claude-opus-5-5').input, 4);
  assert.equal(pricingFor('some-unknown-model'), null);
});

test('estimateCostUsd prices input, output, and cache tokens separately', () => {
  const tokens = normalizeUsage({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
  });
  // sonnet-5: $2 in, $10 out, 1.25x input cache write, 0.1x input cache read.
  assert.equal(estimateCostUsd('claude-sonnet-5', tokens), 2 + 10 + 2.5 + 0.2);
  assert.equal(estimateCostUsd('some-unknown-model', tokens), 0);
});

test('signSession issues a distinct session id per sign-in', () => {
  const user = { id: '77777777-7777-7777-7777-777777777777' };
  const first = verifySession(signSession(user));
  const second = verifySession(signSession(user));
  assert.equal(first.userId, user.id);
  assert.ok(first.sessionId);
  assert.notEqual(first.sessionId, second.sessionId);
});

test('recordAiUsage attributes usage to the current request context', async () => {
  const response = { model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 500 } };
  const id = await runWithContext({ userId: userAId, sessionId: 'session-a1' }, () =>
    recordAiUsage(FEATURES.CHAT, response)
  );
  const { rows } = await pool.query('SELECT * FROM ai_usage_events WHERE id = $1', [id]);
  assert.equal(rows[0].user_id, userAId);
  assert.equal(rows[0].session_id, 'session-a1');
  assert.equal(rows[0].feature, 'chat');
  assert.equal(rows[0].input_tokens, 1000);
  assert.equal(rows[0].output_tokens, 500);
  assert.equal(Number(rows[0].estimated_cost_usd), 0.007);
});

test('recordAiUsage never throws and skips a response with no usage', async () => {
  assert.equal(await recordAiUsage(FEATURES.CHAT, null), null);
  assert.equal(await recordAiUsage(FEATURES.CHAT, { content: [] }), null);
});

test('getUserUsageSummary totals by period, feature, and session, scoped to one user', async () => {
  await runWithContext({ userId: userAId, sessionId: 'session-a2' }, async () => {
    await recordAiUsage(FEATURES.REPORT_EXTRACTION, {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 2000, output_tokens: 1000 },
    });
  });
  await runWithContext({ userId: userBId, sessionId: 'session-b1' }, () =>
    recordAiUsage(FEATURES.CHAT, { model: 'claude-sonnet-5', usage: { input_tokens: 99999, output_tokens: 99999 } })
  );

  const summary = await getUserUsageSummary(userAId, { days: 30, currentSessionId: 'session-a2' });
  assert.equal(summary.period.requests, 2);
  assert.equal(summary.period.inputTokens, 3000);
  assert.equal(summary.period.outputTokens, 1500);
  assert.equal(summary.allTime.requests, 2);
  assert.equal(summary.currentSession.requests, 1);
  assert.equal(summary.currentSession.inputTokens, 2000);
  assert.deepEqual(summary.byFeature.map((f) => f.feature).sort(), ['chat', 'report_extraction']);
  assert.equal(summary.bySession.length, 2);
  assert.equal(summary.bySession.find((s) => s.isCurrent).sessionId, 'session-a2');
  assert.equal(summary.byDay.length, 1);
});

test('requireAuth carries the signed-in user and session into downstream async work', async () => {
  const token = signSession({ id: userAId });
  const { sessionId } = verifySession(token);
  const probe = express();
  probe.get('/probe', requireAuth, (req, res) => {
    // Detached like report ingestion's setImmediate, so the context has to
    // survive past the request handler itself.
    setImmediate(async () => {
      const id = await recordAiUsage(FEATURES.RECIPES, {
        model: 'claude-sonnet-5',
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      res.json({ id });
    });
  });
  const { server, base } = await listen(probe);
  try {
    const body = await (await fetch(`${base}/probe`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const { rows } = await pool.query('SELECT user_id, session_id FROM ai_usage_events WHERE id = $1', [body.id]);
    assert.equal(rows[0].user_id, userAId);
    assert.equal(rows[0].session_id, sessionId);
  } finally {
    server.close();
  }
});

test('GET /api/ai-usage returns only the caller\'s usage and flags the current session', async () => {
  const token = signSession({ id: userBId });
  const { sessionId } = verifySession(token);
  await runWithContext({ userId: userBId, sessionId }, () =>
    recordAiUsage(FEATURES.DIET_PHOTO, { model: 'claude-sonnet-5', usage: { input_tokens: 5, output_tokens: 5 } })
  );

  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/api/ai-usage?days=7`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.periodDays, 7);
    assert.equal(body.currentSession.sessionId, sessionId);
    assert.equal(body.currentSession.requests, 1);
    assert.ok(body.byFeature.every((f) => ['chat', 'diet_photo'].includes(f.feature)));

    const unauthenticated = await fetch(`${base}/api/ai-usage`);
    assert.equal(unauthenticated.status, 401);
  } finally {
    server.close();
  }
});
