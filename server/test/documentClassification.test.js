const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const config = require('../src/config');
const { setProviderClientForTests } = require('../src/ai/providerFactory');
const consentService = require('../src/security/consentService');
const { classifyUpload, scoreText, heuristicDecision } = require('../src/services/documentClassificationService');

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('classification test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  setProviderClientForTests(null);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

const INSURANCE_TEXT = `
Star Health Insurance Company Limited
Policy Number: P/123/456   Policyholder: A Kumar
Sum Insured: 5,00,000   Premium: 12,400 per annum
Waiting period: 30 days initial, 24 months pre-existing diseases.
Exclusions: cosmetic surgery. Co-payment 10%. Cashless at network hospitals.`;

const LAB_TEXT = `
Sunrise Diagnostics - Pathology Laboratory
Test            Result   Unit    Reference Range
Hemoglobin      13.1     g/dL    13.0 - 17.0
Creatinine      1.4 H    mg/dL   0.7 - 1.3
Total Cholesterol 231    mg/dL   < 200`;

const DIET_TEXT = `7-day meal plan
Day 1: Breakfast - oats; Lunch - dal rice; Dinner - roti sabzi
Day 2: Breakfast - idli; Lunch - curd rice; Dinner - soup
Day 3: Breakfast - poha; Lunch - rajma; Dinner - khichdi`;

const FOOD_LABEL = `Nutrition Facts  Serving size 30 g  Calories 120 kcal
Protein 3 g  Total Fat 5 g  Ingredients: oats, sugar`;

test('scoring separates insurance, lab, diet-schedule and food documents', () => {
  const pick = (text, name) => Object.entries(scoreText(text, name)).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(pick(INSURANCE_TEXT, 'x.pdf'), 'insurance');
  assert.equal(pick(LAB_TEXT, 'x.pdf'), 'lab_report');
  assert.equal(pick(DIET_TEXT, 'x.pdf'), 'diet_schedule');
  assert.equal(pick(FOOD_LABEL, 'x.jpg'), 'food');
});

test('a lab report that mentions meals or claims is still a lab report', () => {
  const text = `${LAB_TEXT}\nFasting sample: no breakfast before test. Insurance claims: see reverse.`;
  assert.equal(heuristicDecision(text, 'report.pdf').category, 'lab_report');
});

test('the filename alone nudges but never decides a document with no other evidence', () => {
  assert.equal(heuristicDecision('', 'my_policy.pdf').category, null);
});

test('heuristic decisions carry a confidence and method; ambiguous text decides nothing', () => {
  const decision = heuristicDecision(INSURANCE_TEXT, 'doc.pdf');
  assert.equal(decision.category, 'insurance');
  assert.equal(decision.method, 'heuristic');
  assert.ok(decision.confidence >= 0.7);
  assert.equal(heuristicDecision('Hello there, this is a letter.', 'letter.pdf').category, null);
});

test('classifyUpload routes clear text documents without any AI call', async () => {
  let aiCalls = 0;
  setProviderClientForTests({ messages: { stream: () => { aiCalls += 1; throw new Error('should not be called'); } } });
  const csv = (text) => Buffer.from(text.replace(/\n/g, '\n'));
  const decision = await classifyUpload({ buffer: csv(INSURANCE_TEXT.split('\n').map((l) => `"${l.replace(/"/g, '')}"`).join('\n')), extension: 'csv', mimeType: 'text/csv', filename: 'policy.csv', userId });
  assert.equal(decision.category, 'insurance');
  assert.equal(decision.method, 'heuristic');
  assert.equal(aiCalls, 0);
});

test('Apple Health exports always go to the report pipeline', async () => {
  const decision = await classifyUpload({ buffer: Buffer.from('<HealthData/>'), extension: 'xml', filename: 'export.xml', userId });
  assert.equal(decision.category, 'lab_report');
});

test('an unclear document falls back to the lab-report pipeline when AI is unavailable', async () => {
  setProviderClientForTests(null);
  const decision = await classifyUpload({ buffer: Buffer.from('a,b\n1,2\n'), extension: 'csv', filename: 'numbers.csv', userId });
  assert.equal(decision.category, 'lab_report');
  assert.equal(decision.method, 'default');
});

test('an unclear document is classified by the AI reader once the person has consented', async () => {
  const previousKey = config.anthropicApiKey;
  config.anthropicApiKey = 'test-key';
  await consentService.setConsent({ userId, consentType: 'ai_document_processing', granted: true });
  let prompt;
  setProviderClientForTests({
    messages: {
      stream: (params) => {
        prompt = params;
        return {
          finalMessage: async () => ({
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: 'tool_use', name: 'classify_document', input: { category: 'insurance', confidence: 0.9, reason: 'Shows a policy schedule.' } }],
          }),
        };
      },
    },
  });
  try {
    const decision = await classifyUpload({ buffer: Buffer.from('Ref,Value\nABC,1\n'), extension: 'csv', filename: 'scan.csv', userId });
    assert.equal(decision.category, 'insurance');
    assert.equal(decision.method, 'ai');
    assert.equal(prompt.tool_choice.name, 'classify_document');
    // Only a short sample is ever sent.
    assert.ok(JSON.stringify(prompt.messages).length < 8000);

    // A low-confidence or "other" verdict never re-files the document.
    setProviderClientForTests({
      messages: {
        stream: () => ({
          finalMessage: async () => ({
            stop_reason: 'tool_use',
            usage: {},
            content: [{ type: 'tool_use', input: { category: 'food', confidence: 0.3, reason: 'Unsure.' } }],
          }),
        }),
      },
    });
    const unsure = await classifyUpload({ buffer: Buffer.from('Ref,Value\nABC,1\n'), extension: 'csv', filename: 'scan.csv', userId });
    assert.equal(unsure.category, 'lab_report');
    assert.equal(unsure.method, 'default');
  } finally {
    config.anthropicApiKey = previousKey;
    setProviderClientForTests(null);
  }
});

test('without AI consent an unclear document is never sent to the AI provider', async () => {
  const previousKey = config.anthropicApiKey;
  config.anthropicApiKey = 'test-key';
  await consentService.setConsent({ userId, consentType: 'ai_document_processing', granted: false });
  let aiCalls = 0;
  setProviderClientForTests({ messages: { stream: () => { aiCalls += 1; throw new Error('no'); } } });
  try {
    const decision = await classifyUpload({ buffer: Buffer.from('Ref,Value\nABC,1\n'), extension: 'csv', filename: 'scan.csv', userId });
    assert.equal(decision.category, 'lab_report');
    assert.equal(aiCalls, 0);
  } finally {
    config.anthropicApiKey = previousKey;
    setProviderClientForTests(null);
  }
});
