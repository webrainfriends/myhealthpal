// Mirrors server/src/services/languageService.js's SUPPORTED_LANGUAGES allow-list
// (kept as a separate constant, not imported, since the mobile bundle can't
// reach into server/ - see fetchSupportedLanguages() for the server's own
// copy, used to render the language picker). Each entry adds two things the
// server doesn't need: a BCP-47 tag for expo-speech's `language` option (the
// device/browser text-to-speech engine needs a real locale, not a bare
// 2-letter code) and whether the script reads right-to-left.
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', speechLocale: 'en-US', rtl: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', speechLocale: 'es-ES', rtl: false },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', speechLocale: 'hi-IN', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Français', speechLocale: 'fr-FR', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', speechLocale: 'de-DE', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', speechLocale: 'pt-BR', rtl: false },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', speechLocale: 'ar-SA', rtl: true },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', speechLocale: 'zh-CN', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', speechLocale: 'ja-JP', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', speechLocale: 'ru-RU', rtl: false },
];

export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export function normalizeLanguage(code) {
  return LANGUAGE_CODES.has(code) ? code : DEFAULT_LANGUAGE;
}

export function localeFor(code) {
  return LANGUAGES.find((l) => l.code === normalizeLanguage(code));
}
