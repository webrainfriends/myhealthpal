import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { fetchAuthConfig } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { renderGoogleButton } from '../auth/googleSignIn';
import { isAppleSignInEligible, signInWithApple } from '../auth/appleSignIn';
import { showAlert } from '../utils/alert';

export default function LoginScreen() {
  const { signInAsGuest, signInWithGoogle, signInWithApple: completeAppleSignIn } = useAuth();
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
          showAlert('Sign-in failed', err.message);
        } finally {
          setBusy(false);
        }
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.warn('Google Sign-In unavailable:', err.message);
      },
    });
  }, [authConfig, signInWithGoogle]);

  async function handleGuest() {
    setBusy(true);
    try {
      await signInAsGuest();
    } catch (err) {
      showAlert('Could not continue as guest', err.message);
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
      showAlert('Sign-in failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  const showApple = !!authConfig?.appleClientId && isAppleSignInEligible();
  const showGoogle = !!authConfig?.googleClientId && Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={typography.title}>MyHealthPal</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>
          Your reports, timeline, and insights — private to your account, never visible to anyone else.
        </Text>

        <View style={styles.actions}>
          {busy && <ActivityIndicator color={colors.primary} style={styles.spinner} />}

          {showGoogle && <View ref={googleButtonRef} style={styles.googleSlot} />}
          {showApple && <PrimaryButton title="Sign in with Apple" onPress={handleApple} disabled={busy} />}
          <PrimaryButton title="Continue as Guest" variant="secondary" onPress={handleGuest} disabled={busy} />
        </View>

        <Text style={[typography.bodySecondary, styles.footnote]}>
          Guest access is tied to this device/browser only — sign in with Google or Apple to keep your data if you
          switch devices or clear browser storage.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
