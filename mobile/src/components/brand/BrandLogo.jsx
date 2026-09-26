import { StyleSheet, Text, View } from 'react-native';
import Mascot from './Mascot';
import { colors } from '../../theme/theme';

// Mascot + "EyeMyHealth" wordmark. `tone="light"` is for brand-gradient
// backgrounds (white text); the default reads on light surfaces, with "Eye"
// picked out in the accent color.
export default function BrandLogo({ size = 40, tone = 'dark', showMascot = true }) {
  const onDark = tone === 'light';
  const fontSize = Math.round(size * 0.62);
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="EyeMyHealth">
      {showMascot && <Mascot size={size} badge={size >= 48} />}
      <Text style={[styles.word, { fontSize, color: onDark ? colors.onBrand : colors.textPrimary }]}>
        <Text style={{ color: onDark ? '#FFE27A' : colors.accent }}>Eye</Text>
        MyHealth
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  word: {
    fontWeight: '900',
    letterSpacing: -0.5,
  },
});
