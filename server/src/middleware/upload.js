const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const config = require('../config');

fs.mkdirSync(config.uploadDir, { recursive: true });

function extensionOf(filename) {
  return path.extname(filename).replace('.', '').toLowerCase();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = extensionOf(file.originalname);
    cb(null, `${uuidv4()}${ext ? `.${ext}` : ''}`);
  },
});

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

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadBytes },
});

module.exports = { upload, extensionOf };
