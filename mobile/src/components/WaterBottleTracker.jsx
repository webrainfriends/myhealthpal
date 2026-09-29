import { useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { cardShadow, colors, radii, spacing } from '../theme/theme';

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

// Compact dashboard tile - sits beside ActivityCard and DietCard in a single
// row. Trades the old full-height animated bottle illustration for a thin
// progress bar so the card matches its neighbours' footprint, while keeping
// the quick +250ml log, undo, and target-refresh actions.
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

  return (
    <View style={[styles.card, cardShadow]}>
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>💧</Text>
        </View>
        {onRefreshTarget && (
          <TouchableOpacity onPress={onRefreshTarget} disabled={refreshingTarget} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.refreshIcon}>{refreshingTarget ? '…' : '↻'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.value} numberOfLines={1}>
        {totalMl}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {target ? `of ${target.max_ml}ml` : 'ml today'}
      </Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent * 100}%` }, isOver && styles.progressOver]} />
      </View>

      {alert && alert.status !== 'ok' && (
        <Text style={[styles.alertText, isOver ? styles.alertOver : styles.alertUnder]} numberOfLines={1}>
          {isOver ? 'Over target' : 'Under target'}
        </Text>
      )}

      <View style={styles.actionsRow}>
        <BounceButton onPress={onAdd} disabled={adding} style={styles.addButton}>
          {adding ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.addButtonText}>+250</Text>}
        </BounceButton>
        {canUndo && (
          <BounceButton onPress={onUndo} disabled={undoing} style={styles.undoButton}>
            {undoing ? <ActivityIndicator color={colors.textSecondary} size="small" /> : <Text style={styles.undoButtonText}>−</Text>}
          </BounceButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.lg,
    padding: spacing.sm,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
  },
  refreshIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.teal,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.teal,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  progressOver: {
    backgroundColor: colors.warning,
  },
  alertText: {
    fontSize: 10,
    fontWeight: '700',
  },
  alertUnder: {
    color: colors.primary,
  },
  alertOver: {
    color: colors.warning,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: 12,
  },
  undoButton: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 16,
    lineHeight: 18,
  },
  disabled: {
    opacity: 0.45,
  },
});
