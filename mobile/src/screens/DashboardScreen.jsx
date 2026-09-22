import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ParameterPickerModal from '../components/ParameterPickerModal';
import OrganHealthCard from '../components/OrganHealthCard';
import ActivityCard from '../components/ActivityCard';
import SummaryCard from '../components/SummaryCard';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { fetchActivitySummary, fetchDashboardSnapshot, fetchOrganHealth, pinParameter, unpinParameter } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { showAlert } from '../utils/alert';

function formatDate(value) {
  if (!value) return 'unknown date';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(user) {
  if (!user || user.authProvider === 'guest') return 'there';
  const source = user.displayName || user.email || 'there';
  return source.split(/[\s@]/)[0];
}

function TrackedMetricCard({ metric, onPress, onUnpin }) {
  const hasLatest = metric.raw_value !== null && metric.raw_value !== undefined;
  const current = metric.normalized_value;
  const previous = metric.previous_normalized_value;
  let change = null;
  if (current !== null && current !== undefined && previous !== null && previous !== undefined) {
    const delta = current - previous;
    if (Math.abs(delta) > 1e-9) change = delta > 0 ? `▲ ${Math.abs(delta).toFixed(1)}` : `▼ ${Math.abs(delta).toFixed(1)}`;
    else change = 'No change';
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
            {formatDate(metric.effective_date)} · {metric.original_filename}
          </Text>
          {change && <Text style={typography.bodySecondary}>{change} vs. previous</Text>}
        </>
      ) : (
        <Text style={typography.bodySecondary}>No confirmed results yet.</Text>
      )}
    </TouchableOpacity>
  );
}

export default function DashboardScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  const [organs, setOrgans] = useState(null);
  const [activity, setActivity] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, organData, activityData] = await Promise.all([
        fetchDashboardSnapshot(),
        fetchOrganHealth(),
        // A window wide enough that the card can fall back to the most
        // recently logged day (see /api/activity/summary) when nothing is
        // logged for today itself - a wearable export upload is common and
        // rarely includes literally today.
        fetchActivitySummary(7),
      ]);
      setSnapshot(data);
      setOrgans(organData.organs);
      setActivity({ current: activityData.current, isCurrentToday: activityData.isCurrentToday });
    } catch (err) {
      console.warn('Failed to load dashboard', err.message);
    }
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
      showAlert('Could not pin metric', err.message);
    }
  }

  async function handleUnpin(parameterId) {
    try {
      await unpinParameter(parameterId);
      await load();
    } catch (err) {
      showAlert('Could not unpin metric', err.message);
    }
  }

  if (!snapshot) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading dashboard…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.accountRow}>
          <View>
            <Text style={typography.title}>
              {greetingForNow()}, {firstName(user)}
            </Text>
            <Text style={typography.bodySecondary}>Here's how your body is doing today.</Text>
          </View>
          <View style={styles.accountActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Settings')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.accountLabel}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={signOut} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.accountLabel}>
                {user?.authProvider === 'guest' ? 'Guest' : user?.email || 'Account'} · Sign out
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

        <Text style={[typography.heading, styles.sectionSpacing]}>Your body, at a glance</Text>
        <Text style={[typography.caption, styles.sectionSubtitle]}>
          Tap an organ to see the tests behind its score.
        </Text>
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

        <View style={styles.metricGrid}>
          <SummaryCard
            icon="🤖"
            count={snapshot.insights.length}
            label="AI insights"
            subtitle={snapshot.insights.length === 0 ? 'Nothing new' : 'Tap to view'}
            palette={snapshot.insights.length === 0 ? healthStatusColors.no_data : healthStatusColors.watch}
            onPress={() => navigation.navigate('Insights')}
          />
          <SummaryCard
            icon="⚠️"
            count={snapshot.needsAttention.length}
            label="Needs attention"
            subtitle={snapshot.needsAttention.length === 0 ? 'All clear' : 'Tap to view'}
            palette={snapshot.needsAttention.length === 0 ? healthStatusColors.good : healthStatusColors.attention}
            onPress={() => navigation.navigate('NeedsAttention')}
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>My tracked metrics</Text>
          <TouchableOpacity onPress={() => setPickerVisible(true)}>
            <Text style={styles.addLabel}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {snapshot.trackedMetrics.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.emptySection]}>
            Nothing pinned yet. Tap "+ Add" to track a metric like Hemoglobin or Glucose.
          </Text>
        ) : (
          <View style={styles.metricGrid}>
            {snapshot.trackedMetrics.map((metric) => (
              <TrackedMetricCard
                key={metric.health_parameter_id}
                metric={metric}
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
        title="Track a metric"
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
