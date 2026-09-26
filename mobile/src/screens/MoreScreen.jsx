import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

function MoreRow({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={[styles.row, cardShadow]} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.icon}>{icon}</Text>
      <View style={styles.rowText}>
        <Text style={typography.body}>{title}</Text>
        <Text style={typography.caption}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function MoreScreen({ navigation }) {
  const t = useT();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.title, styles.title]}>{t('nav.more')}</Text>
        <MoreRow
          icon="👪"
          title={t('family.title')}
          subtitle={t('family.moreSubtitle')}
          onPress={() => navigation.navigate('Family')}
        />
        <MoreRow
          icon="📅"
          title={t('retest.radarTitle')}
          subtitle={t('retest.moreSubtitle')}
          onPress={() => navigation.navigate('RetestRadar')}
        />
        <MoreRow
          icon="🗂️"
          title={t('nav.timeline')}
          subtitle="Every report you've uploaded, newest first"
          onPress={() => navigation.navigate('Timeline')}
        />
        <MoreRow
          icon="🍳"
          title="AI recipe ideas"
          subtitle="Browse a personalized, auto-generated recipe feed"
          onPress={() => navigation.navigate('Recipes')}
        />
        <MoreRow
          icon="⚙️"
          title={t('nav.settings')}
          subtitle="Recipe preferences, connected sources, language, voice"
          onPress={() => navigation.navigate('Settings')}
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
  title: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  icon: {
    fontSize: 22,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
});
