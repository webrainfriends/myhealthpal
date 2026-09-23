import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import { fetchAuthConfig } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { renderGoogleButton } from '../auth/googleSignIn';
import { isAppleSignInEligible, signInWithApple } from '../auth/appleSignIn';
import { useI18n } from '../i18n/I18nContext';
import { LANGUAGES } from '../i18n/locales';
import { showAlert } from '../utils/alert';

// No account exists yet at this screen, so there's no preferred_language to
// read - this lets someone who doesn't read English pick one before signing
// in at all. See I18nContext's own note on why this is device-local rather
// than account state.
function LanguagePicker() {
  const { language, setLanguage } = useI18n();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.languageRow}>
      {LANGUAGES.map((lang) => (
        <TouchableOpacity
          key={lang.code}
          style={[styles.languageChip, lang.code === language && styles.languageChipActive]}
          onPress={() => setLanguage(lang.code)}
          accessibilityRole="button"
          accessibilityLabel={lang.name}
        >
          <Text style={[styles.languageChipText, lang.code === language && styles.languageChipTextActive]}>
            {lang.nativeName}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function LoginScreen() {
  const { signInAsGuest, signInWithGoogle, signInWithApple: completeAppleSignIn } = useAuth();
  const { t } = useI18n();
  const [authConfig, setAuthConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    fetchAuthConfig()
      .then(setAuthConfig)
      .catch(() => setAuthConfig({ googleClientId: null, appleClientId: null }));
  }, []);

  useEffect(() => {
    if (!authConfig?.googleClientId || Platform.OS !== 'web' || !googleButtonRef.current) return;
    renderGoogleButton({
      clientId: authConfig.googleClientId,
      container: googleButtonRef.current,
      onToken: async (idToken) => {
        setBusy(true);
        try {
          await signInWithGoogle(idToken);
        } catch (err) {
          showAlert(t('login.signInFailedTitle'), err.message);
        } finally {
          setBusy(false);
        }
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.warn('Google Sign-In unavailable:', err.message);
      },
    });
  }, [authConfig, signInWithGoogle, t]);

  async function handleGuest() {
    setBusy(true);
    try {
      await signInAsGuest();
    } catch (err) {
      showAlert(t('login.couldNotContinueGuest'), err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApple() {
    setBusy(true);
    try {
      const { identityToken, fullName } = await signInWithApple({ clientId: authConfig.appleClientId });
      await completeAppleSignIn(identityToken, fullName);
    } catch (err) {
      showAlert(t('login.signInFailedTitle'), err.message);
    } finally {
      setBusy(false);
    }
  }

  const showApple = !!authConfig?.appleClientId && isAppleSignInEligible();
  const showGoogle = !!authConfig?.googleClientId && Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.container}>
      <LanguagePicker />
      <View style={styles.content}>
        <Text style={typography.title}>{t('login.title')}</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>{t('login.subtitle')}</Text>

        <View style={styles.actions}>
          {busy && <ActivityIndicator color={colors.primary} style={styles.spinner} />}

          {showGoogle && <View ref={googleButtonRef} style={styles.googleSlot} />}
          {showApple && <PrimaryButton title={t('login.signInWithApple')} onPress={handleApple} disabled={busy} />}
          <PrimaryButton title={t('login.continueAsGuest')} variant="secondary" onPress={handleGuest} disabled={busy} />
        </View>

        <Text style={[typography.bodySecondary, styles.footnote]}>{t('login.footnote')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  languageRow: {
    flexDirection: 'row',
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  languageChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: spacing.xs,
  },
  languageChipActive: {
    backgroundColor: colors.primary,
  },
  languageChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  languageChipTextActive: {
    color: colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  googleSlot: {
    alignItems: 'center',
  },
  spinner: {
    marginBottom: spacing.xs,
  },
  footnote: {
    textAlign: 'center',
  },
});
