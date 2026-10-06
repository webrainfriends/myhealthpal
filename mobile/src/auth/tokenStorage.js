import { Platform } from 'react-native';

const STORAGE_KEY = 'myhealthpal.session';

// The session token is kept where it survives a restart: localStorage on web,
// the iOS Keychain / Android Keystore (expo-secure-store) on native. Native
// needs it persisted so a dose-reminder button tapped on a watch or lock
// screen can still reach the API while the app is closed. It is readable
// after the first unlock, which is when those notifications can fire.
// Memory is the last-resort fallback if the secure store is unavailable.
let memoryToken = null;
let secureStore = null;

function nativeStore() {
  if (Platform.OS === 'web') return null;
  if (secureStore === null) {
    try {
      // Required lazily so the web bundle never loads the native module.
      secureStore = require('expo-secure-store');
    } catch {
      secureStore = false;
    }
  }
  return secureStore || null;
}

const SECURE_OPTIONS = (store) => ({ keychainAccessible: store.AFTER_FIRST_UNLOCK });

function webStorageAvailable() {
  try {
    return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadToken() {
  if (webStorageAvailable()) {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  const store = nativeStore();
  if (store) {
    try {
      const stored = store.getItem(STORAGE_KEY, SECURE_OPTIONS(store));
      if (stored) return stored;
    } catch {
      // fall through to memory
    }
  }
  return memoryToken;
}

export function saveToken(token) {
  if (webStorageAvailable()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
      return;
    } catch {
      // fall through to memory
    }
  }
  const store = nativeStore();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, token, SECURE_OPTIONS(store));
    } catch {
      // keep the in-memory copy below
    }
  }
  memoryToken = token;
}

export function clearToken() {
  if (webStorageAvailable()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  const store = nativeStore();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, '', SECURE_OPTIONS(store));
    } catch {
      // ignore
    }
  }
  memoryToken = null;
}
