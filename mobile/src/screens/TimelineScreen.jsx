import { useCallback, useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TimelineItemCard from '../components/TimelineItemCard';
import { colors, radii, spacing, typography } from '../theme/theme';
import { fetchTimeline } from '../api/client';

const CATEGORIES = ['hematology', 'metabolic', 'lipids', 'electrolytes', 'kidney', 'liver', 'thyroid', 'vitamins'];

export default function TimelineScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchTimeline({ search, category });
      setItems(data.timeline);
    } catch (err) {
      console.warn('Failed to load timeline', err.message);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // Search/category changes already reload via the debounce above; this
  // covers the far more common case - a report finished processing (or a
  // new one was uploaded) while the user was on a different tab, and they
  // switch back here expecting to see it without changing any filter.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={typography.title}>Timeline</Text>
        <TextInput
          style={styles.search}
          placeholder="Search reports or parameters"
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, category === null && styles.chipActive]}
            onPress={() => setCategory(null)}
          >
            <Text style={[styles.chipText, category === null && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, category === cat && styles.chipActive]}
              onPress={() => setCategory(category === cat ? null : cat)}
            >
              <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TimelineItemCard item={item} onPress={() => navigation.navigate('ReportDetail', { reportId: item.id })} />
        )}
        ListEmptyComponent={
          !loading && (
            <Text style={[typography.bodySecondary, styles.empty]}>No reports match these filters yet.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: spacing.xs,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: colors.surface,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
