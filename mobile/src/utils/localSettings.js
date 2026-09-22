import { Platform } from 'react-native';

// Device/browser-local accessibility preferences (Voice Mode on/off, reading
// speed) - not synced to the account like preferred_language is, the same
// way the session token in tokenStorage.js is device/browser-local rather
// than server state. Mirrors that file's storage strategy exactly: web
// localStorage so a preference survives a refresh/reopen, an in-memory
// fallback everywhere else since no persistent-storage dependency is
// installed for native builds yet.
const memoryStore = {};

function webStorageAvailable() {
  try {
    return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function getSetting(key, fallback) {
  if (webStorageAvailable()) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return key in memoryStore ? memoryStore[key] : fallback;
}

export function setSetting(key, value) {
  if (webStorageAvailable()) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return;
    } catch {
      // fall through to memory
    }
  }
  memoryStore[key] = value;
}
