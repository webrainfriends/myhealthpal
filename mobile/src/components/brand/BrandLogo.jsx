import { StyleSheet, Text, View } from 'react-native';
import Mascot from './Mascot';
import { colors } from '../../theme/theme';

// Mascot + "MyHealthPal" wordmark. `tone="light"` is for brand-gradient
// backgrounds (white text); the default reads on light surfaces, with "Pal"
// picked out in the accent color.
export default function BrandLogo({ size = 40, tone = 'dark', showMascot = true }) {
  const onDark = tone === 'light';
  const fontSize = Math.round(size * 0.62);
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="MyHealthPal">
      {showMascot && <Mascot size={size} badge={size >= 48} />}
      <Text style={[styles.word, { fontSize, color: onDark ? colors.onBrand : colors.textPrimary }]}>
        MyHealth
        <Text style={{ color: onDark ? '#FFE27A' : colors.accent }}>Pal</Text>
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
