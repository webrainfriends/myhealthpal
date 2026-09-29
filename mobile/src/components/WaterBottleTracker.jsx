import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import { brandShadow, cardShadow, colors, radii, spacing, typography } from '../theme/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Pixel geometry of the bottle body inside the 120x210 viewBox - shared by
// the clip path, the animated water fill, and the min/max/ideal target
// lines so they all line up against the same "how full is the bottle" scale.
const BODY_X = 10;
const BODY_WIDTH = 100;
const BODY_TOP = 40;
const BODY_BOTTOM = 190;
const BODY_HEIGHT = BODY_BOTTOM - BODY_TOP;
const BODY_RADIUS = 26;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Presses that bounce in on touch and spring back on release - the "3D
// button" feel the flat TouchableOpacity buttons elsewhere don't have.
function BounceButton({ onPress, disabled, style, children }) {
  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    if (disabled) return;
    Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }
  function pressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  }

  return (
    <TouchableWithoutFeedback onPress={disabled ? undefined : onPress} onPressIn={pressIn} onPressOut={pressOut}>
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && styles.disabled]}>{children}</Animated.View>
    </TouchableWithoutFeedback>
  );
}

// A glossy, semi-3D water bottle: an animated liquid fill (react-native-svg
// clipped to the bottle silhouette) rising toward a dashed "ideal" target
// line, with a shaded band across the healthy min-max range. Sits in a card
// with one big +250ml CTA and a small undo button for the last log.
export default function WaterBottleTracker({
  totalMl = 0,
  target,
  alert,
  onAdd,
  onUndo,
  onRefreshTarget,
  adding = false,
  undoing = false,
  refreshingTarget = false,
  canUndo = false,
}) {
  const capacityMl = target?.max_ml || target?.ideal_ml || 3000;
  const percent = clamp(totalMl / capacityMl, 0, 1);
  const isOver = target && totalMl > target.max_ml;

  const fillAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fillAnim, { toValue: percent, duration: 650, useNativeDriver: false }).start();
  }, [percent, fillAnim]);

  const animatedHeight = fillAnim.interpolate({ inputRange: [0, 1], outputRange: [0, BODY_HEIGHT] });
  const animatedY = fillAnim.interpolate({ inputRange: [0, 1], outputRange: [BODY_BOTTOM, BODY_TOP] });

  function yFor(ml) {
    return BODY_BOTTOM - clamp(ml / capacityMl, 0, 1) * BODY_HEIGHT;
  }
  const idealY = target ? yFor(target.ideal_ml) : null;
  const bandTop = target ? yFor(target.max_ml) : null;
  const bandBottom = target ? yFor(target.min_ml) : null;

  return (
    <View style={[styles.card, cardShadow]}>
      <View style={styles.headerRow}>
        <Text style={typography.heading}>Water intake</Text>
        {onRefreshTarget && (
          <TouchableOpacity onPress={onRefreshTarget} disabled={refreshingTarget} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.refreshLabel}>{refreshingTarget ? 'Refreshing…' : 'Refresh target ↻'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.body}>
        <Svg width={100} height={175} viewBox="0 0 120 210">
          <Defs>
            <LinearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#8FE3FF" />
              <Stop offset="0.2" stopColor="#4F9BFF" />
              <Stop offset="1" stopColor="#2A5FE0" />
            </LinearGradient>
            <LinearGradient id="glassTint" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.08" />
            </LinearGradient>
            <LinearGradient id="capGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.accent} />
              <Stop offset="1" stopColor={colors.primary} />
            </LinearGradient>
            <ClipPath id="bottleClip">
              <Rect x={BODY_X} y={BODY_TOP} width={BODY_WIDTH} height={BODY_HEIGHT} rx={BODY_RADIUS} />
            </ClipPath>
          </Defs>

          <Ellipse cx="60" cy="204" rx="36" ry="6" fill="#2A1466" opacity="0.12" />

          {/* cap + neck */}
          <Rect x="44" y="4" width="32" height="16" rx="6" fill="url(#capGrad)" />
          <Rect x="47" y="18" width="26" height="20" fill="url(#glassTint)" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />

          {/* glass base */}
          <Rect x={BODY_X} y={BODY_TOP} width={BODY_WIDTH} height={BODY_HEIGHT} rx={BODY_RADIUS} fill="url(#glassTint)" />

          {/* healthy min-max band */}
          {bandTop != null && (
            <Rect x={BODY_X + 4} y={bandTop} width={BODY_WIDTH - 8} height={Math.max(bandBottom - bandTop, 0)} rx="8" fill={colors.successMuted} opacity="0.55" />
          )}

          {/* animated liquid, clipped to the bottle silhouette */}
          <G clipPath="url(#bottleClip)">
            <AnimatedRect x={BODY_X} width={BODY_WIDTH} y={animatedY} height={animatedHeight} fill="url(#waterFill)" />
            <AnimatedRect x={BODY_X} width={BODY_WIDTH} y={animatedY} height="4" fill="#FFFFFF" opacity="0.45" />
          </G>

          {/* ideal-target dashed line */}
          {idealY != null && (
            <Line x1={BODY_X - 2} x2={BODY_X + BODY_WIDTH + 2} y1={idealY} y2={idealY} stroke={colors.primary} strokeWidth="1.5" strokeDasharray="4 3" />
          )}

          {/* crisp glass outline */}
          <Rect x={BODY_X} y={BODY_TOP} width={BODY_WIDTH} height={BODY_HEIGHT} rx={BODY_RADIUS} fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="2" />

          {/* glossy reflection streak */}
          <Rect x={BODY_X + 10} y={BODY_TOP + 8} width="12" height={BODY_HEIGHT - 20} rx="6" fill="#FFFFFF" opacity="0.25" transform={`rotate(6 ${BODY_X + 16} ${BODY_TOP + BODY_HEIGHT / 2})`} />
        </Svg>

        <View style={styles.details}>
          <Text style={styles.totalValue}>
            {totalMl} <Text style={styles.totalUnit}>ml today</Text>
          </Text>
          {target && (
            <Text style={typography.caption}>
              Target: {target.min_ml}-{target.max_ml}ml (ideal {target.ideal_ml}ml)
            </Text>
          )}
          {alert && alert.status !== 'ok' && (
            <View style={[styles.alertPill, isOver ? styles.alertOver : styles.alertUnder]}>
              <Text style={styles.alertText} numberOfLines={2}>
                {isOver ? '⚠️' : 'ℹ️'} {alert.message}
              </Text>
            </View>
          )}

          <View style={styles.actionsRow}>
            <BounceButton onPress={onAdd} disabled={adding} style={styles.addButton}>
              {adding ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.addButtonText}>💧 +250ml</Text>
              )}
            </BounceButton>

            <BounceButton onPress={onUndo} disabled={!canUndo || undoing} style={styles.undoButton}>
              {undoing ? <ActivityIndicator color={colors.textSecondary} size="small" /> : <Text style={styles.undoButtonText}>−</Text>}
            </BounceButton>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refreshLabel: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 12,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  details: {
    flex: 1,
    gap: spacing.xs,
  },
  totalValue: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalUnit: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  alertPill: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  alertUnder: {
    backgroundColor: colors.primaryMuted,
  },
  alertOver: {
    backgroundColor: colors.warningMuted,
  },
  alertText: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...brandShadow,
  },
  addButtonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 14,
  },
  undoButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 20,
  },
  disabled: {
    opacity: 0.45,
  },
});
