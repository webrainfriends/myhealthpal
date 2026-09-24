import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import GradientFill from './brand/GradientFill';
import { brandShadow, colors, radii, spacing, typography } from '../theme/theme';

export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary' }) {
  const isSecondary = variant === 'secondary';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary ? styles.secondary : styles.primary,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      {!isSecondary && <GradientFill angle="horizontal" />}
      {loading ? (
        <ActivityIndicator color={isSecondary ? colors.primary : colors.surface} />
      ) : (
        <Text style={[typography.body, styles.label, isSecondary ? styles.secondaryLabel : styles.primaryLabel]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  primary: {
    backgroundColor: colors.primary,
    ...brandShadow,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '700',
  },
  primaryLabel: {
    color: colors.surface,
  },
  secondaryLabel: {
    color: colors.primary,
  },
});
