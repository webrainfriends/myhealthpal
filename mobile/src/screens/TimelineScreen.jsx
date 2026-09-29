import { useCallback, useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TimelineItemCard from '../components/TimelineItemCard';
import { colors, radii, spacing, typography } from '../theme/theme';
import { deleteReport, fetchTimeline } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';

const CATEGORIES = ['hematology', 'metabolic', 'lipids', 'electrolytes', 'kidney', 'liver', 'thyroid', 'vitamins'];

export default function TimelineScreen({ navigation }) {
  const t = useT();
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

  function handleDelete(item) {
    showAlert(
      t('timeline.deleteConfirmTitle'),
      t('timeline.deleteConfirmMessage', { name: item.original_filename }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            // Optimistic removal - this screen owns the list, so there's no
            // stale-data risk the way a "goBack with no history" navigation
            // has on other screens; a failure below restores it via load().
            setItems((prev) => prev.filter((i) => i.id !== item.id));
            try {
              await deleteReport(item.id);
            } catch (err) {
              showAlert(t('timeline.couldNotDelete'), err.message);
              load();
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder={t('timeline.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, category === null && styles.chipActive]}
            onPress={() => setCategory(null)}
          >
            <Text style={[styles.chipText, category === null && styles.chipTextActive]}>{t('timeline.all')}</Text>
          </TouchableOpacity>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, category === cat && styles.chipActive]}
              onPress={() => setCategory(category === cat ? null : cat)}
            >
              <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>
                {t(`timeline.categories.${cat}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TimelineItemCard
            item={item}
            onPress={() => navigation.navigate('ReportDetail', { reportId: item.id })}
            onDelete={() => handleDelete(item)}
          />
        )}
        ListEmptyComponent={
          !loading && <Text style={[typography.bodySecondary, styles.empty]}>{t('timeline.empty')}</Text>
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
