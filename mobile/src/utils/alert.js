import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is a literal no-op (see
// react-native-web/src/exports/Alert: `static alert() {}`) - on web it
// never shows anything and never calls a button's onPress. This used to
// fall back to window.alert/window.confirm, but those render as a
// browser-chrome dialog ("yoursite.com says...") rather than anything
// that reads as part of the app - confusing on the deployed web build, and
// the reason this file no longer calls them. Instead, showAlert hands off
// to whatever in-app modal is currently mounted (see components/AlertHost.jsx,
// mounted once near the app root in App.js) via the same
// register-a-handler-from-a-plain-function idiom api/client.js's
// setUnauthorizedHandler already uses for the same reason (a plain function
// callable from anywhere needs a way to reach into the current React tree).
let webAlertHandler = null;

export function setWebAlertHandler(handler) {
  webAlertHandler = handler;
}

export function showAlert(title, message, buttons) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  if (webAlertHandler) {
    webAlertHandler(title, message, buttons);
    return;
  }

  // AlertHost should always be mounted before anything can call showAlert -
  // this only runs if something fires before the app has finished its first
  // render. window.alert here (never window.confirm, so a stray early call
  // can't silently auto-pick a destructive action) is a last-resort
  // fallback, not the normal path.
  // eslint-disable-next-line no-alert
  if (typeof window !== 'undefined') window.alert([title, message].filter(Boolean).join('\n\n'));
}
