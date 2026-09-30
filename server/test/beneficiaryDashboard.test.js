const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const authService = require('../src/services/authService');

// Sponsor / caretaker beneficiary dashboard, end to end over HTTP:
//   sponsor  -> Ann (real account) and Ben (real account), summary only
//   caretaker -> Ben and the sponsor (sponsor tagged to the caretaker too)
//   Ann/Ben  -> see only themselves; never the sponsor, caretaker or each other

let server;
let baseUrl;
const people = {};

async function createUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [name]);
  return { user: rows[0], token: authService.signSession(rows[0]) };
}

async function call(who, method, path, { body, profileId } = {}) {
  const headers = { Authorization: `Bearer ${who.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (profileId) headers['X-Profile-Id'] = profileId;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// `owner` becomes sponsor/caretaker of `member` via the real invite flow.
async function link(owner, member, { role, access = 'view' }) {
  const invite = await call(member, 'POST', '/api/family/invites', { body: { role, access, relation: 'Parent' } });
  assert.equal(invite.status, 201);
  const redeemed = await call(owner, 'POST', '/api/family/invites/redeem', { body: { code: invite.body.invite.code } });
  assert.equal(redeemed.status, 200);
  return invite.body.invite;
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['Sponsor', 'Caretaker', 'Ann', 'Ben', 'Stranger']) people[name] = await createUser(`Bdash ${name}`);

  // Ann: an overdue-ish retest driver (out-of-range HbA1c), a low-supply
  // medication, an expiring one, and an active insurance policy.
  const annId = people.Ann.user.id;
  const report = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
     VALUES ($1, 'labs.pdf', 'application/pdf', 'pdf', 10, '/tmp/labs.pdf', 'Completed', now()::date - 200) RETURNING id`,
    [annId]
  );
  await pool.query(
    `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, raw_unit, status_flag, value_type, numeric_value, normalized_value, is_confirmed)
     SELECT $1, hp.id, 'HbA1c', '8.1', '%', 'High', 'numeric', 8.1, 8.1, true FROM health_parameters hp WHERE hp.code = 'hba1c'`,
    [report.rows[0].id]
  );
  await pool.query(
    `INSERT INTO medications (user_id, name, frequency_per_day, times_of_day, quantity_dispensed, start_date, status, is_confirmed)
     VALUES ($1, 'Metformin', 2, ARRAY['morning','night'], 30, now()::date - 14, 'active', true)`,
    [annId]
  );
  await pool.query(
    `INSERT INTO medications (user_id, name, frequency_per_day, expiry_date, status, is_confirmed)
     VALUES ($1, 'Vitamin D', 1, now()::date + 10, 'active', true)`,
    [annId]
  );
  await pool.query(
    `INSERT INTO insurance_policies (user_id, original_filename, file_extension, ingestion_status, provider_name, plan_name, sum_insured, currency,
                                     policy_start_date, policy_end_date, confirmed_at)
     VALUES ($1, 'p.pdf', 'pdf', 'Completed', 'Acme Health', 'Gold', 500000, 'INR', now()::date - 335, now()::date + 20, now())`,
    [annId]
  );

  // Ben has nothing at all recorded.
  await link(people.Sponsor, people.Ann, { role: 'sponsor' });
  await link(people.Sponsor, people.Ben, { role: 'sponsor' });
  await link(people.Caretaker, people.Ben, { role: 'caretaker', access: 'manage' });
  await link(people.Caretaker, people.Sponsor, { role: 'caretaker', access: 'view' });
});

test.after(async () => {
  server.close();
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(people).map((p) => p.user.id)]);
  await pool.end();
});

test('sponsor dashboard summarises tests due, cover, medications and out-of-range labs', async () => {
  const res = await call(people.Sponsor, 'GET', '/api/family/dashboard');
  assert.equal(res.status, 200);
  const ids = res.body.beneficiaries.map((b) => b.id).sort();
  assert.deepEqual(ids, [people.Ann.user.id, people.Ben.user.id].sort());
  assert.equal(res.body.totals.beneficiaryCount, 2);

  const ann = res.body.beneficiaries.find((b) => b.id === people.Ann.user.id);
  assert.equal(ann.role, 'sponsor');
  assert.equal(ann.attention !== 'ok', true);
  assert.equal(res.body.beneficiaries[0].id, ann.id, 'the person needing attention is listed first');

  assert.equal(ann.insurance.activePolicyCount, 1);
  assert.equal(ann.insurance.upcoming.some((d) => d.kind === 'renewal'), true, 'renewal in 20 days is flagged');

  assert.equal(ann.medications.activeCount, 2);
  assert.equal(ann.medications.refillSoonCount, 1);
  assert.equal(ann.medications.expiringSoonCount, 1);
  assert.deepEqual(ann.medications.items.find((m) => m.name === 'Metformin').timesOfDay, ['morning', 'night']);

  assert.equal(ann.health.outOfRangeCount, 1);
  assert.equal(ann.health.outOfRange[0].code, 'hba1c');
  assert.equal(ann.testsDue.items.some((t) => t.parameterCode === 'hba1c'), true, 'out-of-range HbA1c drives a due test');

  const ben = res.body.beneficiaries.find((b) => b.id === people.Ben.user.id);
  assert.equal(ben.attention, 'ok');
  assert.equal(ben.health.outOfRangeCount, 0);
});

