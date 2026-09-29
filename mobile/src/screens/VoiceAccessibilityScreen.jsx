import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { useVoice } from '../voice/VoiceContext';

const SPEEDS = [
  { key: 'slow', labelKey: 'voice.speedSlow' },
  { key: 'normal', labelKey: 'voice.speedNormal' },
  { key: 'fast', labelKey: 'voice.speedFast' },
];

export default function VoiceAccessibilityScreen() {
  const t = useT();
  const { enabled, setEnabled, rateKey, setRate, speak, stop, isSpeaking } = useVoice();
  const testing = isSpeaking('test');

  function handleTest() {
    if (testing) {
      stop();
      return;
    }
    speak(t('voice.testSentence'), { id: 'test' });
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.bodySecondary, styles.intro]}>{t('voice.intro')}</Text>

        <View style={[styles.row, cardShadow]}>
          <View style={styles.rowText}>
            <Text style={typography.body}>{t('voice.enableLabel')}</Text>
            <Text style={typography.caption}>{t('voice.enableHint')}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: colors.border, true: colors.primaryMuted }}
            thumbColor={enabled ? colors.primary : undefined}
            accessibilityLabel={t('voice.enableLabel')}
          />
        </View>

        {enabled && (
          <>
            <Text style={[typography.heading, styles.sectionHeading]}>{t('voice.speedLabel')}</Text>
            <View style={styles.speedRow}>
              {SPEEDS.map((speed) => (
                <TouchableOpacity
                  key={speed.key}
                  style={[styles.speedChip, rateKey === speed.key && styles.speedChipActive]}
                  onPress={() => setRate(speed.key)}
                  accessibilityRole="button"
                  accessibilityLabel={t(speed.labelKey)}
                >
                  <Text style={[styles.speedChipText, rateKey === speed.key && styles.speedChipTextActive]}>
                    {t(speed.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <PrimaryButton
              title={testing ? t('voice.stop') : t('voice.testButton')}
              variant="secondary"
              onPress={handleTest}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  intro: {
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  sectionHeading: {
    marginTop: spacing.sm,
  },
  speedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  speedChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
  },
  speedChipActive: {
    backgroundColor: colors.primary,
  },
  speedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  speedChipTextActive: {
    color: colors.surface,
  },
});
