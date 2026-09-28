import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { deleteAccount, fetchRetestPlans, updateRetestSettings } from '../api/client';
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
      <View style={styles.rowText}>
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

// Destructive, so it's styled apart from the ordinary nav rows above it and
// asks twice before doing anything - there's no undo once the account and
// everything in it (reports, medications, diet/activity history, chat, any
// managed family profile only this account looked after) is gone.
function DeleteAccountRow({ t }) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  function confirmDelete() {
    showAlert(t('settings.deleteAccountConfirmTitle'), t('settings.deleteAccountConfirmMessage'), [
      { text: t('settings.deleteAccountCancel'), style: 'cancel' },
      { text: t('settings.deleteAccountContinue'), style: 'destructive', onPress: confirmDeleteFinal },
    ]);
  }

  function confirmDeleteFinal() {
    showAlert(t('settings.deleteAccountFinalTitle'), t('settings.deleteAccountFinalMessage'), [
      { text: t('settings.deleteAccountCancel'), style: 'cancel' },
      { text: t('settings.deleteAccountConfirm'), style: 'destructive', onPress: performDelete },
    ]);
  }

  async function performDelete() {
    setBusy(true);
    try {
      await deleteAccount();
      // The account is already gone server-side; sign out drops the local
      // token and user state so the app falls back to the login screen.
      signOut();
    } catch (err) {
      setBusy(false);
      showAlert(t('settings.deleteAccountFailedTitle'), err.message);
    }
  }

  return (
    <TouchableOpacity
      style={[styles.row, styles.dangerRow, cardShadow]}
      onPress={confirmDelete}
      activeOpacity={0.7}
      disabled={busy}
    >
      <View style={styles.rowText}>
        <Text style={[typography.body, styles.dangerText]}>{t('settings.deleteAccountTitle')}</Text>
        <Text style={typography.caption}>{t('settings.deleteAccountSubtitle')}</Text>
      </View>
    </TouchableOpacity>
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
          title={t('settings.healthProfileTitle')}
          subtitle={t('settings.healthProfileSubtitle')}
          onPress={() => navigation.navigate('HealthProfile')}
        />
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
        <DeleteAccountRow t={t} />
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
    flex: 1,
    marginRight: spacing.md,
    gap: 2,
  },
  dangerRow: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.dangerMuted,
  },
  dangerText: {
    color: colors.danger,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
});
