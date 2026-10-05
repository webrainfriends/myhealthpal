import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { confirmWatchPairing, fetchWatchDevices, removeWatchDevice } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { doseRemindersEnabled, setDoseRemindersEnabled, syncDoseReminders } from '../notifications/medicationNotifications';

// Connects Apple Watch / Wear OS companion apps. Account-level: a watch
// belongs to the person who approved it, whichever family profile is selected.
// The watch shows a short code; entering it here approves that watch, which
// then collects its own limited, revocable token (server/src/routes/watch.js).
function formatDate(value, locale) {
  return value ? new Date(value).toLocaleDateString(locale) : null;
}

export default function WearablesScreen() {
  const t = useT();
  const [devices, setDevices] = useState(null);
  const [code, setCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [reminders, setReminders] = useState(doseRemindersEnabled());

  const load = useCallback(async () => {
    try {
      const data = await fetchWatchDevices();
      setDevices(data.devices);
    } catch (err) {
      setDevices([]);
      showAlert(t('wearables.couldNotLoad'), err.message);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function connect() {
    setConnecting(true);
    try {
      const { device } = await confirmWatchPairing(code.trim());
      setCode('');
      showAlert(t('wearables.connectedTitle'), t('wearables.connectedBody', { name: device.deviceName }));
      await load();
    } catch (err) {
      showAlert(t('wearables.couldNotConnect'), err.message);
    } finally {
      setConnecting(false);
    }
  }

  function confirmRemove(device) {
    showAlert(t('wearables.removeTitle', { name: device.deviceName }), t('wearables.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('wearables.remove'),
        style: 'destructive',
        onPress: async () => {
          setBusyId(device.id);
          try {
            await removeWatchDevice(device.id);
            setDevices((current) => (current || []).filter((d) => d.id !== device.id));
          } catch (err) {
            showAlert(t('wearables.couldNotRemove'), err.message);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  function toggleReminders(next) {
    setReminders(next);
    setDoseRemindersEnabled(next);
    syncDoseReminders({ t, enabled: next });
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.caption}>{t('wearables.intro')}</Text>

        <View style={[styles.card, cardShadow]}>
          <Text style={typography.body}>{t('wearables.codeLabel')}</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('wearables.codePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            maxLength={6}
            accessibilityLabel={t('wearables.codeLabel')}
          />
          <TouchableOpacity
            style={[styles.button, (code.length !== 6 || connecting) && styles.buttonDisabled]}
            onPress={connect}
            disabled={code.length !== 6 || connecting}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{connecting ? t('wearables.connecting') : t('wearables.connect')}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, cardShadow]}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={typography.body}>{t('wearables.remindersTitle')}</Text>
              <Text style={typography.caption}>{t('wearables.remindersBody')}</Text>
            </View>
            <Switch value={reminders} onValueChange={toggleReminders} trackColor={{ true: colors.primary }} />
          </View>
        </View>

        <Text style={[typography.heading, styles.sectionTitle]}>{t('wearables.yourWatches')}</Text>
        {devices === null && <ActivityIndicator color={colors.primary} />}
        {devices !== null && devices.length === 0 && (
          <View style={[styles.card, cardShadow]}>
            <Text style={typography.body}>{t('wearables.empty')}</Text>
          </View>
        )}
        {(devices || []).map((device) => (
          <View key={device.id} style={[styles.card, cardShadow]}>
            <Text style={typography.body}>
              ⌚ {device.deviceName}
            </Text>
            <Text style={typography.caption}>{t('wearables.pairedOn', { date: formatDate(device.pairedAt) })}</Text>
            <Text style={typography.caption}>
              {device.lastUsedAt ? t('wearables.lastUsed', { date: formatDate(device.lastUsedAt) }) : t('wearables.neverUsed')}
            </Text>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => confirmRemove(device)}
              disabled={busyId === device.id}
              accessibilityRole="button"
            >
              <Text style={styles.removeText}>{t('wearables.remove')}</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={[styles.card, cardShadow]}>
          <Text style={typography.heading}>{t('wearables.sharedTitle')}</Text>
          <Text style={typography.caption}>{t('wearables.shared')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { marginTop: spacing.sm },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    color: colors.textPrimary,
    backgroundColor: colors.surfaceMuted,
  },
  button: { backgroundColor: colors.primary, borderRadius: radii.pill, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: colors.onBrand, fontWeight: '800', fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: 2 },
  removeButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  removeText: { color: colors.danger, fontWeight: '700' },
});
