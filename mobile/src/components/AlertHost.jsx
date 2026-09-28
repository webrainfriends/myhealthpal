import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';
import { setWebAlertHandler } from '../utils/alert';

// The in-app replacement for window.alert/window.confirm on web (see
// utils/alert.js's showAlert) - mounted once near the app root (App.js) so
// every showAlert call anywhere in the app renders inside this same modal
// instead of a browser-chrome dialog. Native platforms are unaffected:
// showAlert still calls the OS-native Alert.alert there, which already
// reads as part of the app.
export default function AlertHost() {
  const [state, setState] = useState(null); // { title, message, buttons } | null

  useEffect(() => {
    setWebAlertHandler((title, message, buttons) => {
      setState({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }] });
    });
    return () => setWebAlertHandler(null);
  }, []);

  function handlePress(button) {
    setState(null);
    button.onPress?.();
  }

  return (
    <Modal visible={Boolean(state)} transparent animationType="fade">
      {state && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            {state.title ? <Text style={[typography.heading, styles.title]}>{state.title}</Text> : null}
            {state.message ? <Text style={[typography.bodySecondary, styles.message]}>{state.message}</Text> : null}
            <View style={styles.buttonRow}>
              {state.buttons.map((button, index) => (
                <TouchableOpacity
                  key={`${button.text}-${index}`}
                  style={styles.button}
                  onPress={() => handlePress(button)}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.buttonText,
                      button.style === 'destructive' && styles.destructiveText,
                      button.style === 'cancel' && styles.cancelText,
                    ]}
                  >
                    {button.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  button: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  destructiveText: {
    color: colors.danger,
  },
  cancelText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
