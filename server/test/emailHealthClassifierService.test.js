const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGmailSearchQuery, scoreCandidate } = require('../src/services/emailHealthClassifierService');

test('buildGmailSearchQuery always requires an attachment and includes the after: date', () => {
  const query = buildGmailSearchQuery({ sinceDate: new Date('2026-03-05T00:00:00Z'), supportedExtensions: ['pdf', 'jpg'] });
  assert.match(query, /has:attachment/);
  assert.match(query, /after:2026\/03\/05/);
  assert.match(query, /filename:pdf/);
  assert.match(query, /filename:jpg/);
});

test('buildGmailSearchQuery omits the after clause when no sinceDate is given', () => {
  const query = buildGmailSearchQuery({ supportedExtensions: ['pdf'] });
  assert.doesNotMatch(query, /after:/);
});

test('scoreCandidate flags a message whose subject contains a health keyword', () => {
  const result = scoreCandidate({ from: 'lab@example.com', subject: 'Your Blood Test results are ready', attachmentFilenames: ['results.pdf'] });
  assert.equal(result.isCandidate, true);
  assert.equal(result.predictedCategory, 'Blood Test');
  assert.ok(result.matchedSignals.includes('subject_keyword'));
});

test('scoreCandidate flags a message via an attachment filename keyword even with a generic subject', () => {
  const result = scoreCandidate({ from: 'clinic@example.com', subject: 'Documents attached', attachmentFilenames: ['MRI_report_2026.pdf'] });
  assert.equal(result.isCandidate, true);
  assert.equal(result.predictedCategory, 'Radiology Report');
  assert.ok(result.matchedSignals.includes('attachment_filename_keyword'));
});

test('scoreCandidate flags a previously approved sender even without a keyword match', () => {
  const result = scoreCandidate({
    from: 'Dr. Smith <drsmith@example-clinic.com>',
    subject: 'Following up',
    attachmentFilenames: ['notes.pdf'],
    approvedSenders: ['drsmith@example-clinic.com'],
  });
  assert.equal(result.isCandidate, true);
  assert.deepEqual(result.matchedSignals, ['approved_sender']);
});

test('scoreCandidate does not flag an ordinary email with no health signal', () => {
  const result = scoreCandidate({ from: 'newsletter@shop.com', subject: 'Your weekly deals', attachmentFilenames: ['flyer.pdf'] });
  assert.equal(result.isCandidate, false);
  assert.equal(result.predictedCategory, null);
});
