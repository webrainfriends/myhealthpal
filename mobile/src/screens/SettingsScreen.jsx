import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

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

export default function SettingsScreen({ navigation }) {
  const t = useT();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
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
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
});
