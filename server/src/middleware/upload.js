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
  const supported = config.uploadExtensions[ext];
  if (!supported) {
    req.fileValidationError = `Unsupported file type ".${ext || 'unknown'}". Supported formats: ${Object.keys(
      config.uploadExtensions
    ).join(', ').toUpperCase()}.`;
    return cb(null, false);
  }
  cb(null, true);
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: Math.max(config.maxUploadBytes, config.maxHealthExportBytes) },
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

// Workout recordings: video only, larger cap, still memory-only (they go
// straight into the encrypted vault).
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v']);
const videoMulter = multer({
  storage,
  fileFilter(req, file, cb) {
    if (!VIDEO_EXTENSIONS.has(extensionOf(file.originalname))) {
      req.fileValidationError = 'Only MP4 or MOV workout videos are supported.';
      return cb(null, false);
    }
    cb(null, true);
  },
  limits: { fileSize: config.maxWorkoutVideoBytes },
});
const videoUpload = {
  single(fieldName) {
    const middleware = videoMulter.single(fieldName);
    return (req, res, next) => middleware(req, res, AsyncResource.bind(next));
  },
};

// Apple Health exports get a bigger cap than other reports; multer only has
// one limit, so the per-extension one is enforced by the route.
function maxBytesFor(extension) {
  return config.healthExportExtensions[extension] ? config.maxHealthExportBytes : config.maxUploadBytes;
}

module.exports = { upload, videoUpload, extensionOf, maxBytesFor };
