import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';

function SettingsRow({ title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={[styles.row, cardShadow]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowText}>
        <Text style={typography.body}>{title}</Text>
        <Text style={typography.caption}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsRow
          title="Recipe recommendations"
          subtitle="Diet and cuisine preferences used to suggest recipes"
          onPress={() => navigation.navigate('RecipePreferences')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  rowText: {
    gap: 2,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
});
