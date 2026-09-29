import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radii } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { useVoice } from '../voice/VoiceContext';

// A 🔊 Listen button that reads `text` (or the result of `getText()`, for
// content that's only worth building into a spoken sentence when actually
// tapped) aloud via VoiceContext. Renders nothing unless Voice Mode is on -
// this app stays visually unchanged for anyone who hasn't opted in, the
// same way LanguagePreferenceScreen's setting only affects the person who
// changes it. `id` distinguishes multiple buttons on one screen (e.g. one
// per insight card) so only the one actually reading shows a stop icon.
export default function SpeakButton({ text, getText, id, label, style }) {
  const { enabled, speak, stop, isSpeaking } = useVoice();
  const t = useT();

  if (!enabled) return null;

  const speaking = isSpeaking(id);

  function handlePress() {
    if (speaking) {
      stop();
      return;
    }
    const content = getText ? getText() : text;
    speak(content, { id });
  }

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label || t(speaking ? 'common.stopListening' : 'common.listen')}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.icon}>{speaking ? '⏹' : '🔊'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 14,
  },
});
