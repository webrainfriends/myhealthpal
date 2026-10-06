import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { colors, radii, spacing, typography } from '../theme/theme';
import { showAlert } from '../utils/alert';

// Shown above the read-only dashboard while an admin has not yet approved
// this account (server: middleware/approval.js turns uploads, AI features and
// every write off until then). "Check status" re-reads the account so an
// approval takes effect without signing out and back in.
export function PendingApprovalBanner() {
  const { refreshUser, signOut } = useAuth();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const me = await refreshUser();
      if (me.approvalStatus === 'pending') {
        showAlert('Still waiting', 'An admin has not approved your account yet. Please check back later.');
      }
    } catch (err) {
      showAlert('Could not check status', err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.bannerSafe}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Waiting for admin approval</Text>
        <Text style={styles.bannerBody}>
          You can look around, but uploads, AI features and changes are turned off until an admin approves your account.
        </Text>
        <View style={styles.bannerActions}>
          <TouchableOpacity style={styles.primaryButton} onPress={check} disabled={checking} activeOpacity={0.7}>
            {checking ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryButtonText}>Check status</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={signOut} activeOpacity={0.7}>
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// The admin turned this account down: nothing else in the app is available.
export function AccessRejectedScreen() {
  const { signOut, refreshUser } = useAuth();
  return (
    <SafeAreaView style={styles.rejected}>
      <Text style={typography.title}>Access not approved</Text>
      <Text style={[typography.bodySecondary, styles.rejectedBody]}>
        This app is in private beta and your request to use it was not approved.
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={() => refreshUser().catch(() => {})} activeOpacity={0.7}>
        <Text style={styles.primaryButtonText}>Check again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={signOut} activeOpacity={0.7}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bannerSafe: { backgroundColor: colors.surface },
  banner: {
    margin: spacing.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radii.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    backgroundColor: colors.background,
  },
  bannerTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  bannerBody: { ...typography.bodySecondary },
  bannerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    minWidth: 110,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.surface, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  rejected: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  rejectedBody: { textAlign: 'center' },
});
