const config = require('../config');
const gmailClient = require('./gmailClientService');
const { buildGmailSearchQuery, scoreCandidate } = require('./emailHealthClassifierService');

// Caps how many messages one search/sync call will inspect (each is its own
// Gmail API call) - keeps a single request bounded and rate-limit-friendly
// rather than walking an entire multi-thousand-message query result.
const MAX_MESSAGES_SCANNED = 100;

function isSupportedFilename(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(config.supportedExtensions, ext);
}

function defaultSinceDate() {
  const since = new Date();
  since.setDate(since.getDate() - config.gmailInitialSearchWindowDays);
  return since;
}

// Searches Gmail for likely health-related messages with a supported
// attachment, since `sinceDate` (or the connection's checkpoint/initial
// window when omitted). Returns candidate metadata only - sender, subject,
// received date, predicted category, and per-attachment filename/mimeType/
// size - never a message body. `approvedSenders` are addresses/domains the
// user has previously approved (see emailHealthClassifierService).
async function findCandidates({ accessToken, sinceDate, approvedSenders = [] }) {
  const query = buildGmailSearchQuery({
    sinceDate: sinceDate || defaultSinceDate(),
    supportedExtensions: Object.keys(config.supportedExtensions),
  });

  const candidates = [];
  let pageToken;
  let scanned = 0;

  do {
    // eslint-disable-next-line no-await-in-loop
    const { messages, nextPageToken } = await gmailClient.listMessageIds(accessToken, query, {
      maxResults: 25,
      pageToken,
    });

    for (const { id } of messages) {
      if (scanned >= MAX_MESSAGES_SCANNED) break;
      scanned += 1;

      // eslint-disable-next-line no-await-in-loop
      const message = await gmailClient.getMessage(accessToken, id);
      const supportedAttachments = message.attachments.filter((attachment) => isSupportedFilename(attachment.filename));
      if (supportedAttachments.length === 0) continue;

      const { isCandidate, predictedCategory, matchedSignals } = scoreCandidate({
        from: message.from,
        subject: message.subject,
        attachmentFilenames: supportedAttachments.map((attachment) => attachment.filename),
        approvedSenders,
      });
      if (!isCandidate) continue;

      candidates.push({
        messageId: message.id,
        sender: message.from,
        subject: message.subject,
        receivedAt: message.receivedAt,
        predictedCategory,
        matchedSignals,
        attachments: supportedAttachments.map((attachment) => ({
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeEstimate: attachment.sizeEstimate,
        })),
      });
    }

    pageToken = scanned < MAX_MESSAGES_SCANNED ? nextPageToken : null;
  } while (pageToken);

  return candidates;
}

module.exports = { findCandidates, defaultSinceDate, isSupportedFilename };
