import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchSupportedLanguages, updatePreferredLanguage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { showAlert } from '../utils/alert';

function LanguageRow({ language, selected, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.row, cardShadow, selected && styles.rowSelected]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={typography.body}>{language.name}</Text>
      {selected && <Text style={styles.checkmark}>✓</Text>}
    </TouchableOpacity>
  );
}

// Picks the language AI-generated explanatory text comes back in - insight
// explanations, report summaries, chat responses, custom dashboard card
// labels/descriptions, and medication knowledge for a medicine outside the
// curated knowledge base (see server/src/services/languageService.js). The
// app's own screens, buttons, and static copy stay in English regardless -
// this only changes what a model is asked to write in, not what's baked
// into the app itself.
export default function LanguagePreferenceScreen() {
  const { user, updateUser } = useAuth();
  const [languages, setLanguages] = useState([]);
  const [selected, setSelected] = useState(user?.preferredLanguage || 'en');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchSupportedLanguages();
      setLanguages(data.languages);
    } catch (err) {
      showAlert('Could not load languages', err.message);
    }
  }, []);

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
      showAlert('Could not update language', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.bodySecondary, styles.intro]}>
          AI-generated explanations - insight explanations, report summaries, chat answers, dashboard card
          descriptions, and medication details - will use this language. The app's own screens and buttons stay in
          English for now.
        </Text>
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
