import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { fetchRetestPlans, updateRetestSettings } from '../api/client';
import { syncLocalRetestReminders } from '../notifications/retestNotifications';
import { showAlert } from '../utils/alert';
import { useAuth } from '../auth/AuthContext';

function SettingsRow({ title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={[styles.row, cardShadow]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowText}>
        <Text style={typography.body}>{title}</Text>
        <Text style={typography.caption}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// Server-side opt-out for Retest Radar push reminders; local fallback
// reminders on this device are re-synced to match.
function RetestRemindersRow({ t }) {
  const { activeProfile } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    fetchRetestPlans()
      .then((data) => {
        setEnabled(data.remindersEnabled);
        setPlans(data.plans);
      })
      .catch((err) => console.warn('Failed to load retest settings', err.message));
  }, []);

  async function handleChange(next) {
    setEnabled(next);
    try {
      await updateRetestSettings(next);
      syncLocalRetestReminders(plans, { enabled: next, t, profile: activeProfile });
    } catch (err) {
      setEnabled(!next);
      showAlert(t('retest.couldNotUpdate'), err.message);
    }
  }

  return (
    <View style={[styles.row, cardShadow]}>
      <View style={[styles.rowText, styles.rowTextFlex]}>
        <Text style={typography.body}>{t('retest.remindersTitle')}</Text>
        <Text style={typography.caption}>{t('retest.remindersSubtitle')}</Text>
      </View>
      <Switch
        value={Boolean(enabled)}
        disabled={enabled === null}
        onValueChange={handleChange}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );
}

export default function SettingsScreen({ navigation }) {
  const t = useT();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsRow
          title={t('privacy.settingsTitle')}
          subtitle={t('privacy.settingsSubtitle')}
          onPress={() => navigation.navigate('PrivacyConsent')}
        />
        <RetestRemindersRow t={t} />
        <SettingsRow
          title="Recipe recommendations"
          subtitle="Diet, cuisine, and weight-goal preferences used to suggest recipes"
          onPress={() => navigation.navigate('RecipePreferences')}
        />
        <SettingsRow
          title={t('settings.connectedTitle')}
          subtitle={t('settings.connectedSubtitle')}
          onPress={() => navigation.navigate('GmailIntegration')}
        />
        <SettingsRow
          title={t('settings.languageTitle')}
          subtitle={t('settings.languageSubtitle')}
          onPress={() => navigation.navigate('LanguagePreference')}
        />
        <SettingsRow
          title={t('settings.voiceTitle')}
          subtitle={t('settings.voiceSubtitle')}
          onPress={() => navigation.navigate('VoiceAccessibility')}
        />
        <SettingsRow
          title={t('settings.aiUsageTitle')}
          subtitle={t('settings.aiUsageSubtitle')}
          onPress={() => navigation.navigate('AiUsage')}
        />
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
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  rowText: {
    gap: 2,
  },
  rowTextFlex: {
    flex: 1,
    marginRight: spacing.md,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
});
