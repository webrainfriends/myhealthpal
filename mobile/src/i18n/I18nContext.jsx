import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getSetting, setSetting } from '../utils/localSettings';
import { DEFAULT_LANGUAGE, localeFor, normalizeLanguage } from './locales';
import { TRANSLATIONS } from './translations';

const I18nContext = createContext(null);
const PRE_LOGIN_LANGUAGE_KEY = 'myhealthpal.preLoginLanguage';

function lookup(dict, path) {
  return path.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

// Drives both this app's own UI copy (screen titles, buttons, static labels)
// and, via the same `preferred_language` the user already sets in
// LanguagePreferenceScreen, the language text-to-speech reads content back
// in - one setting for everything the user sees and hears, rather than a
// separate "app language" and "AI language". Reusing the account's existing
// preferred_language (see languageService.js) means no new server field and
// no extra screen to keep in sync.
//
// Before sign-in there's no account yet to carry a preferred_language, so
// LoginScreen would otherwise always render in English no matter who's
// looking at it - the one screen everyone, including someone who can't read
// English, has to get through first. A device-local override (persisted the
// same way as tokenStorage.js/localSettings.js) fills that gap: LoginScreen
// exposes a language picker that calls setLanguage(), which applies
// immediately and is dropped the moment a real account with its own
// preferred_language exists.
export function I18nProvider({ children }) {
  const { user } = useAuth();
  const [preLoginLanguage, setPreLoginLanguage] = useState(() => getSetting(PRE_LOGIN_LANGUAGE_KEY, null));
  const language = normalizeLanguage(user?.preferredLanguage || preLoginLanguage);

  const setLanguage = useCallback((code) => {
    setPreLoginLanguage(code);
    setSetting(PRE_LOGIN_LANGUAGE_KEY, code);
  }, []);

  const value = useMemo(() => {
    const dict = TRANSLATIONS[language] || TRANSLATIONS[DEFAULT_LANGUAGE];
    const fallbackDict = TRANSLATIONS[DEFAULT_LANGUAGE];

    function t(key, vars) {
      const value = lookup(dict, key) ?? lookup(fallbackDict, key) ?? key;
      return typeof value === 'string' ? interpolate(value, vars) : value;
    }

    const locale = localeFor(language);
    return { t, language, speechLocale: locale.speechLocale, isRTL: locale.rtl, setLanguage };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

// Most call sites only need `t` - this trims `const { t } = useI18n()` down
// to one import at every screen/component that just renders translated copy.
export function useT() {
  return useI18n().t;
}
