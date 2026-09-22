// Centralizes what "looks like a health email" means for the Gmail
// integration (issue #54) - one configurable place, rather than keyword
// lists scattered across the search/import routes. Every signal here is
// deterministic (subject/sender/filename text matching); there is no AI
// classifier in this MVP, so nothing here ever sees an email body.

// Keyword groups from the issue's own "Candidate Email Detection" list,
// each mapped to the human-readable category shown to the user before they
// choose what to import. Order matters: the first matching category wins.
const CATEGORY_KEYWORDS = [
  ['Blood Test', ['blood test', 'cbc', 'fbc', 'hba1c', 'glucose', 'lipid', 'cholesterol']],
  ['Radiology Report', ['radiology', 'mri', 'ct scan', 'x-ray', 'xray', 'ultrasound']],
  ['Pathology Report', ['pathology', 'biopsy']],
  ['Kidney/Liver Function', ['kidney function', 'liver function']],
  ['Thyroid Panel', ['thyroid']],
  ['Prescription', ['prescription']],
  ['Discharge Summary', ['discharge summary']],
  ['Diagnostic Report', ['diagnostic report', 'lab report', 'medical report', 'health report', 'test result']],
];

const HEALTH_KEYWORDS = CATEGORY_KEYWORDS.flatMap(([, keywords]) => keywords);

// Senders previously approved by the user (doctors/clinics they've added)
// are passed in per-call rather than hard-coded - there is no way to know a
// user's own providers up front, and this keeps the module free of any
// per-deployment or per-user data.
function matchesHealthKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return HEALTH_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function detectCategory(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return null;
}

// Gmail search operators only, never a phrase we'd need to escape/quote
// perfectly - broad on purpose (attachments within the window) because the
// real filtering happens in scoreCandidate() below against metadata Gmail
// hands back, which is far more reliable than trying to encode every
// keyword combination into Gmail's query syntax.
function buildGmailSearchQuery({ sinceDate, supportedExtensions }) {
  const afterClause = sinceDate ? `after:${formatGmailDate(sinceDate)}` : '';
  const extensionClause = supportedExtensions?.length
    ? `(${supportedExtensions.map((ext) => `filename:${ext}`).join(' OR ')})`
    : '';
  return ['has:attachment', afterClause, extensionClause].filter(Boolean).join(' ');
}

function formatGmailDate(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// Decides whether a message (headers + attachment filenames only - never
// body text) is a plausible health document, and what to call it if so.
// `approvedSenders` are sender addresses/domains the user has previously
// approved (e.g. a known doctor); matching one is enough on its own even
// without a keyword hit, since the user has already vouched for that source.
function scoreCandidate({ from, subject, attachmentFilenames = [], approvedSenders = [] }) {
  const senderMatch =
    !!from && approvedSenders.some((approved) => from.toLowerCase().includes(approved.toLowerCase()));
  const subjectMatch = matchesHealthKeyword(subject);
  const filenameMatch = attachmentFilenames.some((name) => matchesHealthKeyword(name));

  const isCandidate = senderMatch || subjectMatch || filenameMatch;
  const predictedCategory = detectCategory(subject) || attachmentFilenames.map(detectCategory).find(Boolean) || null;

  const matchedSignals = [
    senderMatch && 'approved_sender',
    subjectMatch && 'subject_keyword',
    filenameMatch && 'attachment_filename_keyword',
  ].filter(Boolean);

  return { isCandidate, predictedCategory, matchedSignals };
}

module.exports = {
  HEALTH_KEYWORDS,
  CATEGORY_KEYWORDS,
  buildGmailSearchQuery,
  scoreCandidate,
};
