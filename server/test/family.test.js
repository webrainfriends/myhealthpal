const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const authService = require('../src/services/authService');

// End-to-end over HTTP: X-Profile-Id must only ever reach a profile a
// family_links row grants, view-only links must stay read-only, and account
// routes must ignore the header entirely.

let server;
let baseUrl;
let caregiver;
let sibling;
let stranger;

async function createUser(name) {
  const { rows } = await pool.query(
    `INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`,
    [name]
  );
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

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  caregiver = await createUser('Family Test Caregiver');
  sibling = await createUser('Family Test Sibling');
  stranger = await createUser('Family Test Stranger');
});

test.after(async () => {
  server.close();
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[caregiver.user.id, sibling.user.id, stranger.user.id]]);
  await pool.end();
});

test('caregiver manages a family member end to end', async () => {
  const created = await call(caregiver, 'POST', '/api/family/members', { body: { displayName: 'Dad', relation: 'Father' } });
  assert.equal(created.status, 201);
  const dadId = created.body.profile.id;

  const family = await call(caregiver, 'GET', '/api/family');
  const dad = family.body.profiles.find((p) => p.id === dadId);
  assert.equal(dad.isManaged, true);
  assert.equal(dad.access, 'manage');
  assert.equal(family.body.profiles[0].isSelf, true);

  // Acting as Dad works for data routes and returns Dad's (empty) data.
  const plans = await call(caregiver, 'GET', '/api/retest', { profileId: dadId });
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.plans, []);

  // /api/auth/me is always the signed-in account.
  const me = await call(caregiver, 'GET', '/api/auth/me', { profileId: dadId });
  assert.equal(me.body.user.id, caregiver.user.id);

  // A stranger can't reach Dad, nor can a malformed header.
  assert.equal((await call(stranger, 'GET', '/api/retest', { profileId: dadId })).status, 403);
  assert.equal((await call(stranger, 'GET', '/api/retest', { profileId: 'not-a-uuid' })).status, 403);

  // Share Dad view-only with a sibling.
  const invite = await call(caregiver, 'POST', '/api/family/invites', { body: { profileId: dadId, access: 'view' } });
  assert.equal(invite.status, 201);
  assert.match(invite.body.invite.code, /^[A-Z2-9]{8}$/);

  // A stranger can't mint invites for a profile they don't manage.
  assert.equal((await call(stranger, 'POST', '/api/family/invites', { body: { profileId: dadId } })).status, 403);

  const redeemed = await call(sibling, 'POST', '/api/family/invites/redeem', {
    body: { code: invite.body.invite.code.toLowerCase() },
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.profile.id, dadId);
  assert.equal(redeemed.body.profile.access, 'view');

  // Single use.
  assert.equal((await call(stranger, 'POST', '/api/family/invites/redeem', { body: { code: invite.body.invite.code } })).status, 400);

  // View-only: reads allowed, writes refused.
  assert.equal((await call(sibling, 'GET', '/api/retest', { profileId: dadId })).status, 200);
  const write = await call(sibling, 'PUT', '/api/account/retest-settings', { body: { remindersEnabled: true }, profileId: dadId });
  assert.equal(write.status, 200, 'account routes ignore the profile header');
  const pinned = await call(sibling, 'POST', '/api/pinned-parameters', { body: {}, profileId: dadId });
  assert.equal(pinned.status, 403);

  // Dad's caregivers see who else follows him via their own profile list,
  // and removing the last manager deletes the managed profile entirely.
  const removed = await call(caregiver, 'DELETE', `/api/family/members/${dadId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deletedProfile, true);
  const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [dadId]);
  assert.equal(rows.length, 0);
});

test('a real account can share itself and revoke access', async () => {
  const invite = await call(sibling, 'POST', '/api/family/invites', { body: { access: 'manage' } });
  assert.equal(invite.status, 201);

  // Can't redeem your own profile's code.
  assert.equal((await call(sibling, 'POST', '/api/family/invites/redeem', { body: { code: invite.body.invite.code } })).status, 400);

  const redeemed = await call(caregiver, 'POST', '/api/family/invites/redeem', { body: { code: invite.body.invite.code } });
  assert.equal(redeemed.body.profile.isManaged, false);

  const shared = await call(sibling, 'GET', '/api/family');
  assert.deepEqual(
    shared.body.sharedWith.map((s) => [s.id, s.access]),
    [[caregiver.user.id, 'manage']]
  );

  assert.equal((await call(sibling, 'DELETE', `/api/family/shared-with/${caregiver.user.id}`)).status, 204);
  assert.equal((await call(caregiver, 'GET', '/api/retest', { profileId: sibling.user.id })).status, 403);

  // Removing a real account from your family only unlinks it.
  const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [sibling.user.id]);
  assert.equal(rows.length, 1);
});
