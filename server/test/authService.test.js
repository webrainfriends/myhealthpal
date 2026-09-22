const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  signSession,
  verifySessionUserId,
  signReportDownloadToken,
  verifyReportDownloadToken,
} = require('../src/services/authService');

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

test('signReportDownloadToken + verifyReportDownloadToken round-trip to the same user/report', () => {
  const userId = '44444444-4444-4444-4444-444444444444';
  const reportId = '55555555-5555-5555-5555-555555555555';
  const token = signReportDownloadToken({ userId, reportId });
  assert.deepEqual(verifyReportDownloadToken(token), { userId, reportId });
});

test('verifyReportDownloadToken rejects a session token used in its place', () => {
  // A session token has no `type` claim at all, so it must never verify as
  // a download token even though both are signed with the same secret -
  // otherwise any logged-in user's ordinary session token would double as
  // a valid (if wrong-shaped) file-access credential.
  const sessionToken = signSession({ id: '66666666-6666-6666-6666-666666666666' });
  assert.throws(() => verifyReportDownloadToken(sessionToken));
});

test('verifyReportDownloadToken rejects a garbage or forged token', () => {
  assert.throws(() => verifyReportDownloadToken('not-a-real-token'));
  const forged = jwt.sign(
    { sub: '77777777-7777-7777-7777-777777777777', reportId: 'x', type: 'report_download' },
    'some-other-secret'
  );
  assert.throws(() => verifyReportDownloadToken(forged));
});

test('verifyReportDownloadToken rejects an expired download token', () => {
  const config = require('../src/config');
  const expired = jwt.sign(
    { sub: '88888888-8888-8888-8888-888888888888', reportId: 'x', type: 'report_download' },
    config.jwtSecret,
    { expiresIn: -10 }
  );
  assert.throws(() => verifyReportDownloadToken(expired));
});
