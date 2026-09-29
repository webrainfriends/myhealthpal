import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { cleanupGuestSessions, deleteAdminSession, fetchAdminSessions } from '../api/client';
import { showAlert } from '../utils/alert';

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function providerLabel(authProvider) {
  if (authProvider === 'guest') return 'Guest';
  if (authProvider === 'google') return 'Google';
  if (authProvider === 'apple') return 'Apple';
  return authProvider;
}

// One row per registered (Google/Apple) or guest login (server's
// GET /api/admin/sessions) - deleting one runs the exact same permanent
// account deletion Settings > Delete account runs for yourself, so this
// asks twice before doing anything, same as DeleteAccountRow.
function SessionRow({ session, onDeleted }) {
  const [busy, setBusy] = useState(false);

  function confirmDelete() {
    showAlert(
      'Delete this login?',
      `This permanently deletes ${session.email || session.displayName || 'this guest session'} and everything ` +
        'in it - reports, medications, diet/activity history, chat. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDelete },
      ]
    );
  }

  async function performDelete() {
    setBusy(true);
    try {
      await deleteAdminSession(session.id);
      onDeleted(session.id);
    } catch (err) {
      setBusy(false);
      showAlert('Could not delete', err.message);
    }
  }

  return (
    <View style={[styles.row, cardShadow]}>
      <View style={styles.rowText}>
        <Text style={typography.body}>{session.email || session.displayName || 'Guest'}</Text>
        <Text style={typography.caption}>
          {providerLabel(session.authProvider)}
          {session.isSelf ? ' · You' : ''}
        </Text>
        <Text style={typography.caption}>Created {formatDateTime(session.createdAt)}</Text>
        <Text style={typography.caption}>Last used {formatDateTime(session.lastLoginAt)}</Text>
      </View>
      {!session.isSelf && (
        <TouchableOpacity
          style={[styles.deleteButton, busy && styles.deleteButtonDisabled]}
          onPress={confirmDelete}
          disabled={busy}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Admin-only (Settings row only shows for config.adminEmails - see
// SettingsScreen.jsx): every registered and guest login on the app, with
// when it was created and last used, and a way to delete one - or sweep
// every guest login at once - to clean up the closed-beta user cap
// (config.maxRegisteredUsers). Deleting here is identical to a user
// deleting their own account from Settings: permanent, no recovery.
export default function AdminSessionsScreen() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchAdminSessions();
      setSessions(data.sessions);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function handleDeleted(userId) {
    setSessions((current) => (current || []).filter((s) => s.id !== userId));
  }

  const guestCount = (sessions || []).filter((s) => s.authProvider === 'guest' && !s.isSelf).length;

  function confirmCleanupGuests() {
    showAlert(
      'Delete all guest sessions?',
      `This permanently deletes ${guestCount} guest login${guestCount === 1 ? '' : 's'} and everything in them. ` +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete all', style: 'destructive', onPress: performCleanup },
      ]
    );
  }

  async function performCleanup() {
    setCleaningUp(true);
    try {
      await cleanupGuestSessions();
      await load();
    } catch (err) {
      showAlert('Could not clean up guest sessions', err.message);
    } finally {
      setCleaningUp(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={typography.bodySecondary}>
          Every registered and guest login, with when it was created and last used. Deleting one is permanent.
        </Text>

        {guestCount > 0 && (
          <TouchableOpacity
            style={[styles.cleanupButton, cleaningUp && styles.deleteButtonDisabled]}
            onPress={confirmCleanupGuests}
            disabled={cleaningUp}
            activeOpacity={0.7}
          >
            <Text style={styles.cleanupButtonText}>
              {cleaningUp ? 'Cleaning up…' : `Clean up all guest sessions (${guestCount})`}
            </Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>Could not load sessions: {error}</Text>}
        {!sessions && !error && <ActivityIndicator style={styles.loading} color={colors.primary} />}

        {sessions && sessions.length === 0 && <Text style={typography.bodySecondary}>No sessions found.</Text>}

        {sessions?.map((session) => (
          <SessionRow key={session.id} session={session} onDeleted={handleDeleted} />
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
  loading: {
    marginTop: spacing.lg,
  },
  error: {
    color: colors.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.dangerMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonText: {
    color: colors.danger,
    fontWeight: '700',
  },
  cleanupButton: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  cleanupButtonText: {
    color: colors.danger,
    fontWeight: '700',
  },
});
