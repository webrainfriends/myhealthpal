require('dotenv').config();
const path = require('path');

const SUPPORTED_EXTENSIONS = {
  pdf: { mimeTypes: ['application/pdf'] },
  jpg: { mimeTypes: ['image/jpeg'] },
  jpeg: { mimeTypes: ['image/jpeg'] },
  png: { mimeTypes: ['image/png'] },
  doc: { mimeTypes: ['application/msword'] },
  docx: { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  csv: { mimeTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'] },
  xls: { mimeTypes: ['application/vnd.ms-excel'] },
  xlsx: { mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
};

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024,
  demoUserId: process.env.DEMO_USER_ID || '00000000-0000-0000-0000-000000000001',
  supportedExtensions: SUPPORTED_EXTENSIONS,
  extractionProvider: process.env.EXTRACTION_PROVIDER || 'heuristic',
  summaryProvider: process.env.SUMMARY_PROVIDER || 'heuristic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
};
