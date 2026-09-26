const { AsyncResource } = require('async_hooks');
const multer = require('multer');
const path = require('path');
const config = require('../config');

function extensionOf(filename) {
  return path.extname(filename).replace('.', '').toLowerCase();
}

// Files stay in memory only (bounded by maxUploadBytes): they're validated
// and encrypted straight into the vault (security/secureUpload.js), so a
// medical document is never written to disk as plaintext.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ext = extensionOf(file.originalname);
  const supported = config.supportedExtensions[ext];
  if (!supported) {
    req.fileValidationError = `Unsupported file type ".${ext || 'unknown'}". Supported formats: ${Object.keys(
      config.supportedExtensions
    ).join(', ').toUpperCase()}.`;
    return cb(null, false);
  }
  cb(null, true);
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadBytes },
});

// multer calls its callback from request-stream events, which run outside
// the AsyncLocalStorage context requireAuth set up - binding the callback
// keeps the user/session attribution (lib/requestContext.js) intact for
// the ingestion/scan work every upload route starts from inside it.
const upload = {
  single(fieldName) {
    const middleware = multerUpload.single(fieldName);
    return (req, res, next) => middleware(req, res, AsyncResource.bind(next));
  },
};

module.exports = { upload, extensionOf };
