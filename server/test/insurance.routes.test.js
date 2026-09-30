const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const config = require('../src/config');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');
const { setProviderClientForTests } = require('../src/ai/providerFactory');
const consentService = require('../src/security/consentService');

let userId;
let otherUserId;
let token;
let otherToken;
let reportId;
const previousKey = config.anthropicApiKey;

test.before(async () => {
  config.anthropicApiKey = 'test-key';
  userId = (await pool.query(`INSERT INTO users (display_name) VALUES ('insurance routes test') RETURNING id`)).rows[0].id;
  otherUserId = (await pool.query(`INSERT INTO users (display_name) VALUES ('insurance routes other') RETURNING id`)).rows[0].id;
  token = signSession({ id: userId });
  otherToken = signSession({ id: otherUserId });
  for (const id of [userId, otherUserId]) {
    await consentService.setConsent({ userId: id, consentType: 'medical_record_storage', granted: true, grantedBy: id, sourcePlatform: 'test' });
    await consentService.setConsent({ userId: id, consentType: 'ai_document_processing', granted: true, grantedBy: id, sourcePlatform: 'test' });
  }

  // A confirmed, out-of-range creatinine (kidney) and LDL (heart) for tagging.
  const report = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
     VALUES ($1, 'labs.pdf', 'application/pdf', 'pdf', 10, '/tmp/labs.pdf', 'Completed', '2026-09-01') RETURNING id`,
    [userId]
  );
  reportId = report.rows[0].id;
  for (const [code, name, value, unit, flag] of [
    ['creatinine', 'Creatinine', '1.9', 'mg/dL', 'High'],
    ['ldl_cholesterol', 'LDL Cholesterol', '95', 'mg/dL', 'Normal'],
  ]) {
    await pool.query(
      `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, raw_unit, status_flag, value_type, numeric_value, normalized_value, is_confirmed)
       SELECT $1, hp.id, $3, $4::text, $5, $6, 'numeric', $7::numeric, $7::numeric, true FROM health_parameters hp WHERE hp.code = $2`,
      [reportId, code, name, value, unit, flag, Number(value)]
    );
  }
});

test.after(async () => {
  config.anthropicApiKey = previousKey;
  setProviderClientForTests(null);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userId, otherUserId]]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function upload(base, authToken, filename, text, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), filename);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(`${base}/api/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: form });
}

async function waitForStatus(policyId, statuses) {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await pool.query('SELECT ingestion_status FROM insurance_policies WHERE id = $1', [policyId]);
    if (statuses.includes(rows[0]?.ingestion_status)) return rows[0].ingestion_status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for policy processing');
}

const POLICY_CSV = [
  'Policy Number,HP/2026/001',
  'Insurer,Acme Health Insurance Company Limited',
  'Sum Insured,500000',
  'Premium,12000 annual',
  'Waiting period,30 days',
  'Exclusions,Cosmetic surgery',
  'Cashless network hospitals,yes',
].join('\n');

const FAKE_EXTRACTION = {
  provider_name: 'Acme Health',
  plan_name: 'Gold Plus',
  policy_number: 'HP/2026/001',
  policy_type: 'Individual',
  sum_insured: 500000,
  currency: 'INR',
  policy_start_date: '2026-01-01',
  policy_end_date: '2026-12-31',
  premium_amount: 12000,
  premium_frequency: 'annual',
  next_premium_due_date: '2026-10-10',
  contacts: { provider_phone: '1800-000-000', agent_name: 'Asha Rao', agent_phone: '+91 90000 11111', agent_email: 'asha@example.com', support_phone: '1800-111-111' },
  coverage_items: [
    { organ_key: 'kidney', condition_name: 'Dialysis', coverage_status: 'covered', ceiling_amount: 300000, ceiling_basis: 'per_year', copay_percent: 10, clause_reference: 'Sec 4.2', clause_text: 'Dialysis is covered up to 3,00,000 per year.', confidence: 0.92 },
    { organ_key: 'heart', condition_name: 'Congenital heart disease', coverage_status: 'excluded', clause_reference: 'Excl 7', clause_text: 'Congenital internal diseases are excluded.', confidence: 0.9 },
    { organ_key: 'general', condition_name: 'Cosmetic surgery', coverage_status: 'excluded', confidence: 0.95 },
  ],
};

function installFakeExtraction(input = FAKE_EXTRACTION) {
  setProviderClientForTests({
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'tool_use', name: 'record_insurance_policy', input }],
        }),
      }),
    },
  });
}

