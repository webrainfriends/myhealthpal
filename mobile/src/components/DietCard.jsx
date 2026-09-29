import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import GradientFill from './brand/GradientFill';
import { colors, gradients } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

// A bigger gradient "bowl of food" illustration - drawn as vector art (so it
// stays crisp at any size, in the same style as the mascot and water
// bottle) rather than a flat emoji or a small badge icon.
function BowlIcon() {
  return (
    <Svg width={44} height={44} viewBox="0 0 36 36">
      <Defs>
        <RadialGradient id="foodGrad" cx="0.35" cy="0.3" r="0.75">
          <Stop offset="0" stopColor="#FFF3C4" />
          <Stop offset="1" stopColor="#FFB25C" />
        </RadialGradient>
      </Defs>
      <Circle cx="18" cy="18" r="16" fill="rgba(255, 255, 255, 0.9)" />
      <Circle cx="18" cy="18" r="10.5" fill="url(#foodGrad)" />
      <Circle cx="14" cy="14.5" r="1.7" fill={colors.success} />
      <Circle cx="21.5" cy="13.5" r="1.4" fill={colors.accent} />
      <Circle cx="18" cy="21.5" r="1.5" fill={colors.danger} />
    </Svg>
  );
}

// Dashboard tile - a vibrant gradient "hero" card (matching ActivityCard and
// the water bottle's illustrated style) rather than a flat tinted
// rectangle. Still just a teaser (today's calorie total + a pending-review
// badge); full detail lives on the Diet screen itself.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <GradientFill colors={gradients.sunrise} />
      <View style={[styles.bubble, styles.bubbleOne]} />
      <View style={[styles.bubble, styles.bubbleTwo]} />

      <View style={styles.iconWrap}>
        <BowlIcon />
        {pendingReviewCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {pendingReviewCount}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {hasData ? Math.round(today.calories) : '—'}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {t('diet.calSuffix').trim()}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 132,
    borderRadius: 24,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  bubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  bubbleOne: { width: 70, height: 70, top: -26, left: -22 },
  bubbleTwo: { width: 46, height: 46, bottom: -18, right: -14 },
  iconWrap: {
    marginBottom: 2,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
  },
});
