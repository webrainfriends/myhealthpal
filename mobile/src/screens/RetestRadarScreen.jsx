import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RetestPlanCard, { BOOKING_WINDOW_DAYS, countdownLabel, openBooking, reasonLabel } from '../components/RetestPlanCard';
import SpeakButton from '../components/SpeakButton';
import { colors, spacing, typography } from '../theme/theme';
import { dismissRetestPlan, fetchRetestPlans, setRetestCheckin, snoozeRetestPlan } from '../api/client';
import { syncLocalRetestReminders } from '../notifications/retestNotifications';
import { useT } from '../i18n/I18nContext';
import { useAuth } from '../auth/AuthContext';
import { showAlert } from '../utils/alert';

function buildSpeech(plans, t) {
  if (plans.length === 0) return t('retest.empty');
  return plans
    .map((p) => `${p.parameterDisplayName}: ${countdownLabel(p.daysLeft, t)}. ${reasonLabel(p, t)}. ${p.microAction || ''}`)
    .join(' ');
}

export default function RetestRadarScreen({ navigation }) {
  const t = useT();
  const { activeProfile } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchRetestPlans();
      setPlans(data.plans);
      syncLocalRetestReminders(data.plans, { enabled: data.remindersEnabled, t, profile: activeProfile });
    } catch (err) {
      console.warn('Failed to load retest plans', err.message);
    } finally {
      setLoading(false);
    }
  }, [t, activeProfile]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handleToggleCheckin(plan) {
    try {
      const { plan: updated } = await setRetestCheckin(plan.id, !plan.checkedInThisWeek);
      if (updated) setPlans((current) => current.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      showAlert(t('retest.couldNotUpdate'), err.message);
    }
  }

  async function handleRemove(plan, action) {
    try {
      await action(plan.id);
      setPlans((current) => current.filter((p) => p.id !== plan.id));
    } catch (err) {
      showAlert(t('retest.couldNotUpdate'), err.message);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={[typography.bodySecondary, styles.headerTitle]}>{t('retest.subtitle')}</Text>
              <SpeakButton getText={() => buildSpeech(plans, t)} label={t('retest.readAloud')} />
            </View>
            <Text style={typography.caption}>{t('retest.disclaimer')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <RetestPlanCard
            plan={item}
            t={t}
            onToggleCheckin={handleToggleCheckin}
            actions={[
              // Further out, booking is a quieter action - the card shows the
              // prominent button once the date is close.
              ...(item.bookingUrl && item.daysLeft > BOOKING_WINDOW_DAYS
                ? [{ label: t('retest.bookTest'), onPress: () => openBooking(item) }]
                : []),
              {
                label: t('retest.viewTrend'),
                onPress: () =>
                  navigation.navigate('ParameterTrend', { code: item.parameterCode, displayName: item.parameterDisplayName }),
              },
              { label: t('retest.snooze'), onPress: () => handleRemove(item, (id) => snoozeRetestPlan(id, 7)) },
              { label: t('retest.dismiss'), onPress: () => handleRemove(item, dismissRetestPlan) },
            ]}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={!loading && <Text style={[typography.bodySecondary, styles.empty]}>{t('retest.empty')}</Text>}
      />
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
    paddingBottom: spacing.xl,
  },
  header: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    flex: 1,
  },
  separator: {
    height: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
