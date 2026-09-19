import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import StatusBadge from './StatusBadge';
import { colors, radii, spacing, typography } from '../theme/theme';

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReportCard({ report, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={[typography.heading, styles.filename]} numberOfLines={1}>
          {report.original_filename}
        </Text>
        <StatusBadge status={report.ingestion_status} />
      </View>
      <Text style={typography.bodySecondary}>Uploaded {formatDate(report.upload_timestamp)}</Text>
      {report.generated_summary ? (
        <Text style={[typography.bodySecondary, styles.summary]} numberOfLines={2}>
          {report.generated_summary}
        </Text>
      ) : null}
      {report.processing_error ? (
        <Text style={[typography.bodySecondary, styles.error]} numberOfLines={2}>
          {report.processing_error}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filename: {
    flexShrink: 1,
  },
  summary: {
    marginTop: spacing.xs,
  },
  error: {
    marginTop: spacing.xs,
    color: colors.danger,
  },
});
