import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, statusColors, typography } from '../theme/theme';

export default function StatusBadge({ status }) {
  const palette = statusColors[status] || { fg: colors.textSecondary, bg: colors.surfaceMuted };

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[typography.caption, { color: palette.fg }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
});