test('auth is required and another account never sees a policy', async () => {
  installFakeExtraction();
  const { server, base } = await listen();
  try {
    assert.equal((await fetch(`${base}/api/insurance`)).status, 401);
    assert.equal((await fetch(`${base}/api/uploads`, { method: 'POST' })).status, 401);

    const uploaded = await (await upload(base, token, 'policy.csv', POLICY_CSV)).json();
    assert.equal(uploaded.category, 'insurance');
    const policyId = uploaded.record.id;
    await waitForStatus(policyId, ['Needs Review', 'Failed']);

    const other = { Authorization: `Bearer ${otherToken}` };
    assert.equal((await fetch(`${base}/api/insurance/${policyId}`, { headers: other })).status, 404);
    assert.equal((await fetch(`${base}/api/insurance/${policyId}/confirm`, { method: 'POST', headers: other })).status, 404);
    assert.equal((await fetch(`${base}/api/insurance/${policyId}`, { method: 'DELETE', headers: other })).status, 404);
    assert.equal((await (await fetch(`${base}/api/insurance`, { headers: other })).json()).policies.length, 0);
  } finally {
    server.close();
  }
});

test('a policy uploaded on the general Upload tab is read, reviewed, confirmed and then drives tags, gaps and reminders', async () => {
  installFakeExtraction();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const listedBefore = await (await fetch(`${base}/api/insurance`, { headers })).json();
    const policyId = (listedBefore.policies.find((p) => p.ingestionStatus === 'Needs Review') || {}).id;
    assert.ok(policyId, 'the earlier test left a policy awaiting review');

    // Unconfirmed: extracted and visible, but it drives nothing yet.
    assert.equal(listedBefore.tags.length, 0);
    assert.deepEqual(listedBefore.gaps, []);
    const detail = (await (await fetch(`${base}/api/insurance/${policyId}`, { headers })).json()).policy;
    assert.equal(detail.providerName, 'Acme Health');
    assert.equal(detail.contacts.agentName, 'Asha Rao');
    assert.equal(detail.contacts.supportPhone, '1800-111-111');
    assert.equal(detail.items.length, 3);
    const dialysis = detail.items.find((i) => i.conditionName === 'Dialysis');
    assert.equal(dialysis.ceilingAmount, 300000);
    assert.equal(dialysis.copayPercent, 10);
    assert.equal(dialysis.clauseReference, 'Sec 4.2');
    assert.equal(detail.raw_model_output, undefined);
    assert.equal(detail.storage_object_key, undefined);

    const confirm = await fetch(`${base}/api/insurance/${policyId}/confirm`, { method: 'POST', headers });
    assert.equal(confirm.status, 200);
    assert.equal((await fetch(`${base}/api/insurance/${policyId}/confirm`, { method: 'POST', headers })).status, 409);

    const overview = await (await fetch(`${base}/api/insurance`, { headers })).json();
    assert.deepEqual(overview.activePolicyIds, [policyId]);

    // Creatinine (kidney) is covered; LDL (heart) hits an exclusion only.
    const creatinine = overview.tags.find((t) => t.code === 'creatinine');
    assert.equal(creatinine.overall, 'covered');
    assert.equal(creatinine.abnormal, true);
    assert.equal(creatinine.policies[0].policyId, policyId);
    const ldl = overview.tags.find((t) => t.code === 'ldl_cholesterol');
    assert.equal(ldl.overall, 'not_covered');

    const kidney = overview.organCoverage.find((o) => o.organKey === 'kidney');
    assert.equal(kidney.entries[0].items[0].clauseText, 'Dialysis is covered up to 3,00,000 per year.');

    // Only the abnormal creatinine can raise a gap; kidney is covered with a
    // healthy ceiling and 10% co-pay, so none.
    assert.deepEqual(overview.gaps, []);

    const kinds = overview.upcoming.map((u) => `${u.kind}:${u.date}`);
    assert.ok(kinds.includes('premium:2026-10-10'));
    assert.ok(kinds.includes('renewal:2026-12-31'));

    const summary = await (await fetch(`${base}/api/insurance/summary`, { headers })).json();
    assert.equal(summary.policyCount, 1);
    assert.equal(summary.nextPremium.date, '2026-10-10');
  } finally {
    server.close();
  }
});

test('an abnormal result the policy excludes or never mentions surfaces as a gap with a draft to send', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await pool.query(`UPDATE health_measurements SET status_flag = 'High' WHERE report_id = $1`, [reportId]);
  const { server, base } = await listen();
  try {
    const overview = await (await fetch(`${base}/api/insurance`, { headers })).json();
    const heart = overview.gaps.find((g) => g.organKey === 'heart');
    assert.equal(heart.type, 'excluded');
    assert.equal(heart.contact.name, 'Asha Rao');
    assert.match(heart.draftMessage, /LDL Cholesterol/);
    assert.ok(heart.suggestedQuestions.length > 0);
  } finally {
    server.close();
  }
});

