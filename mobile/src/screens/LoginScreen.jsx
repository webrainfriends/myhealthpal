import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import GradientFill from '../components/brand/GradientFill';
import Mascot from '../components/brand/Mascot';
import { alertSeverityColors, colors, radii, spacing, typography } from '../theme/theme';
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

// Pal gently bobs up and down so the first screen feels alive rather than a
// static form. The native driver isn't available on web.
function FloatingMascot() {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(float, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <View style={styles.mascotHalo}>
      <View style={styles.mascotRing} />
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Mascot size={148} mood="wink" />
      </Animated.View>
    </View>
  );
}

function FeaturePill({ icon, label }) {
  return (
    <View style={styles.featurePill}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Non-dismissible - unlike MedicationsScreen's AlertBanner, there's nothing
// to tap or clear here, it just reflects server state until a slot opens up.
function BetaCapacityBanner({ closed }) {
  const { t } = useI18n();
  const palette = alertSeverityColors.attention;
  return (
    <View style={[styles.capacityBanner, { backgroundColor: palette.bg, borderLeftColor: palette.fg }]}>
      <Text style={[typography.body, styles.capacityBannerText, { color: palette.fg }]}>
        {closed ? t('login.registrationClosed') : t('login.betaNotice')}
      </Text>
    </View>
  );
}

export default function LoginScreen() {
  const { signInAsGuest, signInWithGoogle, signInWithApple: completeAppleSignIn } = useAuth();
  const { t } = useI18n();
  const [authConfig, setAuthConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  // Closed-beta cap reached - set from GET /auth/config on load, or from a
  // guest sign-in's 403 registration_closed response (the config could have
  // said "open" a moment before the last slot filled). This only ever gates
  // *new* guest accounts (every "Continue as Guest" tap creates a fresh
  // row) - it must never hide the Google/Apple options, since an existing
  // account always signs back in fine regardless of how full the cap is
  // (see authService.upsertOAuthUser).
  const [guestClosed, setGuestClosed] = useState(false);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    fetchAuthConfig()
      .then((cfg) => {
        setAuthConfig(cfg);
        if (cfg.registrationOpen === false) setGuestClosed(true);
      })
      // Fail open on a transient config-fetch error - the server still
      // enforces the cap regardless of what the client believes here.
      .catch(() => setAuthConfig({ googleClientId: null, appleClientId: null, registrationOpen: true }));
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
          // A 403 here means this Google identity has never signed in before
          // and the beta cap is full - it's a one-off failure for this
          // attempt, not a reason to hide the button for everyone else
          // (an existing account always signs back in fine).
          if (err.code === 'registration_closed') {
            showAlert(t('login.signInFailedTitle'), t('login.registrationClosed'));
          } else {
            showAlert(t('login.signInFailedTitle'), err.message);
          }
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
      if (err.code === 'registration_closed') {
        setGuestClosed(true);
      } else {
        showAlert(t('login.couldNotContinueGuest'), err.message);
      }
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
      // Same as the Google case above: only a brand-new Apple identity can
      // ever hit the cap, so this never disables sign-in for anyone else.
      if (err.code === 'ERR_REQUEST_CANCELED') {
        // The person dismissed the native Apple sheet - not an error.
      } else if (err.code === 'registration_closed') {
        showAlert(t('login.signInFailedTitle'), t('login.registrationClosed'));
      } else {
        showAlert(t('login.signInFailedTitle'), err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const showApple = !!authConfig?.appleClientId && isAppleSignInEligible();
  const showGoogle = !!authConfig?.googleClientId && Platform.OS === 'web';

  return (
    <View style={styles.container}>
      <GradientFill />
      {/* decorative bubbles */}
      <View style={[styles.bubble, styles.bubbleOne]} />
      <View style={[styles.bubble, styles.bubbleTwo]} />
      <View style={[styles.bubble, styles.bubbleThree]} />

      <SafeAreaView style={styles.safe}>
        <LanguagePicker />
        <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
          <View style={styles.hero}>
            <FloatingMascot />
            <Text style={styles.wordmark}>
              <Text style={styles.wordmarkAccent}>Eye</Text>MyHealth
            </Text>
            <Text style={styles.tagline}>{t('login.tagline')}</Text>
            <View style={styles.featureRow}>
              <FeaturePill icon="📄" label={t('login.featureReports')} />
              <FeaturePill icon="💊" label={t('login.featureMeds')} />
              <FeaturePill icon="🥗" label={t('login.featureLifestyle')} />
            </View>
          </View>

          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('login.getStarted')}</Text>
            <Text style={[typography.bodySecondary, styles.subtitle]}>{t('login.subtitle')}</Text>
            <BetaCapacityBanner closed={guestClosed} />

            <View style={styles.actions}>
              {busy && <ActivityIndicator color={colors.primary} style={styles.spinner} />}

              {showGoogle && <View ref={googleButtonRef} style={styles.googleSlot} />}
              {showApple && <PrimaryButton title={t('login.signInWithApple')} onPress={handleApple} disabled={busy} />}
              <PrimaryButton
                title={t('login.continueAsGuest')}
                variant={showApple || showGoogle ? 'secondary' : 'primary'}
                onPress={handleGuest}
                disabled={busy || guestClosed}
              />
            </View>

            <Text style={[typography.caption, styles.footnote]}>🔒 {t('login.footnote')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    overflow: 'hidden',
  },
  safe: {
    flex: 1,
  },
  bubble: {
    position: 'absolute',
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  bubbleOne: { width: 260, height: 260, top: -80, right: -90 },
  bubbleTwo: { width: 180, height: 180, top: 220, left: -70, backgroundColor: 'rgba(255, 226, 122, 0.18)' },
  bubbleThree: { width: 120, height: 120, top: 120, right: 30, backgroundColor: 'rgba(31, 209, 193, 0.18)' },
  languageRow: {
    flexDirection: 'row',
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  languageChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: spacing.xs,
  },
  languageChipActive: {
    backgroundColor: colors.surface,
  },
  languageChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.onBrand,
  },
  languageChipTextActive: {
    color: colors.primary,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  mascotHalo: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  mascotRing: {
    position: 'absolute',
    width: 172,
    height: 172,
    borderRadius: 86,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  wordmark: {
    fontSize: 38,
    fontWeight: '900',
    color: colors.onBrand,
    letterSpacing: -1,
  },
  wordmarkAccent: {
    color: '#FFE27A',
  },
  tagline: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.onBrandMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  featureIcon: {
    fontSize: 14,
  },
  featureLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onBrand,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetTitle: {
    ...typography.title,
  },
  subtitle: {
    marginTop: -spacing.sm,
  },
  capacityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  capacityBannerText: {
    flex: 1,
    fontWeight: '600',
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
    lineHeight: 17,
  },
});
