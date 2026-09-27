// ZIP-bomb guard for Office Open XML uploads (.docx/.xlsx are ZIP
// containers). Reads the ZIP central directory - no decompression - and
// rejects archives whose declared uncompressed size, entry count, or
// compression ratio is implausible for a medical document.

const LIMITS = {
  maxEntries: 2000,
  maxTotalUncompressed: 100 * 1024 * 1024,
  maxEntryRatio: 200,
};

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// Returns null when acceptable, else a reason string.
function inspectZip(buf, limits = LIMITS) {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return 'The document is not a valid Office file.';
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) return 'ZIP64 documents are not supported.';
  if (entries > limits.maxEntries) return 'The document contains too many parts.';
  if (cdOffset + cdSize > buf.length) return 'The document is truncated or corrupt.';

  let pos = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) return 'The document is corrupt.';
    const compressed = buf.readUInt32LE(pos + 20);
    const uncompressed = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    total += uncompressed;
    if (total > limits.maxTotalUncompressed) return 'The document expands to an unsafe size.';
    if (compressed > 0 && uncompressed / compressed > limits.maxEntryRatio && uncompressed > 1024 * 1024) {
      return 'The document is compressed suspiciously and was rejected.';
    }
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    // VBA macro projects are never needed to read a lab report.
    if (/vbaProject\.bin$/i.test(name)) return 'Documents containing macros are not accepted.';
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

module.exports = { inspectZip, LIMITS };