test('policy fields and coverage clauses can be corrected, with validation', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const policyId = (await (await fetch(`${base}/api/insurance`, { headers })).json()).policies[0].id;
    const patch = (body) => fetch(`${base}/api/insurance/${policyId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });

    assert.equal((await patch({ policyEndDate: '31/12/2026' })).status, 400);
    assert.equal((await patch({ premiumFrequency: 'fortnightly' })).status, 400);
    assert.equal((await patch({ sumInsured: -5 })).status, 400);
    assert.equal((await patch({})).status, 400);
    const ok = await patch({ agentPhone: '+91 98888 77777', nextPremiumDueDate: '2026-11-05', premiumFrequency: 'quarterly' });
    assert.equal(ok.status, 200);
    const updated = (await ok.json()).policy;
    assert.equal(updated.contacts.agentPhone, '+91 98888 77777');
    assert.equal(updated.nextPremiumDueDate.slice(0, 10), '2026-11-05');

    const added = await fetch(`${base}/api/insurance/${policyId}/items`, {
      method: 'POST', headers,
      body: JSON.stringify({ organKey: 'cancer', conditionName: 'Chemotherapy', coverageStatus: 'partial', ceilingAmount: 100000, copayPercent: 20 }),
    });
    assert.equal(added.status, 201);
    const item = (await added.json()).item;
    assert.equal(item.organKey, 'cancer');
    assert.equal((await fetch(`${base}/api/insurance/${policyId}/items`, { method: 'POST', headers, body: JSON.stringify({ organKey: 'cancer', conditionName: 'x', coverageStatus: 'maybe' }) })).status, 400);

    const edited = await fetch(`${base}/api/insurance/${policyId}/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ copayPercent: 150 }) });
    assert.equal(edited.status, 400);
    const edited2 = await fetch(`${base}/api/insurance/${policyId}/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ copayPercent: 5 }) });
    assert.equal((await edited2.json()).item.copayPercent, 5);

    assert.equal((await fetch(`${base}/api/insurance/${policyId}/items/${item.id}`, { method: 'DELETE', headers })).status, 204);
    assert.equal((await fetch(`${base}/api/insurance/${policyId}/items/not-a-uuid`, { method: 'DELETE', headers })).status, 404);
  } finally {
    server.close();
  }
});

test('the upload tab files each kind of document in the right place, and honours an explicit choice', async () => {
  installFakeExtraction();
  const { server, base } = await listen();
  try {
    const lab = await (await upload(base, token, 'labs.csv', 'Test,Result,Unit,Reference Range\nHemoglobin,13.1,g/dL,13.0-17.0\nCreatinine,1.4,mg/dL,0.7-1.3\n')).json();
    assert.equal(lab.category, 'lab_report');
    assert.equal(lab.next.screen, 'ReportDetail');
    assert.equal(lab.next.params.reportId, lab.record.id);

    const diet = await (await upload(base, token, 'plan.csv', 'Day,Breakfast,Lunch,Dinner\nDay 1,Oats,Dal rice,Roti\nDay 2,Idli,Curd rice,Soup\nDay 3,Poha,Rajma,Khichdi\n')).json();
    assert.equal(diet.category, 'diet_schedule', JSON.stringify(diet));
    const importRow = await pool.query('SELECT duration_auto, requested_duration_days FROM diet_schedule_imports WHERE id = $1', [diet.record.id]);
    assert.equal(importRow.rows[0].duration_auto, true);

    // An explicit choice is never second-guessed.
    const forced = await (await upload(base, token, 'notes.csv', 'a,b\n1,2\n', { category: 'insurance' })).json();
    assert.equal(forced.category, 'insurance');
    assert.equal(forced.method, 'user');
    assert.equal(forced.uncertain, false);

    // ...but a type the format can't satisfy is refused, not mis-filed.
    const food = await upload(base, token, 'meal.csv', 'a,b\n1,2\n', { category: 'food' });
    assert.equal(food.status, 400);
    const bad = await upload(base, token, 'x.csv', 'a,b\n1,2\n', { category: 'passport' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
    // Let background processing settle before the pool closes.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});

test('deleting a policy removes it and its clauses', async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const { server, base } = await listen();
  try {
    const { rows } = await pool.query('SELECT id FROM insurance_policies WHERE user_id = $1', [userId]);
    for (const row of rows) {
      assert.equal((await fetch(`${base}/api/insurance/${row.id}`, { method: 'DELETE', headers })).status, 204);
    }
    const left = await pool.query(
      'SELECT count(*)::int AS n FROM insurance_coverage_items WHERE policy_id = ANY($1)',
      [rows.map((r) => r.id)]
    );
    assert.equal(left.rows[0].n, 0);
    assert.equal((await (await fetch(`${base}/api/insurance`, { headers })).json()).policies.length, 0);
  } finally {
    server.close();
  }
});
