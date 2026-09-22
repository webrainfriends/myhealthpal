import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchSupportedLanguages, updatePreferredLanguage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nContext';
import { localeFor } from '../i18n/locales';
import { showAlert } from '../utils/alert';

function LanguageRow({ language, selected, disabled, onPress }) {
  // The server's own language list (SUPPORTED_LANGUAGES in
  // languageService.js) only carries {code, name} in English - locales.js
  // mirrors the same codes with each language's self-name added, purely for
  // this row's own display.
  const nativeName = localeFor(language.code).nativeName;
  return (
    <TouchableOpacity
      style={[styles.row, cardShadow, selected && styles.rowSelected]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View>
        <Text style={typography.body}>{language.name}</Text>
        {nativeName !== language.name && <Text style={typography.caption}>{nativeName}</Text>}
      </View>
      {selected && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

// Picks the language for this app's own screens and buttons, and for
// AI-generated explanatory text - insight explanations, report summaries,
// chat responses, custom dashboard card labels/descriptions, and medication
// knowledge for a medicine outside the curated knowledge base (see
// server/src/services/languageService.js) - plus, when Voice Mode is on
// (Settings > Voice & accessibility), the language results are read aloud
// in. One account-level setting drives everything the user sees and hears.
export default function LanguagePreferenceScreen() {
  const { user, updateUser } = useAuth();
  const t = useT();
  const [languages, setLanguages] = useState([]);
  const [selected, setSelected] = useState(user?.preferredLanguage || 'en');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchSupportedLanguages();
      setLanguages(data.languages);
    } catch (err) {
      showAlert(t('language.couldNotLoad'), err.message);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSelect(code) {
    if (code === selected || busy) return;
    setBusy(true);
    try {
      const data = await updatePreferredLanguage(code);
      setSelected(data.user.preferredLanguage);
      updateUser(data.user);
    } catch (err) {
      showAlert(t('language.couldNotUpdate'), err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.bodySecondary, styles.intro]}>{t('language.intro')}</Text>
        {languages.map((language) => (
          <LanguageRow
            key={language.code}
            language={language}
            selected={language.code === selected}
            disabled={busy}
            onPress={() => handleSelect(language.code)}
          />
        ))}
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
  intro: {
    marginBottom: spacing.sm,
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
  },
  rowSelected: {
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },
});
