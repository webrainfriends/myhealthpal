// Content-based file type check (issue #104 §8): an upload's bytes must
// match its extension - the filename alone is never trusted. Anything that
// looks executable or scriptable is rejected outright.

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc/.xls

const EXECUTABLE_SIGNATURES = [
  [0x4d, 0x5a], // MZ - Windows PE
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xca, 0xfe, 0xba, 0xbe],
  [0x23, 0x21], // #! script
];

function detectKind(buf) {
  if (startsWith(buf, PDF)) return 'pdf';
  if (startsWith(buf, PNG)) return 'png';
  if (startsWith(buf, JPEG)) return 'jpeg';
  if (startsWith(buf, ZIP)) return 'zip';
  if (startsWith(buf, OLE)) return 'ole';
  if (EXECUTABLE_SIGNATURES.some((sig) => startsWith(buf, sig))) return 'executable';
  return 'unknown';
}

function looksLikeText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (sample.includes(0)) return false;
  const text = sample.toString('utf8');
  // Mostly-replacement-character output means it wasn't UTF-8 text.
  const bad = (text.match(/�/g) || []).length;
  if (bad > sample.length * 0.01) return false;
  // Refuse markup/script masquerading as a CSV.
  return !/<\s*(script|html|svg|iframe)\b/i.test(text);
}

const EXPECTED_KIND = {
  pdf: 'pdf',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  docx: 'zip',
  xlsx: 'zip',
  doc: 'ole',
  xls: 'ole',
};

// Returns null when the content matches the extension, else a user-facing
// reason. (.xls exports from some lab portals are really CSV/HTML text;
// only OLE or plain text is accepted for them.)
function validateContent(buffer, extension) {
  if (!buffer || buffer.length === 0) return 'The file is empty.';
  const kind = detectKind(buffer);
  if (kind === 'executable') return 'This file looks like a program or script and was rejected.';
  if (extension === 'csv') {
    return kind === 'unknown' && looksLikeText(buffer) ? null : 'This file is not a readable CSV text file.';
  }
  if (extension === 'xls' && kind === 'unknown' && looksLikeText(buffer)) return null;
  const expected = EXPECTED_KIND[extension];
  if (!expected) return `Unsupported file type ".${extension}".`;
  if (kind !== expected) return `The file's contents don't match its .${extension} extension.`;
  return null;
}

module.exports = { validateContent, detectKind };
