import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { coverageColors, radii, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { COVERAGE_LABEL_KEYS } from '../utils/insurance';

// A small verdict pill - "Covered" / "Partly covered" / "Not covered" / "Not
// mentioned" - optionally led by the policy it applies to. Tappable when the
// caller wants the clause detail behind it.
export default function CoverageBadge({ status, policyName, onPress, compact }) {
  const t = useT();
  const palette = coverageColors[status] || coverageColors.not_mentioned;
  const label = t(COVERAGE_LABEL_KEYS[status] || COVERAGE_LABEL_KEYS.not_mentioned);
  const content = (
    <View style={[styles.badge, compact && styles.compact, { backgroundColor: palette.bg }]}>
      <Text style={[typography.caption, styles.text, { color: palette.fg }]} numberOfLines={1}>
        {policyName ? `${policyName} · ` : ''}
        {label}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexShrink: 1,
  },
  compact: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontWeight: '700',
  },
});
