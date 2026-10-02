import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientFill from './brand/GradientFill';
import { colors } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const DIET_IMAGE = require('../../assets/dashboard/diet-bowl.jpg');
// Dark-to-clear scrim from the bottom so the white title/value stay legible
// on any photo while the bowl at the top remains fully visible.
const SCRIM = ['rgba(60, 20, 0, 0)', 'rgba(60, 20, 0, 0.7)'];

// Dashboard tile - photo background, a frosted title chip (so the card name
// is always readable), and the calorie count at the bottom with a
// pending-review badge. Full detail lives on the Diet screen.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.88}>
      <Image source={DIET_IMAGE} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <GradientFill colors={SCRIM} angle="vertical" />

      <View style={styles.topRow}>
        <View style={styles.titleChip}>
          <Text style={styles.titleText} numberOfLines={1}>
            {t('diet.title')}
          </Text>
        </View>
        {pendingReviewCount > 0 && (
          <View style={styles.reviewDot}>
            <Text style={styles.reviewDotText} numberOfLines={1}>
              {pendingReviewCount}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.bottom}>
        <Text style={styles.value} numberOfLines={1}>
          {hasData ? Math.round(today.calories) : '—'}
        </Text>
        <Text style={styles.unit} numberOfLines={1}>
          {t('diet.calSuffix').trim()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 140,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'space-between',
    padding: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleChip: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  titleText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: '#C44410',
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  reviewDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  reviewDotText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
