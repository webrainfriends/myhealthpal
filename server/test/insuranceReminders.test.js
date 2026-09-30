const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { runInsuranceReminders } = require('../src/insurance/insuranceReminderService');

let userId;
let policyId;

test.before(async () => {
  userId = (await pool.query(`INSERT INTO users (display_name) VALUES ('insurance reminders test') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, 'test')`, [`ExponentPushToken[insurance-${userId}]`, userId]);
  policyId = (
    await pool.query(
      `INSERT INTO insurance_policies
         (user_id, original_filename, file_extension, ingestion_status, provider_name, plan_name, premium_amount, currency,
          premium_frequency, next_premium_due_date, policy_start_date, policy_end_date)
       VALUES ($1, 'p.pdf', 'pdf', 'Completed', 'Acme Health', 'Gold', 12000, 'INR', 'annual', '2026-10-05', '2026-01-01', '2027-01-01')
       RETURNING id`,
      [userId]
    )
  ).rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

const TODAY = new Date('2026-09-30T09:00:00Z');

test('a premium due within 14 days is pushed once, then never repeated for the same due date', async () => {
  const sent = [];
  const send = async (tokens, message) => sent.push({ tokens, message });

  const first = await runInsuranceReminders({ today: TODAY, send, ignoreSendWindow: true });
  assert.equal(first.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.title, /premium due in 5 days/);
  assert.match(sent[0].message.body, /12,000/);
  assert.equal(sent[0].message.data.screen, 'Insurance');

  const second = await runInsuranceReminders({ today: TODAY, send, ignoreSendWindow: true });
  assert.equal(second.sent, 0);

  // The renewal window (30 days out) opens later and is sent separately.
  const later = await runInsuranceReminders({ today: new Date('2026-12-15T09:00:00Z'), send, ignoreSendWindow: true });
  assert.equal(later.sent, 1);
  assert.match(sent[1].message.title, /renews in 17 days/);
});

test('reminders respect the account switch and the daytime send window', async () => {
  await pool.query('DELETE FROM insurance_reminders_sent WHERE policy_id = $1', [policyId]);
  const sent = [];
  const send = async (tokens, message) => sent.push({ tokens, message });

  // 02:00 UTC is outside the send window.
  assert.deepEqual(await runInsuranceReminders({ today: new Date('2026-09-30T02:00:00Z'), send }), { sent: 0 });

  await pool.query('UPDATE users SET insurance_reminders_enabled = false WHERE id = $1', [userId]);
  assert.equal((await runInsuranceReminders({ today: TODAY, send, ignoreSendWindow: true })).sent, 0);
  assert.equal(sent.length, 0);
});

test('an unconfirmed policy never triggers a reminder', async () => {
  await pool.query('UPDATE users SET insurance_reminders_enabled = true WHERE id = $1', [userId]);
  await pool.query(`UPDATE insurance_policies SET ingestion_status = 'Needs Review' WHERE id = $1`, [policyId]);
  const sent = [];
  assert.equal((await runInsuranceReminders({ today: TODAY, send: async (t, m) => sent.push(m), ignoreSendWindow: true })).sent, 0);
});
