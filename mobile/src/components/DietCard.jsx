import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientFill from './brand/GradientFill';
import { colors } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const DIET_IMAGE = require('../../assets/dashboard/diet-bowl.jpg');
// Transparent at the top (so the photo reads clearly) fading into an orange
// tint at the bottom - keeps the calorie total legible without hiding the
// photo behind a flat color block.
const OVERLAY = ['rgba(255, 122, 61, 0)', 'rgba(196, 68, 16, 0.88)'];

// Dashboard tile - a real photo fills the card (an actual "HQ background
// image" rather than an icon or illustration), tinted with the app's warm
// diet color so the card still reads as part of the same system. Still just
// a teaser (today's calorie total + a pending-review badge); full detail
// lives on the Diet screen itself.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={DIET_IMAGE} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <GradientFill colors={OVERLAY} angle="vertical" />

      {pendingReviewCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {pendingReviewCount}
          </Text>
        </View>
      )}

      <View style={styles.textBlock}>
        <Text style={styles.value} numberOfLines={1}>
          {hasData ? Math.round(today.calories) : '—'}
        </Text>
        <Text style={styles.label} numberOfLines={1}>
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
    justifyContent: 'flex-end',
    padding: 14,
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
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
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  textBlock: {
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
  },
});
