import { Platform } from 'react-native';

// Device/browser-local accessibility preferences (Voice Mode on/off, reading
// speed) - not synced to the account like preferred_language is, the same
// way the session token in tokenStorage.js is device/browser-local rather
// than server state. Mirrors that file's storage strategy exactly: web
// localStorage so a preference survives a refresh/reopen, an in-memory
// fallback if the native secure store is unavailable. On native the settings
// are kept as one small JSON blob in expo-secure-store (the same store the
// session token uses), so they survive a restart.
const NATIVE_KEY = 'myhealthpal.settings';
const memoryStore = {};
let nativeLoaded = false;

function nativeStore() {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
}

function loadNative() {
  if (nativeLoaded) return;
  nativeLoaded = true;
  const store = nativeStore();
  if (!store) return;
  try {
    const raw = store.getItem(NATIVE_KEY);
    if (raw) Object.assign(memoryStore, JSON.parse(raw));
  } catch {
    // start empty
  }
}

function persistNative() {
  const store = nativeStore();
  if (!store) return;
  try {
    store.setItem(NATIVE_KEY, JSON.stringify(memoryStore));
  } catch {
    // keep the in-memory copy
  }
}

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
  loadNative();
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
  loadNative();
  memoryStore[key] = value;
  persistNative();
}
