import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { disconnectConnectedApp, fetchConnectedApps } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';

// AI apps (Claude, ChatGPT) connected to this account through the MCP
// connector. Account-level: a connection belongs to the person who approved
// it, whichever family profile is selected. Disconnecting revokes its tokens
// on the server straight away.
function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : null;
}

export default function ConnectedAppsScreen() {
  const t = useT();
  const [apps, setApps] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchConnectedApps();
      setApps(data.apps);
    } catch (err) {
      setApps([]);
      showAlert(t('privacy.connectedApps.couldNotLoad'), err.message);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function confirmDisconnect(app) {
    showAlert(t('privacy.connectedApps.disconnectTitle', { name: app.name }), t('privacy.connectedApps.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.connectedApps.disconnect'),
        style: 'destructive',
        onPress: async () => {
          setBusyId(app.id);
          try {
            await disconnectConnectedApp(app.id);
            setApps((current) => (current || []).filter((a) => a.id !== app.id));
          } catch (err) {
            showAlert(t('privacy.connectedApps.couldNotDisconnect'), err.message);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.caption}>{t('privacy.connectedApps.intro')}</Text>

        {apps === null && <ActivityIndicator color={colors.primary} />}

        {apps !== null && apps.length === 0 && (
          <View style={[styles.card, cardShadow]}>
            <Text style={typography.body}>{t('privacy.connectedApps.empty')}</Text>
          </View>
        )}

        {(apps || []).map((app) => (
          <View key={app.id} style={[styles.card, cardShadow]}>
            <Text style={typography.body}>{app.name}</Text>
            <View style={styles.chips}>
              {app.scopes.map((scope) => (
                <Text key={scope} style={styles.chip}>
                  {t(`privacy.connectedApps.scopes.${scope}`)}
                </Text>
              ))}
            </View>
            <Text style={typography.caption}>{t('privacy.connectedApps.connectedOn', { date: formatDate(app.connectedAt) })}</Text>
            <Text style={typography.caption}>
              {app.lastUsedAt
                ? t('privacy.connectedApps.lastUsed', { date: formatDate(app.lastUsedAt) })
                : t('privacy.connectedApps.neverUsed')}
            </Text>
            <TouchableOpacity
              style={styles.disconnect}
              onPress={() => confirmDisconnect(app)}
              disabled={busyId === app.id}
              accessibilityRole="button"
            >
              {busyId === app.id ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.disconnectText}>{t('privacy.connectedApps.disconnect')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    ...typography.caption,
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  disconnect: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: spacing.xs },
  disconnectText: { color: colors.danger, fontWeight: '700' },
});
