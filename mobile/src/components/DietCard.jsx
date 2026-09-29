import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import GradientFill from './brand/GradientFill';
import { colors } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const DIET_IMAGE = require('../../assets/dashboard/diet-bowl.jpg');
// A light, mostly-transparent orange wash - just enough to tie the photo
// into the app's color system without hiding the bowl of fruit/veg it's a
// photo of.
const OVERLAY = ['rgba(255, 122, 61, 0)', 'rgba(196, 68, 16, 0.32)'];

const BADGE_SIZE = 68;

// The calorie count's own glossy 3D badge - a white rim + gradient-filled
// sphere (the same layered-circle technique as the app mascot's heartbeat
// badge) so the number reads as a raised object sitting on the photo,
// rather than flat text stamped over it.
function CalorieBadgeArt() {
  return (
    <Svg width={BADGE_SIZE} height={BADGE_SIZE} viewBox="0 0 68 68">
      <Defs>
        <RadialGradient id="calGrad" cx="0.35" cy="0.3" r="0.75">
          <Stop offset="0" stopColor="#FFD27A" />
          <Stop offset="1" stopColor="#FF6A3D" />
        </RadialGradient>
      </Defs>
      <Circle cx="34" cy="34" r="33" fill="#FFFFFF" />
      <Circle cx="34" cy="34" r="29" fill="url(#calGrad)" />
      <Ellipse cx="24" cy="22" rx="11" ry="6.5" fill="#FFFFFF" opacity="0.35" transform="rotate(-25 24 22)" />
    </Svg>
  );
}

// Dashboard tile - a real photo fills the card (an actual "HQ background
// image" rather than an icon or illustration), lightly tinted so the bowl
// of fruit/veg it shows stays clearly visible. The calorie count sits in
// its own glossy 3D badge over the photo instead of as flat overlay text,
// with a pending-review count as a small dot on that badge. Still just a
// teaser - full detail lives on the Diet screen itself.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={DIET_IMAGE} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <GradientFill colors={OVERLAY} angle="vertical" />

      <View style={styles.badgeAnchor}>
        <View style={styles.badgeWrap}>
          <CalorieBadgeArt />
          <View style={styles.badgeCenter} pointerEvents="none">
            <Text style={styles.badgeValue} numberOfLines={1}>
              {hasData ? Math.round(today.calories) : '—'}
            </Text>
            <Text style={styles.badgeUnit} numberOfLines={1}>
              {t('diet.calSuffix').trim()}
            </Text>
          </View>
        </View>
        {pendingReviewCount > 0 && (
          <View style={styles.reviewDot}>
            <Text style={styles.reviewDotText} numberOfLines={1}>
              {pendingReviewCount}
            </Text>
          </View>
        )}
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
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 10,
  },
  badgeAnchor: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
  },
  badgeWrap: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    shadowColor: '#4B2BD6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  badgeCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  badgeUnit: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  reviewDot: {
    position: 'absolute',
    top: -4,
    right: -4,
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
