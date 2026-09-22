import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import InsightCard from '../components/InsightCard';
import { colors, spacing, typography } from '../theme/theme';
import { dismissInsight, fetchInsights, sendInsightFeedback } from '../api/client';
import { showAlert } from '../utils/alert';

export default function InsightsScreen({ navigation }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchInsights('active');
      setInsights(data.insights);
    } catch (err) {
      console.warn('Failed to load insights', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handleDismiss(id) {
    setInsights((prev) => prev.filter((i) => i.id !== id));
    try {
      await dismissInsight(id);
    } catch (err) {
      showAlert('Could not dismiss insight', err.message);
      load();
    }
  }

  async function handleFeedback(id, feedback) {
    try {
      await sendInsightFeedback(id, feedback);
    } catch (err) {
      showAlert('Could not send feedback', err.message);
    }
  }

  function handleOpen(insight) {
    const reportEvidence = (insight.evidence || []).find((e) => e.type === 'report');
    if (reportEvidence) {
      navigation.navigate('ReportDetail', { reportId: reportEvidence.id });
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FlatList
        data={insights}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<Text style={[typography.title, styles.title]}>AI insights</Text>}
        renderItem={({ item }) => (
          <InsightCard
            insight={item}
            onPress={() => handleOpen(item)}
            onDismiss={() => handleDismiss(item.id)}
            onFeedback={(feedback) => handleFeedback(item.id, feedback)}
          />
        )}
        ListEmptyComponent={
          !loading && (
            <Text style={[typography.bodySecondary, styles.empty]}>
              Nothing to highlight yet. Insights appear here as you confirm reports over time.
            </Text>
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
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    marginBottom: spacing.md,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
