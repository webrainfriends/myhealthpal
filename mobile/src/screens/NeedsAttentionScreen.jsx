import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchDashboardSnapshot } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

function formatDate(value) {
  if (!value) return 'unknown date';
  return formatCalendarDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

function AttentionRow({ item, onPress, t }) {
  return (
    <TouchableOpacity style={[styles.row, cardShadow]} onPress={onPress} activeOpacity={0.7}>
      <Text style={typography.body}>{item.parameter_display_name || item.raw_test_name}</Text>
      <Text style={typography.caption}>
        {item.raw_value} {item.raw_unit || ''} {item.status_flag ? `· ${item.status_flag}` : `· ${t('needsAttention.needsReview')}`} ·{' '}
        {item.original_filename} · {formatDate(item.effective_date)}
      </Text>
    </TouchableOpacity>
  );
}

export default function NeedsAttentionScreen({ navigation }) {
  const t = useT();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchDashboardSnapshot();
      setItems(data.needsAttention);
    } catch (err) {
      console.warn('Failed to load needs-attention items', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <AttentionRow
            item={item}
            t={t}
            onPress={() => navigation.navigate('ReportDetail', { reportId: item.report_id })}
          />
        )}
        ListEmptyComponent={
          !loading && <Text style={[typography.bodySecondary, styles.empty]}>{t('needsAttention.empty')}</Text>
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
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
