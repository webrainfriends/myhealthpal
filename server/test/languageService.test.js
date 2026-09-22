const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  languageInstruction,
} = require('../src/services/languageService');

test('DEFAULT_LANGUAGE is English and is itself a supported code', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.ok(SUPPORTED_LANGUAGES.some((l) => l.code === DEFAULT_LANGUAGE));
});

test('normalizeLanguage passes through a supported code unchanged', () => {
  assert.equal(normalizeLanguage('es'), 'es');
  assert.equal(normalizeLanguage('hi'), 'hi');
});

test('normalizeLanguage falls back to English for an unrecognized/missing code', () => {
  assert.equal(normalizeLanguage('xx-not-real'), DEFAULT_LANGUAGE);
  assert.equal(normalizeLanguage(undefined), DEFAULT_LANGUAGE);
  assert.equal(normalizeLanguage(null), DEFAULT_LANGUAGE);
});

test('languageInstruction is empty for English so an existing prompt is unaffected', () => {
  assert.equal(languageInstruction('en'), '');
  assert.equal(languageInstruction(undefined), '');
});

test('languageInstruction names the language for a non-English, supported code', () => {
  const instruction = languageInstruction('es');
  assert.match(instruction, /Spanish/);
});
