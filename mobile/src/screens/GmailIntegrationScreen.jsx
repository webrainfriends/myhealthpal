import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import PrimaryButton from '../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import {
  fetchGmailStatus,
  fetchGmailConnectUrl,
  disconnectGmail,
  searchGmailCandidates,
  importGmailSelections,
  fetchGmailDocuments,
} from '../api/client';
import { showAlert } from '../utils/alert';

function attachmentKey(messageId, attachmentId) {
  return `${messageId}:${attachmentId}`;
}

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function GmailIntegrationScreen({ navigation }) {
  const [status, setStatus] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [documents, setDocuments] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await fetchGmailStatus();
      setStatus(data);
      if (data.connected) {
        fetchGmailDocuments()
          .then((d) => setDocuments(d.documents))
          .catch(() => {});
      }
    } catch (err) {
      showAlert('Could not load Gmail status', err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Connecting happens in the system browser (Google's own consent screen)
  // outside the app, so there is no in-app callback to react to - refresh
  // status/documents every time this screen regains focus instead, which
  // covers the "user switched back after approving/denying" case.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleConnect() {
    setConnecting(true);
    try {
      const { authUrl } = await fetchGmailConnectUrl();
      await Linking.openURL(authUrl);
    } catch (err) {
      showAlert('Could not start Gmail connection', err.message);
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    showAlert('Disconnect Gmail?', 'EyeMyHealth will stop searching your Gmail. Reports already imported are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          setDisconnecting(true);
          try {
            await disconnectGmail();
            setCandidates(null);
            setSelected(new Set());
            await load();
          } catch (err) {
            showAlert('Could not disconnect Gmail', err.message);
          } finally {
            setDisconnecting(false);
          }
        },
      },
    ]);
  }

  async function handleSearch() {
    setSearching(true);
    try {
      const { candidates: found } = await searchGmailCandidates();
      setCandidates(found);
      setSelected(new Set());
      if (found.length === 0) {
        showAlert('No new health emails found', 'EyeMyHealth did not find any likely medical reports in the searched window.');
      }
    } catch (err) {
      if (err.status === 409) {
        showAlert('Gmail needs to be reconnected', err.message);
        load();
      } else {
        showAlert('Search failed', err.message);
      }
    } finally {
      setSearching(false);
    }
  }

  function toggleAttachment(messageId, attachmentId) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = attachmentKey(messageId, attachmentId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleImport() {
    const selections = [...selected].map((key) => {
      const [messageId, attachmentId] = key.split(':');
      return { messageId, attachmentId };
    });
    if (selections.length === 0) return;

    setImporting(true);
    try {
      const { results } = await importGmailSelections(selections);
      const imported = results.filter((r) => r.status === 'imported').length;
      const duplicate = results.filter((r) => r.status === 'duplicate').length;
      const errored = results.filter((r) => r.status === 'error');

      const importedKeys = new Set(
        results.filter((r) => r.status !== 'error').map((r) => attachmentKey(r.messageId, r.attachmentId))
      );
      setCandidates((prev) =>
        prev
          .map((candidate) => ({
            ...candidate,
            attachments: candidate.attachments.filter(
              (a) => !importedKeys.has(attachmentKey(candidate.messageId, a.attachmentId))
            ),
          }))
          .filter((candidate) => candidate.attachments.length > 0)
      );
      setSelected(new Set());

      const summaryLines = [`Imported: ${imported}`, `Already imported: ${duplicate}`];
      if (errored.length > 0) summaryLines.push(`Could not import: ${errored.length}`);
      showAlert('Import complete', summaryLines.join('\n'));
      load();
    } catch (err) {
      if (err.status === 409) {
        showAlert('Gmail needs to be reconnected', err.message);
        load();
      } else {
        showAlert('Import failed', err.message);
      }
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.centered} color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!status?.configured) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={typography.bodySecondary}>Gmail integration is not available on this server yet.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>
          EyeMyHealth only searches for likely medical emails with attachments (lab reports, prescriptions, discharge
          summaries) - never your full inbox, and never anything until you choose to search and select what to
          import.
        </Text>

        <View style={[styles.card, styles.section]}>
          {status.connected ? (
            <>
              <View style={styles.rowBetween}>
                <Text style={typography.body}>{status.emailAddress}</Text>
                <View style={[styles.connectionPill, status.status === 'reauth_required' && styles.connectionPillWarning]}>
                  <Text
                    style={[
                      styles.connectionPillText,
                      status.status === 'reauth_required' && styles.connectionPillTextWarning,
                    ]}
                  >
                    {status.status === 'reauth_required' ? 'Needs reconnection' : 'Connected'}
                  </Text>
                </View>
              </View>
              {status.status === 'reauth_required' && (
                <Text style={[typography.caption, styles.warningText]}>
                  Gmail access has expired or was revoked. Reconnect to keep searching for reports.
                </Text>
              )}
              <Text style={typography.caption}>Last searched: {formatDateTime(status.lastSyncCompletedAt)}</Text>
              <Text style={typography.caption}>Connected: {formatDateTime(status.connectedAt)}</Text>

              {status.status === 'reauth_required' ? (
                <PrimaryButton title="Reconnect Gmail" onPress={handleConnect} loading={connecting} />
              ) : (
                <PrimaryButton title="Search for health emails" onPress={handleSearch} loading={searching} />
              )}
              <PrimaryButton
                title="Disconnect Gmail"
                variant="secondary"
                onPress={handleDisconnect}
                loading={disconnecting}
              />
            </>
          ) : (
            <>
              <Text style={typography.body}>Gmail is not connected.</Text>
              <PrimaryButton title="Connect Gmail" onPress={handleConnect} loading={connecting} />
            </>
          )}
        </View>

        {candidates && candidates.length > 0 && (
          <View style={[styles.card, styles.section]}>
            <Text style={typography.body}>Candidate emails</Text>
            {candidates.map((candidate) => (
              <View key={candidate.messageId} style={styles.candidate}>
                <Text style={typography.body} numberOfLines={1}>
                  {candidate.subject || '(no subject)'}
                </Text>
                <Text style={typography.caption} numberOfLines={1}>
                  {candidate.sender} · {formatDateTime(candidate.receivedAt)}
                </Text>
                {candidate.predictedCategory && (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryPillText}>{candidate.predictedCategory}</Text>
                  </View>
                )}
                {candidate.attachments.map((attachment) => {
                  const key = attachmentKey(candidate.messageId, attachment.attachmentId);
                  const isSelected = selected.has(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.attachmentRow}
                      onPress={() => toggleAttachment(candidate.messageId, attachment.attachmentId)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                        {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={typography.bodySecondary} numberOfLines={1}>
                        {attachment.filename}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <PrimaryButton
              title={`Import selected (${selected.size})`}
              onPress={handleImport}
              disabled={selected.size === 0}
              loading={importing}
            />
          </View>
        )}

        {documents.length > 0 && (
          <View style={[styles.card, styles.section]}>
            <Text style={typography.body}>Imported from Gmail ({documents.length})</Text>
            {documents.slice(0, 5).map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.documentRow}
                onPress={() => doc.report_id && navigation.navigate('ReportDetail', { reportId: doc.report_id })}
                activeOpacity={0.7}
              >
                <Text style={typography.bodySecondary} numberOfLines={1}>
                  {doc.original_filename}
                </Text>
                <Text style={typography.caption}>{formatDateTime(doc.received_at)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningText: {
    color: colors.warning,
  },
  connectionPill: {
    backgroundColor: colors.successMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  connectionPillWarning: {
    backgroundColor: colors.warningMuted,
  },
  connectionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  connectionPillTextWarning: {
    color: colors.warning,
  },
  candidate: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    gap: 4,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  categoryPillText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
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
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
});
