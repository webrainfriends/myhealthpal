import { Component } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

// A functional wrapper so the fallback UI can call useT() - the boundary
// itself must stay a class component (getDerivedStateFromError/
// componentDidCatch have no hook equivalent).
function ErrorFallback({ onRetry }) {
  const t = useT();
  return (
    <SafeAreaView style={styles.container}>
      <Text style={typography.heading}>{t('errorBoundary.title')}</Text>
      <Text style={[typography.bodySecondary, styles.message]}>{t('errorBoundary.message')}</Text>
      <TouchableOpacity style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonLabel}>{t('errorBoundary.tryAgain')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// A single bad record (e.g. an unexpected shape from a newly uploaded
// report) must not take down the whole app - without this, any render
// exception anywhere below unmounts everything and drops back to a blank
// screen, which reads to the person as "the app crashed and logged me out".
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error', error, info);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  message: {
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  buttonLabel: {
    color: colors.surface,
    fontWeight: '600',
  },
});
