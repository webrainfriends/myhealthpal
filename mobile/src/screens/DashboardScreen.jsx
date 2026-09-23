import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ParameterPickerModal from '../components/ParameterPickerModal';
import OrganHealthCard from '../components/OrganHealthCard';
import ActivityCard from '../components/ActivityCard';
import DietCard from '../components/DietCard';
import SpeakButton from '../components/SpeakButton';
import SummaryCard from '../components/SummaryCard';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import {
  fetchActivitySummary,
  fetchCustomCards,
  fetchDashboardSnapshot,
  fetchDietSummary,
  fetchOrganHealth,
  pinParameter,
  unpinParameter,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';

function formatDate(value, t) {
  if (!value) return t('common.unknownDate');
  return formatCalendarDate(value, { month: 'short', day: 'numeric' });
}

function greetingForNow(t) {
  const hour = new Date().getHours();
  if (hour < 12) return t('dashboard.greetingMorning');
  if (hour < 18) return t('dashboard.greetingAfternoon');
  return t('dashboard.greetingEvening');
}

function firstName(user, t) {
  if (!user || user.authProvider === 'guest') return t('dashboard.guestName');
  const source = user.displayName || user.email || t('dashboard.guestName');
  return source.split(/[\s@]/)[0];
}

// Builds the sentence SpeakButton reads for the whole dashboard: organ
// scores, insight/attention counts, and each tracked metric's latest
// value - the same summary a sighted user scans down this screen to see.
function buildDashboardSpeech(snapshot, organs, t) {
  const parts = [];
  for (const organ of organs || []) {
    parts.push(`${organ.label}: ${organ.scorePercent === null ? t('common.dash') : `${organ.scorePercent}%`}.`);
  }
  parts.push(`${t('dashboard.aiInsights')}: ${snapshot.insights.length}. ${t('dashboard.needsAttention')}: ${snapshot.needsAttention.length}.`);
  for (const metric of snapshot.trackedMetrics || []) {
    const value = metric.raw_value !== null && metric.raw_value !== undefined ? `${metric.qualitative_value || metric.raw_value} ${metric.raw_unit || ''}` : t('dashboard.noConfirmedResults');
    parts.push(`${metric.display_name}: ${value}.`);
  }
  return parts.join(' ');
}

function TrackedMetricCard({ metric, onPress, onUnpin, t }) {
  const hasLatest = metric.raw_value !== null && metric.raw_value !== undefined;
  const current = metric.normalized_value;
  const previous = metric.previous_normalized_value;
  let change = null;
  if (current !== null && current !== undefined && previous !== null && previous !== undefined) {
    const delta = current - previous;
    if (Math.abs(delta) > 1e-9) change = delta > 0 ? `▲ ${Math.abs(delta).toFixed(1)}` : `▼ ${Math.abs(delta).toFixed(1)}`;
    else change = t('dashboard.noChange');
  }

  return (
    <TouchableOpacity style={styles.metricCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.metricHeaderRow}>
        <Text style={typography.heading} numberOfLines={1}>
          {metric.display_name}
        </Text>
        <TouchableOpacity onPress={onUnpin} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.unpinLabel}>✕</Text>
        </TouchableOpacity>
      </View>
      {hasLatest ? (
        <>
          <Text style={styles.metricValue}>
            {metric.qualitative_value || metric.raw_value} <Text style={styles.metricUnit}>{metric.raw_unit || ''}</Text>
          </Text>
          <Text style={typography.caption}>
            {formatDate(metric.effective_date, t)} · {metric.original_filename}
          </Text>
          {change && <Text style={typography.bodySecondary}>{change} {t('dashboard.vsPrevious')}</Text>}
        </>
      ) : (
        <Text style={typography.bodySecondary}>{t('dashboard.noConfirmedResults')}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState({ trackedMetrics: [], needsAttention: [], insights: [] });
  const [organs, setOrgans] = useState(null);
  const [customCards, setCustomCards] = useState(null);
  const [activity, setActivity] = useState(null);
  const [diet, setDiet] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const load = useCallback(async () => {
    // Promise.all rejects (and skips every setter below, including ones
    // whose own call already succeeded) the instant any ONE of these five
    // calls fails - one flaky/erroring endpoint used to blank out the
    // entire dashboard (organ grid, insights/attention counts, tracked
    // metrics, activity, diet - everything), not just its own card.
    // allSettled lets each section populate independently of the others.
    const [snapshotResult, organResult, customCardResult, activityResult, dietResult] = await Promise.allSettled([
      fetchDashboardSnapshot(),
      fetchOrganHealth(),
      // Results a report contained that matched nothing in the Health
      // Parameter Registry - grouped into their own ad-hoc cards (see
      // customCardService.js) so nothing extracted ever goes unshown.
      fetchCustomCards(),
      // A window wide enough that the card can fall back to the most
      // recently logged day (see /api/activity/summary) when nothing is
      // logged for today itself - a wearable export upload is common and
      // rarely includes literally today.
      fetchActivitySummary(7),
      fetchDietSummary(1),
    ]);

    if (snapshotResult.status === 'fulfilled') setSnapshot(snapshotResult.value);
    else console.warn('Failed to load dashboard snapshot', snapshotResult.reason?.message);

    if (organResult.status === 'fulfilled') setOrgans(organResult.value.organs);
    else console.warn('Failed to load organ health', organResult.reason?.message);

    if (customCardResult.status === 'fulfilled') setCustomCards(customCardResult.value.cards);
    else console.warn('Failed to load custom cards', customCardResult.reason?.message);

    if (activityResult.status === 'fulfilled') {
      setActivity({ current: activityResult.value.current, isCurrentToday: activityResult.value.isCurrentToday });
    } else {
      console.warn('Failed to load activity summary', activityResult.reason?.message);
    }

    if (dietResult.status === 'fulfilled') setDiet(dietResult.value);
    else console.warn('Failed to load diet summary', dietResult.reason?.message);

    setLoading(false);
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handlePin(parameterId) {
    if (!parameterId) return;
    try {
      await pinParameter(parameterId);
      await load();
    } catch (err) {
      showAlert(t('dashboard.couldNotPin'), err.message);
    }
  }

  async function handleUnpin(parameterId) {
    try {
      await unpinParameter(parameterId);
      await load();
    } catch (err) {
      showAlert(t('dashboard.couldNotUnpin'), err.message);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('dashboard.loadingDashboard')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.accountRow}>
          <View style={styles.greetingBlock}>
            <View style={styles.greetingRow}>
              <Text style={typography.title}>
                {greetingForNow(t)}, {firstName(user, t)}
              </Text>
              <SpeakButton text={buildDashboardSpeech(snapshot, organs, t)} label={t('dashboard.readSummary')} />
            </View>
            <Text style={typography.bodySecondary}>{t('dashboard.subtitle')}</Text>
          </View>
          <View style={styles.accountActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Settings')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.accountLabel}>{t('common.settings')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={signOut} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.accountLabel}>
                {user?.authProvider === 'guest' ? t('common.guest') : user?.email || t('common.account')} ·{' '}
                {t('common.signOut')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {activity && (
          <View style={styles.sectionSpacing}>
            <ActivityCard
              current={activity.current}
              isCurrentToday={activity.isCurrentToday}
              onPress={() => navigation.navigate('Activity')}
            />
          </View>
        )}

        {diet && (
          <View style={styles.sectionSpacing}>
            <DietCard
              today={diet.today}
              pendingReviewCount={diet.pendingReviewCount}
              onPress={() => navigation.navigate('Diet')}
            />
          </View>
        )}

        <Text style={[typography.heading, styles.sectionSpacing]}>{t('dashboard.yourBodyAtAGlance')}</Text>
        <Text style={[typography.caption, styles.sectionSubtitle]}>{t('dashboard.tapOrganHint')}</Text>
        {organs && (
          <View style={styles.metricGrid}>
            {organs.map((organ) => (
              <OrganHealthCard
                key={organ.key}
                organ={organ}
                onPress={() => navigation.navigate('OrganDetail', { organKey: organ.key, initialOrgan: organ })}
              />
            ))}
          </View>
        )}

        {customCards && customCards.length > 0 && (
          <>
            <Text style={[typography.heading, styles.sectionSpacing]}>{t('dashboard.moreFromReports')}</Text>
            <Text style={[typography.caption, styles.sectionSubtitle]}>{t('dashboard.moreFromReportsHint')}</Text>
            <View style={styles.metricGrid}>
              {customCards.map((card) => (
                <OrganHealthCard
                  key={card.key}
                  organ={card}
                  onPress={() => navigation.navigate('OrganDetail', { organKey: card.key, initialOrgan: card, source: 'custom' })}
                />
              ))}
            </View>
          </>
        )}

        <View style={styles.metricGrid}>
          <SummaryCard
            icon="🤖"
            count={snapshot.insights.length}
            label={t('dashboard.aiInsights')}
            subtitle={snapshot.insights.length === 0 ? t('dashboard.nothingNew') : t('dashboard.tapToView')}
            palette={snapshot.insights.length === 0 ? healthStatusColors.no_data : healthStatusColors.watch}
            onPress={() => navigation.navigate('Insights')}
          />
          <SummaryCard
            icon="⚠️"
            count={snapshot.needsAttention.length}
            label={t('dashboard.needsAttention')}
            subtitle={snapshot.needsAttention.length === 0 ? t('dashboard.allClear') : t('dashboard.tapToView')}
            palette={snapshot.needsAttention.length === 0 ? healthStatusColors.good : healthStatusColors.attention}
            onPress={() => navigation.navigate('NeedsAttention')}
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>{t('dashboard.myTrackedMetrics')}</Text>
          <TouchableOpacity onPress={() => setPickerVisible(true)}>
            <Text style={styles.addLabel}>{t('dashboard.addMetric')}</Text>
          </TouchableOpacity>
        </View>
        {snapshot.trackedMetrics.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.emptySection]}>{t('dashboard.nothingPinned')}</Text>
        ) : (
          <View style={styles.metricGrid}>
            {snapshot.trackedMetrics.map((metric) => (
              <TrackedMetricCard
                key={metric.health_parameter_id}
                metric={metric}
                t={t}
                onPress={() =>
                  navigation.navigate('ParameterTrend', { code: metric.parameter_code, displayName: metric.display_name })
                }
                onUnpin={() => handleUnpin(metric.health_parameter_id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <ParameterPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePin}
        title={t('dashboard.trackAMetric')}
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
    gap: spacing.sm,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  greetingBlock: {
    flex: 1,
    gap: 2,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  accountActions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  accountLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  sectionSpacing: {
    marginTop: spacing.lg,
  },
  sectionSubtitle: {
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  addLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
  emptySection: {
    marginTop: spacing.xs,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 2,
    ...cardShadow,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  unpinLabel: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricUnit: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
