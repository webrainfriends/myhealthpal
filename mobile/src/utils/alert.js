import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is a literal no-op (see
// react-native-web/src/exports/Alert: `static alert() {}`) - on web it
// never shows anything and never calls a button's onPress, so every
// Alert.alert call (error messages, permission prompts, and destructive
// confirmations like "Delete medication?") silently does nothing. This
// mirrors Alert.alert's (title, message, buttons) signature but falls back
// to window.confirm/alert on web so the same call sites work everywhere.
export function showAlert(title, message, buttons) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  const text = [title, message].filter(Boolean).join('\n\n');

  if (list.length === 1) {
    window.alert(text);
    list[0].onPress?.();
    return;
  }

  const cancelButton = list.find((b) => b.style === 'cancel');
  const confirmButton = list.find((b) => b !== cancelButton) || list[list.length - 1];

  if (window.confirm(text)) {
    confirmButton?.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}
