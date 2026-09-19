import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';

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
      activeOpacity={0.8}
    >
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
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '600',
  },
  primaryLabel: {
    color: colors.surface,
  },
  secondaryLabel: {
    color: colors.primary,
  },
});
