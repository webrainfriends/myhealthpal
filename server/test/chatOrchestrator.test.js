const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

test.after(async () => {
  await pool.end();
});

test('an emergency message short-circuits before any provider/tool call', async () => {
  const { runTurn } = require('../src/chat/chatOrchestrator');
  const result = await runTurn({
    userId: '00000000-0000-0000-0000-000000000001',
    sessionId: null,
    userMessage: 'I have severe chest pain and shortness of breath',
    priorMessages: [],
  });
  assert.match(result.answer, /emergency|911|988/i);
  assert.deepEqual(result.evidence, []);
});

test('an ordinary question with no provider configured returns a clear, non-fabricated error', async () => {
  const originalProvider = process.env.CHAT_PROVIDER;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.CHAT_PROVIDER = 'unavailable';
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/chat/providers')];
  delete require.cache[require.resolve('../src/chat/chatOrchestrator')];

  const { runTurn } = require('../src/chat/chatOrchestrator');
  const result = await runTurn({
    userId: '00000000-0000-0000-0000-000000000001',
    sessionId: null,
    userMessage: 'What was my latest HbA1c?',
    priorMessages: [],
  });
  assert.match(result.answer, /requires an LLM provider/i);

  if (originalProvider === undefined) delete process.env.CHAT_PROVIDER;
  else process.env.CHAT_PROVIDER = originalProvider;
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});
