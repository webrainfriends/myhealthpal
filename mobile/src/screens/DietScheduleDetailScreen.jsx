import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DietScheduleEntryCard from '../components/DietScheduleEntryCard';
import { colors, radii, spacing, typography } from '../theme/theme';
import { formatCalendarDate } from '../utils/date';
import {
  fetchDietSchedule,
  fetchDietScheduleImpact,
  fetchRecipeReactions,
  logDietScheduleEntry,
  retryDietScheduleEntryRecipe,
  updateDietScheduleEntry,
} from '../api/client';
import { showAlert } from '../utils/alert';

const IMPACT_SEVERITY_COLORS = {
  important: { fg: colors.danger, bg: colors.dangerMuted },
  attention: { fg: colors.warning, bg: colors.warningMuted },
  info: { fg: colors.primary, bg: colors.primaryMuted },
};

function groupByDay(entries) {
  const byDay = new Map();
  for (const entry of entries) {
    const list = byDay.get(entry.dayNumber) || [];
    list.push(entry);
    byDay.set(entry.dayNumber, list);
  }
  return [...byDay.entries()].sort(([a], [b]) => a - b);
}

// The diet schedule's calendar view - every day's meals, each expected to
// carry a full generated recipe (requirement 4), plus the worsens/improves
// cross-check against the person's body-test reports (requirement 2).
// Recipe generation/backfill runs in the background server-side, so this
// screen polls while anything is still pending/generating.
export default function DietScheduleDetailScreen({ navigation, route }) {
  const { scheduleId } = route.params;
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reactions, setReactions] = useState({});
  const [impact, setImpact] = useState(null);
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [loggingId, setLoggingId] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchDietSchedule(scheduleId);
      setSchedule(data.schedule);
      const recipeIds = data.schedule.entries.filter((e) => e.recipe).map((e) => e.recipe.id);
      if (recipeIds.length > 0) {
        const reactionData = await fetchRecipeReactions(recipeIds);
        setReactions(reactionData.reactions || {});
      }
      if (data.schedule.entries.some((e) => e.recipeStatus === 'generated')) {
        fetchDietScheduleImpact(scheduleId).then((d) => setImpact(d.impact)).catch(() => {});
      }
      return data.schedule;
    } catch (err) {
      showAlert('Could not load this schedule', err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  // Poll every 3s while backfill/generation is still running for any entry,
  // so recipes appear without the person having to manually refresh.
  useEffect(() => {
    const hasPending = schedule?.entries?.some((e) => ['pending', 'generating'].includes(e.recipeStatus));
    if (!hasPending) {
      clearInterval(pollRef.current);
      return undefined;
    }
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [schedule, load]);

  async function handleSaveDishName(entryId, dishName) {
    try {
      const data = await updateDietScheduleEntry(entryId, { dishName });
      setSchedule((prev) => ({
        ...prev,
        entries: prev.entries.map((e) => (e.id === entryId ? data.entry : e)),
      }));
    } catch (err) {
      showAlert('Could not update this meal', err.message);
    }
  }

  async function handleLog(entryId) {
    setLoggingId(entryId);
    try {
      const foodEntry = await logDietScheduleEntry(entryId);
      setSchedule((prev) => ({
        ...prev,
        entries: prev.entries.map((e) => (e.id === entryId ? { ...e, foodEntryId: foodEntry.id } : e)),
      }));
    } catch (err) {
      showAlert('Could not log this meal', err.message);
    } finally {
      setLoggingId(null);
    }
  }

  async function handleRetry(entryId) {
    setRetryingId(entryId);
    try {
      await retryDietScheduleEntryRecipe(entryId);
      setSchedule((prev) => ({
        ...prev,
        entries: prev.entries.map((e) => (e.id === entryId ? { ...e, recipeStatus: 'pending' } : e)),
      }));
    } catch (err) {
      showAlert('Could not retry this recipe', err.message);
    } finally {
      setRetryingId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.status} color={colors.primary} />
      </SafeAreaView>
    );
  }
  if (!schedule) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.status]}>This schedule could not be found.</Text>
      </SafeAreaView>
    );
  }

  const days = groupByDay(schedule.entries);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>{schedule.title}</Text>
        <Text style={typography.bodySecondary}>
          {schedule.duration_days} days · starts {formatCalendarDate(schedule.start_date)}
        </Text>

        {impact && (impact.worsens.length > 0 || impact.improves.length > 0) && (
          <View style={styles.impactSection}>
            <Text style={typography.heading}>How this schedule may affect you</Text>
            {impact.worsens.map((tip) => {
              const palette = IMPACT_SEVERITY_COLORS[tip.severity] || IMPACT_SEVERITY_COLORS.info;
              return (
                <View key={`worsen-${tip.key}`} style={[styles.impactCard, { backgroundColor: palette.bg }]}>
                  <Text style={[styles.impactTitle, { color: palette.fg }]}>⚠️ {tip.title}</Text>
                  <Text style={typography.bodySecondary}>{tip.detail}</Text>
                </View>
              );
            })}
            {impact.improves.map((tip) => (
              <View key={`improve-${tip.key}`} style={[styles.impactCard, { backgroundColor: colors.successMuted }]}>
                <Text style={[styles.impactTitle, { color: colors.success }]}>✅ {tip.title}</Text>
                <Text style={typography.bodySecondary}>{tip.detail}</Text>
              </View>
            ))}
          </View>
        )}

        {days.map(([dayNumber, dayEntries]) => (
          <View key={dayNumber} style={styles.daySection}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayHeaderText}>Day {dayNumber}</Text>
              <Text style={typography.caption}>{formatCalendarDate(dayEntries[0].scheduledDate)}</Text>
            </View>
            {dayEntries.map((entry) => (
              <DietScheduleEntryCard
                key={entry.id}
                entry={entry}
                expanded={expandedEntryId === entry.id}
                onToggleExpand={() => setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id))}
                onSaveDishName={(name) => handleSaveDishName(entry.id, name)}
                onLog={() => handleLog(entry.id)}
                onRetry={() => handleRetry(entry.id)}
                logging={loggingId === entry.id}
                retrying={retryingId === entry.id}
                reaction={entry.recipe ? reactions[entry.recipe.id] || null : null}
                onReactionChange={(next) =>
                  setReactions((prev) => ({ ...prev, [entry.recipe.id]: next }))
                }
              />
            ))}
          </View>
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
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  status: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  impactSection: {
    gap: spacing.sm,
  },
  impactCard: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  impactTitle: {
    fontWeight: '700',
    fontSize: 14,
  },
  daySection: {
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  dayHeaderText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
});
