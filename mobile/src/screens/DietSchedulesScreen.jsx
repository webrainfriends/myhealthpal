import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DietScheduleCard from '../components/DietScheduleCard';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { deleteDietSchedule, fetchDietSchedules } from '../api/client';
import { showAlert } from '../utils/alert';

// A person's diet schedules (7 or 15 day plans - manual, imported, or
// generated from their mini kitchen). Mirrors RetestRadarScreen.jsx's
// FlatList/focus-refresh pattern since both list "plans with an outcome
// that changes in the background" (a retest's due date; a schedule's
// recipe generation and impact flags).
export default function DietSchedulesScreen({ navigation }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchDietSchedules();
      setSchedules(data.schedules);
    } catch (err) {
      console.warn('Failed to load diet schedules', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handleDelete(schedule) {
    showAlert('Delete this schedule?', schedule.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDietSchedule(schedule.id);
            setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
          } catch (err) {
            showAlert('Could not delete this schedule', err.message);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={schedules}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[typography.bodySecondary, styles.headerText]}>
              Plan up to 15 days of meals - type them in, import a document, or build one from your mini kitchen.
            </Text>
            <PrimaryButton title="+ New schedule" onPress={() => navigation.navigate('DietScheduleForm')} />
            <PrimaryButton title="🧺 Mini kitchen" variant="secondary" onPress={() => navigation.navigate('Kitchen')} />
          </View>
        }
        renderItem={({ item }) => (
          <DietScheduleCard
            schedule={item}
            onPress={() => navigation.navigate('DietScheduleDetail', { scheduleId: item.id })}
            onDelete={() => handleDelete(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={!loading && <Text style={[typography.bodySecondary, styles.empty]}>No diet schedules yet.</Text>}
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
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerText: {
    marginBottom: spacing.xs,
  },
  separator: {
    height: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
