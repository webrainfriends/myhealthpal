const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signSession, verifySessionUserId } = require('../src/services/authService');

test('signSession + verifySessionUserId round-trip to the same user id', () => {
  const user = { id: '11111111-1111-1111-1111-111111111111' };
  const token = signSession(user);
  assert.equal(verifySessionUserId(token), user.id);
});

test('verifySessionUserId rejects a garbage token', () => {
  assert.throws(() => verifySessionUserId('not-a-real-token'));
});

test('verifySessionUserId rejects a token signed with a different secret', () => {
  const forged = jwt.sign({ sub: '22222222-2222-2222-2222-222222222222' }, 'some-other-secret');
  assert.throws(() => verifySessionUserId(forged));
});

test('verifySessionUserId rejects an expired token', () => {
  // Sign with the same secret authService actually uses (re-derive it the
  // same way signSession does) but with an expiry already in the past.
  const config = require('../src/config');
  const expired = jwt.sign({ sub: '33333333-3333-3333-3333-333333333333' }, config.jwtSecret, { expiresIn: -10 });
  assert.throws(() => verifySessionUserId(expired));
});
