import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  approveAdminSession,
  bulkDeleteAdminSessions,
  cleanupGuestSessions,
  deleteAdminSession,
  fetchAdminSessions,
  rejectAdminSession,
} from '../api/client';
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

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTokens(value) {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

// Sub-cent costs are normal for a single low-usage login, so show enough
// precision to tell them apart instead of rounding everything to "$0.00" -
// same reasoning as AiUsageScreen's own formatCost.
function formatCost(value) {
  if (!value) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

// One row per registered (Google/Apple) or guest login (server's
// GET /api/admin/sessions) - deleting one runs the exact same permanent
// account deletion Settings > Delete account runs for yourself, so this
// asks twice before doing anything, same as DeleteAccountRow. The checkbox
// on the left feeds the multi-select bulk-delete bar below; you can't
// select or delete your own row (self-delete stays Settings > Delete
// account).
const APPROVAL_LABELS = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' };

function SessionRow({ session, selected, onToggleSelect, onDeleted, onDecided }) {
  const [busy, setBusy] = useState(false);

  async function decide(action, nextStatus) {
    setBusy(true);
    try {
      await action(session.id);
      onDecided(session.id, nextStatus);
    } catch (err) {
      showAlert('Could not update access', err.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmReject() {
    showAlert(
      'Reject this login?',
      `${session.email || session.displayName || 'This guest session'} will be signed out of the app's features ` +
        'and shown a "not approved" screen. You can approve it again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => decide(rejectAdminSession, 'rejected') },
      ]
    );
  }

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
      {session.isSelf ? (
        <View style={styles.checkboxSpacer} />
      ) : (
        <TouchableOpacity
          style={[styles.checkbox, selected && styles.checkboxChecked]}
          onPress={() => onToggleSelect(session.id)}
          activeOpacity={0.7}
        >
          {selected && <Text style={styles.checkboxMark}>✓</Text>}
        </TouchableOpacity>
      )}
      <View style={styles.rowText}>
        <Text style={typography.body}>{session.email || session.displayName || 'Guest'}</Text>
        <Text style={typography.caption}>
          {providerLabel(session.authProvider)}
          {session.isSelf ? ' · You' : ''}
        </Text>
        <Text
          style={[
            typography.caption,
            styles.statusText,
            session.approvalStatus === 'pending' && styles.statusPending,
            session.approvalStatus === 'rejected' && styles.statusRejected,
          ]}
        >
          {APPROVAL_LABELS[session.approvalStatus] || 'Approved'}
        </Text>
        <Text style={typography.caption}>Created {formatDateTime(session.createdAt)}</Text>
        <Text style={typography.caption}>Last used {formatDateTime(session.lastLoginAt)}</Text>
        <Text style={typography.caption}>
          AI usage: {formatTokens(session.aiUsage.totalTokens)} tokens ({formatCost(session.aiUsage.estimatedCostUsd)})
        </Text>
        <Text style={typography.caption}>Doc storage: {formatBytes(session.storageBytes)}</Text>
      </View>
      {!session.isSelf && (
        <View style={styles.actionColumn}>
          {session.approvalStatus !== 'approved' && (
            <TouchableOpacity
              style={[styles.approveButton, busy && styles.deleteButtonDisabled]}
              onPress={() => decide(approveAdminSession, 'approved')}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.approveButtonText}>Approve</Text>
            </TouchableOpacity>
          )}
          {session.approvalStatus !== 'rejected' && (
            <TouchableOpacity
              style={[styles.deleteButton, busy && styles.deleteButtonDisabled]}
              onPress={confirmReject}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.deleteButtonText}>Reject</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.deleteButton, busy && styles.deleteButtonDisabled]}
            onPress={confirmDelete}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// Admin-only (Settings row only shows for config.adminEmails - see
// SettingsScreen.jsx): every registered and guest login on the app, with
// when it was created and last used, and three ways to remove them - one
// at a time, a multi-select batch of checked-off rows, or sweeping every
// guest login at once - to clean up the closed-beta user cap
// (config.maxRegisteredUsers). Deleting here is identical to a user
// deleting their own account from Settings: permanent, no recovery.
export default function AdminSessionsScreen() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
    setSelectedIds((current) => {
      if (!current.has(userId)) return current;
      const next = new Set(current);
      next.delete(userId);
      return next;
    });
  }

  function handleDecided(userId, approvalStatus) {
    setSessions((current) => (current || []).map((s) => (s.id === userId ? { ...s, approvalStatus } : s)));
  }

  function toggleSelect(userId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const selectableIds = (sessions || []).filter((s) => !s.isSelf).map((s) => s.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  const pendingCount = (sessions || []).filter((s) => s.approvalStatus === 'pending' && !s.isSelf).length;
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
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      showAlert('Could not clean up guest sessions', err.message);
    } finally {
      setCleaningUp(false);
    }
  }

  function confirmBulkDelete() {
    const count = selectedIds.size;
    showAlert(
      `Delete ${count} selected login${count === 1 ? '' : 's'}?`,
      'This permanently deletes each one and everything in it - reports, medications, diet/activity history, chat. ' +
        'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performBulkDelete },
      ]
    );
  }

  async function performBulkDelete() {
    setBulkDeleting(true);
    try {
      await bulkDeleteAdminSessions([...selectedIds]);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      showAlert('Could not delete selected sessions', err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {pendingCount > 0 && (
          <Text style={styles.pendingNotice}>
            {pendingCount} new login{pendingCount === 1 ? ' is' : 's are'} waiting for your approval. Until approved,
            they only see a read-only dashboard - no uploads or AI features.
          </Text>
        )}
        <Text style={typography.bodySecondary}>
          Every registered and guest login, with when it was created and last used, its all-time AI usage, and how
          much stored file data (reports, scans) it holds. Deleting one is permanent.
        </Text>

        {selectableIds.length > 0 && (
          <View style={styles.selectAllRow}>
            <TouchableOpacity onPress={toggleSelectAll} activeOpacity={0.7}>
              <Text style={styles.selectAllText}>{allSelected ? 'Clear selection' : 'Select all'}</Text>
            </TouchableOpacity>
            {selectedIds.size > 0 && <Text style={typography.caption}>{selectedIds.size} selected</Text>}
          </View>
        )}

        {selectedIds.size > 0 && (
          <TouchableOpacity
            style={[styles.cleanupButton, bulkDeleting && styles.deleteButtonDisabled]}
            onPress={confirmBulkDelete}
            disabled={bulkDeleting}
            activeOpacity={0.7}
          >
            <Text style={styles.cleanupButtonText}>
              {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.size})`}
            </Text>
          </TouchableOpacity>
        )}

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
          <SessionRow
            key={session.id}
            session={session}
            selected={selectedIds.has(session.id)}
            onToggleSelect={toggleSelect}
            onDeleted={handleDeleted}
            onDecided={handleDecided}
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
  loading: {
    marginTop: spacing.lg,
  },
  error: {
    color: colors.danger,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectAllText: {
    color: colors.primary,
    fontWeight: '600',
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
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSpacer: {
    width: 20,
    height: 20,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  actionColumn: {
    gap: spacing.xs,
    alignItems: 'stretch',
  },
  approveButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  approveButtonText: {
    color: colors.surface,
    fontWeight: '700',
  },
  statusText: {
    fontWeight: '700',
  },
  statusPending: {
    color: colors.warning,
  },
  statusRejected: {
    color: colors.danger,
  },
  pendingNotice: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  deleteButton: {
    alignItems: 'center',
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