test('a sponsor never sees a beneficiary\'s full profile', async () => {
  const acting = await call(people.Sponsor, 'GET', '/api/retest', { profileId: people.Ann.user.id });
  assert.equal(acting.status, 403);
  const meds = await call(people.Sponsor, 'GET', '/api/medications', { profileId: people.Ann.user.id });
  assert.equal(meds.status, 403);
  // ...and the sponsor's profile switcher doesn't list sponsored people.
  const family = await call(people.Sponsor, 'GET', '/api/family');
  assert.deepEqual(family.body.profiles.map((p) => p.isSelf), [true]);
});

test('beneficiaries see only themselves: no sponsor, caretaker or peer data', async () => {
  for (const who of [people.Ann, people.Ben]) {
    const res = await call(who, 'GET', '/api/family/dashboard');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.beneficiaries, []);
    assert.equal(res.body.totals.beneficiaryCount, 0);
  }
  // They can't act as their sponsor, their caretaker, or each other.
  for (const target of [people.Sponsor, people.Caretaker, people.Ben]) {
    assert.equal((await call(people.Ann, 'GET', '/api/retest', { profileId: target.user.id })).status, 403);
  }
  // Ann can see who has access to her, so she can revoke it.
  const family = await call(people.Ann, 'GET', '/api/family');
  assert.deepEqual(family.body.sharedWith.map((s) => [s.id, s.role]), [[people.Sponsor.user.id, 'sponsor']]);
});

test('a caretaker sees only the people tagged to them, and can act as them', async () => {
  const dash = await call(people.Caretaker, 'GET', '/api/family/dashboard');
  const ids = dash.body.beneficiaries.map((b) => b.id).sort();
  // Ann is the sponsor's beneficiary, not the caretaker's - so she is absent
  // even though the caretaker can see the sponsor.
  assert.deepEqual(ids, [people.Ben.user.id, people.Sponsor.user.id].sort());
  assert.equal(dash.body.beneficiaries.every((b) => b.role === 'caretaker'), true);

  assert.equal((await call(people.Caretaker, 'GET', '/api/retest', { profileId: people.Ben.user.id })).status, 200);
  assert.equal((await call(people.Caretaker, 'GET', '/api/retest', { profileId: people.Ann.user.id })).status, 403);
});

test('a caretaker cannot see the sponsor unless the sponsor is tagged to them', async () => {
  const dash = await call(people.Ben, 'GET', '/api/family/dashboard');
  assert.deepEqual(dash.body.beneficiaries, []);
  // The caretaker of Ben only: no sponsor in the dashboard.
  await pool.query('DELETE FROM family_links WHERE owner_user_id = $1 AND member_user_id = $2', [people.Caretaker.user.id, people.Sponsor.user.id]);
  const after = await call(people.Caretaker, 'GET', '/api/family/dashboard');
  assert.deepEqual(after.body.beneficiaries.map((b) => b.id), [people.Ben.user.id]);
  assert.equal((await call(people.Caretaker, 'GET', '/api/retest', { profileId: people.Sponsor.user.id })).status, 403);
});

test('sponsor links are always view-only and a sponsor code cannot downgrade a caretaker', async () => {
  // Even asking for 'manage', a sponsor invite is stored view-only.
  const invite = await call(people.Stranger, 'POST', '/api/family/invites', { body: { role: 'sponsor', access: 'manage' } });
  assert.equal(invite.body.invite.access, 'view');
  assert.equal(invite.body.invite.role, 'sponsor');
  await assert.rejects(
    pool.query(`INSERT INTO family_links (owner_user_id, member_user_id, role, access) VALUES ($1, $2, 'sponsor', 'manage')`, [
      people.Stranger.user.id,
      people.Ann.user.id,
    ])
  );

  // Caretaker (manage) on Ben redeems a sponsor code for Ben: stays caretaker/manage.
  const sponsorCode = await call(people.Ben, 'POST', '/api/family/invites', { body: { role: 'sponsor' } });
  await call(people.Caretaker, 'POST', '/api/family/invites/redeem', { body: { code: sponsorCode.body.invite.code } });
  const { rows } = await pool.query('SELECT role, access FROM family_links WHERE owner_user_id = $1 AND member_user_id = $2', [
    people.Caretaker.user.id,
    people.Ben.user.id,
  ]);
  assert.deepEqual(rows[0], { role: 'caretaker', access: 'manage' });
});
