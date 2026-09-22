const test = require('node:test');
const assert = require('node:assert/strict');
const gmailClient = require('../src/services/gmailClientService');
const { findCandidates } = require('../src/services/gmailSearchService');

// gmailSearchService talks to Gmail only through gmailClientService's
// exported functions - swapping them out here (restored after each test)
// lets the search/filter/classify logic be tested without any real network
// call or Google credentials, the same way claudeProvider.test.js exercises
// buildContent() without a live Anthropic call.
function withMockedClient(mocks, fn) {
  const originals = {};
  for (const key of Object.keys(mocks)) {
    originals[key] = gmailClient[key];
    gmailClient[key] = mocks[key];
  }
  return fn().finally(() => Object.assign(gmailClient, originals));
}

test('findCandidates returns only messages the classifier flags, with attachment metadata only', async () => {
  await withMockedClient(
    {
      listMessageIds: async () => ({
        messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
        nextPageToken: null,
      }),
      getMessage: async (accessToken, id) => {
        if (id === 'msg-1') {
          return {
            id,
            from: 'Quest Diagnostics <noreply@questdiagnostics.com>',
            subject: 'Your Blood Test results',
            receivedAt: new Date('2026-01-01'),
            attachments: [{ filename: 'results.pdf', mimeType: 'application/pdf', attachmentId: 'att-1', sizeEstimate: 1024 }],
          };
        }
        return {
          id,
          from: 'newsletter@shop.com',
          subject: 'Weekly deals',
          receivedAt: new Date('2026-01-02'),
          attachments: [{ filename: 'flyer.pdf', mimeType: 'application/pdf', attachmentId: 'att-2', sizeEstimate: 500 }],
        };
      },
    },
    async () => {
      const candidates = await findCandidates({ accessToken: 'token' });
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].messageId, 'msg-1');
      assert.equal(candidates[0].predictedCategory, 'Blood Test');
      assert.equal(candidates[0].attachments.length, 1);
      assert.equal(candidates[0].attachments[0].attachmentId, 'att-1');
    }
  );
});

test('findCandidates skips messages with no supported attachment', async () => {
  await withMockedClient(
    {
      listMessageIds: async () => ({ messages: [{ id: 'msg-1' }], nextPageToken: null }),
      getMessage: async () => ({
        id: 'msg-1',
        from: 'lab@example.com',
        subject: 'Blood test results',
        receivedAt: new Date(),
        attachments: [{ filename: 'archive.zip', mimeType: 'application/zip', attachmentId: 'att-1', sizeEstimate: 10 }],
      }),
    },
    async () => {
      const candidates = await findCandidates({ accessToken: 'token' });
      assert.equal(candidates.length, 0);
    }
  );
});

test('findCandidates paginates through Gmail results up to the message scan cap', async () => {
  let pagesRequested = 0;
  await withMockedClient(
    {
      listMessageIds: async (accessToken, query, { pageToken }) => {
        pagesRequested += 1;
        if (!pageToken) return { messages: [{ id: 'a' }], nextPageToken: 'page-2' };
        return { messages: [{ id: 'b' }], nextPageToken: null };
      },
      getMessage: async (accessToken, id) => ({
        id,
        from: 'lab@example.com',
        subject: 'Lab report attached',
        receivedAt: new Date(),
        attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', attachmentId: `att-${id}`, sizeEstimate: 10 }],
      }),
    },
    async () => {
      const candidates = await findCandidates({ accessToken: 'token' });
      assert.equal(pagesRequested, 2);
      assert.equal(candidates.length, 2);
    }
  );
});
