import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, statusColors, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

export default function StatusBadge({ status }) {
  const t = useT();
  const palette = statusColors[status] || { fg: colors.textSecondary, bg: colors.surfaceMuted };

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[typography.caption, { color: palette.fg }]}>{t(`status.${status}`)}</Text>
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
