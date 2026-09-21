import { Platform } from 'react-native';

const STORAGE_KEY = 'myhealthpal.session';

// This app's only real deployment target is the web build (see README) -
// on web the session token is kept in localStorage so it survives a
// refresh/reopen. Native has no persistent-storage dependency installed
// (nothing here ships as a native build yet), so it falls back to an
// in-memory value that lasts for the current process only; add
// expo-secure-store here if a native build becomes a real target.
let memoryToken = null;

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
  memoryToken = null;
}
