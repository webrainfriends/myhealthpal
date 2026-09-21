import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ParameterPickerModal from '../components/ParameterPickerModal';
import InsightCard from '../components/InsightCard';
import { colors, radii, spacing, typography } from '../theme/theme';
import { dismissInsight, fetchDashboardSnapshot, pinParameter, unpinParameter } from '../api/client';
import { useAuth } from '../auth/AuthContext';

function formatDate(value) {
  if (!value) return 'unknown date';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const [pickerVisible, setPickerVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchDashboardSnapshot();
      setSnapshot(data);
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
      Alert.alert('Could not pin metric', err.message);
    }
  }

  async function handleUnpin(parameterId) {
    try {
      await unpinParameter(parameterId);
      await load();
    } catch (err) {
      Alert.alert('Could not unpin metric', err.message);
    }
  }

  async function handleDismissInsight(id) {
    try {
      await dismissInsight(id);
      await load();
    } catch (err) {
      Alert.alert('Could not dismiss insight', err.message);
    }
  }

  function handleOpenInsight(insight) {
    const reportEvidence = (insight.evidence || []).find((e) => e.type === 'report');
    if (reportEvidence) navigation.navigate('ReportDetail', { reportId: reportEvidence.id });
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
          <Text style={typography.title}>Health snapshot</Text>
          <TouchableOpacity onPress={signOut} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.accountLabel}>
              {user?.authProvider === 'guest' ? 'Guest' : user?.email || 'Account'} · Sign out
            </Text>
          </TouchableOpacity>
        </View>

        {snapshot.insights.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={typography.heading}>AI insights</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Insights')}>
                <Text style={styles.addLabel}>See all</Text>
              </TouchableOpacity>
            </View>
            {snapshot.insights.slice(0, 3).map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onPress={() => handleOpenInsight(insight)}
                onDismiss={() => handleDismissInsight(insight.id)}
              />
            ))}
          </>
        )}

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

        <Text style={[typography.heading, styles.sectionSpacing]}>Needs attention</Text>
        {snapshot.needsAttention.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.emptySection]}>Nothing flagged right now.</Text>
        ) : (
          snapshot.needsAttention.slice(0, 8).map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.attentionRow}
              onPress={() => navigation.navigate('ReportDetail', { reportId: item.report_id })}
            >
              <Text style={typography.body}>{item.parameter_display_name || item.raw_test_name}</Text>
              <Text style={typography.caption}>
                {item.raw_value} {item.raw_unit || ''} {item.status_flag ? `· ${item.status_flag}` : '· needs review'} ·{' '}
                {item.original_filename}
              </Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={[typography.heading, styles.sectionSpacing]}>Recent reports</Text>
        {snapshot.recentReports.map((report) => (
          <TouchableOpacity
            key={report.id}
            style={styles.attentionRow}
            onPress={() => navigation.navigate('ReportDetail', { reportId: report.id })}
          >
            <Text style={typography.body} numberOfLines={1}>
              {report.original_filename}
            </Text>
            <Text style={typography.caption}>
              {formatDate(report.effective_date)} · {report.ingestion_status}
            </Text>
          </TouchableOpacity>
        ))}
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
    alignItems: 'center',
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 2,
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
  attentionRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: 2,
  },
});
