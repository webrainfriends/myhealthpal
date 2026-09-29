// Log redaction (issue #104 §12). Errors thrown around medical data can
// carry it: pg errors include query parameters/row detail, SDK errors can
// echo request bodies, and ad-hoc objects may hold tokens or keys. Logs get
// the message, code and stack - with bearer tokens/JWTs and sensitive
// fields scrubbed - and nothing else.

const SENSITIVE_KEY = /(token|authorization|secret|password|api[_-]?key|dek|wrapped|data_key|encrypted_data_key|cipher|prompt|messages|content|text|raw_model_output|raw_value|raw_excerpt|storage_path|file_?buffer|buffer|body|detail|parameters|where|email)/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_QUERY = /([?&](token|key|code)=)[^&\s]+/gi;
const ANTHROPIC_KEY = /\bsk-ant-[A-Za-z0-9_-]+/g;
const HEX_KEY = /\b[0-9a-f]{64}\b/gi;

function redactString(value) {
  return String(value)
    .replace(JWT, '[REDACTED_JWT]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(TOKEN_QUERY, '$1[REDACTED]')
    .replace(ANTHROPIC_KEY, '[REDACTED_KEY]')
    .replace(HEX_KEY, '[REDACTED_HEX]');
}

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[${value.length ?? value.byteLength} bytes]`;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

// What an error is allowed to contribute to a log line.
function describeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err !== 'object') return redactString(err);
  const parts = [err.name || 'Error'];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.status) parts.push(`status=${err.status}`);
  const message = redactString(err.message || '');
  const stack = err.stack ? redactString(err.stack.split('\n').slice(1, 6).join('\n')) : '';
  return `${parts.join(' ')}: ${message}${stack ? `\n${stack}` : ''}`;
}

function logError(context, err) {
  // eslint-disable-next-line no-console
  console.error(`${redactString(context)} - ${describeError(err)}`);
}

module.exports = { redact, redactString, describeError, logError };
