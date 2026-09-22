// Supported languages for AI-generated explanatory text: insight
// explanations, report narrative summaries, chat responses, custom
// dashboard card labels/descriptions (customCardService.js), and medication
// knowledge for a medicine outside the curated knowledge base
// (medicationKnowledgeService.js). This never touches the app's own UI
// chrome (screen titles, button labels, static copy) - that stays English
// for now; only text a model generates at request time respects a user's
// preferred_language. Kept as a fixed allow-list (like
// medicationKnowledgeBase.js's curated entries) rather than accepting any
// string, so a typo or unsupported code always falls back to English
// instead of silently asking a model to write in a language it was never
// actually asked to write in.
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ru', name: 'Russian' },
];

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
const DEFAULT_LANGUAGE = 'en';

function languageNameFor(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || null;
}

function normalizeLanguage(code) {
  return SUPPORTED_CODES.has(code) ? code : DEFAULT_LANGUAGE;
}

// A one-line instruction to append to a Claude system prompt so the
// generated text comes back in the requested language. Empty string for
// English (or anything unrecognized, normalized to English) so an existing
// prompt is byte-for-byte unaffected for the common case.
function languageInstruction(code) {
  const normalized = normalizeLanguage(code);
  if (normalized === DEFAULT_LANGUAGE) return '';
  return ` Write your entire response in ${languageNameFor(normalized)}, not English.`;
}

module.exports = { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, languageNameFor, normalizeLanguage, languageInstruction };
