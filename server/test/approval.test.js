const test = require('node:test');
const assert = require('node:assert/strict');
const { approvalBlock, effectiveApprovalStatus } = require('../src/middleware/approval');

const req = (method, originalUrl) => ({ method, originalUrl });
const pending = { email: 'new@example.com', approval_status: 'pending' };
const rejected = { email: 'no@example.com', approval_status: 'rejected' };

test('approved and legacy users are never blocked', () => {
  assert.equal(approvalBlock({ email: 'a@example.com', approval_status: 'approved' }, req('POST', '/api/chat/sessions')), null);
  assert.equal(approvalBlock({ email: 'a@example.com' }, req('POST', '/api/uploads')), null);
});

test('admin emails are always approved, even if the row says pending', () => {
  const admin = { email: 'RRAJA.EDGE@gmail.com', approval_status: 'pending' };
  assert.equal(effectiveApprovalStatus(admin), 'approved');
  assert.equal(approvalBlock(admin, req('POST', '/api/uploads')), null);
});

test('pending users can read the dashboard data', () => {
  for (const url of ['/api/auth/me', '/api/dashboard/snapshot', '/api/dashboard/organs?x=1', '/api/water/summary', '/api/diet/summary']) {
    assert.equal(approvalBlock(pending, req('GET', url)), null, url);
  }
});

test('pending users cannot write anything', () => {
  for (const [method, url] of [['POST', '/api/uploads'], ['POST', '/api/water/entries'], ['PATCH', '/api/auth/me'], ['DELETE', '/api/medications/1']]) {
    const block = approvalBlock(pending, req(method, url));
    assert.equal(block.status, 403, url);
    assert.equal(block.body.code, 'account_pending');
  }
});

test('pending users cannot reach AI or upload features even with GET', () => {
  for (const url of ['/api/chat/sessions', '/api/ai-usage', '/api/diet/recipes/feed', '/api/integrations/gmail/connect', '/api/reports', '/api/insights']) {
    assert.equal(approvalBlock(pending, req('GET', url)).body.code, 'account_pending', url);
  }
});

test('rejected users can only fetch their own status', () => {
  assert.equal(approvalBlock(rejected, req('GET', '/api/auth/me')), null);
  const block = approvalBlock(rejected, req('GET', '/api/dashboard/snapshot'));
  assert.equal(block.body.code, 'account_rejected');
});
