import { Platform } from 'react-native';

// Native file operations for the workout recording. Everything is lazy-
// required so the web bundle and Expo Go (no native modules) still load; each
// helper resolves/throws a clear error when the capability isn't there.
// Permissions (Photos) are requested only inside the action the user tapped.

function fileSystem() {
  // eslint-disable-next-line global-require
  return require('expo-file-system/legacy');
}

export const canHandleFiles = Platform.OS !== 'web';

export async function fileInfo(uri) {
  return fileSystem().getInfoAsync(uri, { md5: true, size: true });
}

// Removes the local temporary copy. Idempotent (a missing file is fine).
export async function deleteLocalFile(uri) {
  await fileSystem().deleteAsync(uri, { idempotent: true });
}

export async function localFileExists(uri) {
  if (!uri) return false;
  try {
    return (await fileSystem().getInfoAsync(uri)).exists;
  } catch (err) {
    return false;
  }
}

// Photos / Gallery. Asks for permission at this moment, not at app start.
export async function saveToPhotos(uri) {
  // eslint-disable-next-line global-require
  const MediaLibrary = require('expo-media-library');
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    const error = new Error('Photo library access was not granted.');
    error.code = 'permission_denied';
    throw error;
  }
  await MediaLibrary.saveToLibraryAsync(uri);
}

// Native share sheet - covers "Save to Files" and other apps.
export async function shareFile(uri) {
  // eslint-disable-next-line global-require
  const Sharing = require('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
}

// Downloads a retained recording (signed, short-lived URL) into the cache so
// it can be saved/exported. The caller deletes it afterwards.
export async function downloadToCache(url, name = 'workout.mp4') {
  const FileSystem = fileSystem();
  const target = `${FileSystem.cacheDirectory}${name}`;
  const res = await FileSystem.downloadAsync(url, target);
  if (res.status !== 200) throw new Error('The recording could not be downloaded.');
  return res.uri;
}
