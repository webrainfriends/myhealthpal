import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchConsents, setConsent } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';

// Privacy & AI Processing (issue #104 §4): a short, plain-language trust
// panel plus three separate choices - never one bundled checkbox. Opened
// from Settings, and automatically before a first upload.
const TRUST_POINTS = ['encrypted', 'access', 'purpose', 'aiProvider', 'notDiagnosis', 'deletion'];
const CHOICES = [
  { type: 'medical_record_storage', icon: '🔒' },
  { type: 'ai_document_processing', icon: '📄' },
  { type: 'ai_health_insights', icon: '💡' },
];

function TrustPoint({ id, t }) {
  return (
    <View style={styles.point}>
      <Text style={styles.pointIcon}>{t(`privacy.points.${id}.icon`)}</Text>
      <View style={styles.pointText}>
        <Text style={typography.body}>{t(`privacy.points.${id}.title`)}</Text>
        <Text style={typography.caption}>{t(`privacy.points.${id}.detail`)}</Text>
      </View>
    </View>
  );
}

export default function PrivacyConsentScreen({ navigation, route }) {
  const t = useT();
  const { activeProfile } = useAuth();
  const reason = route.params?.reason || null;
  const [state, setState] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await fetchConsents());
    } catch (err) {
      showAlert(t('privacy.couldNotLoad'), err.message);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const granted = (type) => Boolean(state?.consents.find((c) => c.type === type)?.granted);

  async function toggle(type, next) {
    setSaving(type);
    try {
      setState(await setConsent(type, next));
    } catch (err) {
      showAlert(t('privacy.couldNotSave'), err.message);
    } finally {
      setSaving(null);
    }
  }

  // "Agree and continue" from an upload that was refused: grants storage
  // (plus whatever AI choices are already on) and returns to try again.
  async function agreeAndContinue() {
    if (!granted('medical_record_storage')) await toggle('medical_record_storage', true);
    navigation.goBack();
  }

  const who = activeProfile ? activeProfile.displayName : null;
  const canEdit = state?.canEdit !== false;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {reason === 'consent_required' && (
          <View style={[styles.banner, styles.bannerAction]}>
            <Text style={typography.body}>{t('privacy.uploadNeedsConsent')}</Text>
          </View>
        )}
        {reason === 'ai_consent_required' && (
          <View style={[styles.banner, styles.bannerAction]}>
            <Text style={typography.body}>{t('privacy.aiNeedsConsent')}</Text>
          </View>
        )}
        {who && (
          <View style={styles.banner}>
            <Text style={typography.bodySecondary}>
              {canEdit ? t('privacy.decidingFor', { name: who }) : t('privacy.cannotDecideFor', { name: who })}
            </Text>
          </View>
        )}

        <Text style={typography.bodySecondary}>{t('privacy.intro')}</Text>
        <View style={[styles.card, cardShadow]}>
          {TRUST_POINTS.map((id) => (
            <TrustPoint key={id} id={id} t={t} />
          ))}
        </View>

        <Text style={[typography.heading, styles.sectionTitle]}>{t('privacy.choicesTitle')}</Text>
        {CHOICES.map(({ type, icon }) => (
          <View key={type} style={[styles.card, cardShadow, styles.choice]}>
            <Text style={styles.pointIcon}>{icon}</Text>
            <View style={styles.pointText}>
              <Text style={typography.body}>
                {t(`privacy.choices.${type}.title`)}
                {type === 'medical_record_storage' ? ` · ${t('privacy.required')}` : ` · ${t('privacy.optional')}`}
              </Text>
              <Text style={typography.caption}>{t(`privacy.choices.${type}.detail`)}</Text>
            </View>
            <Switch
              value={granted(type)}
              disabled={!state || !canEdit || saving === type}
              onValueChange={(next) => toggle(type, next)}
              trackColor={{ true: colors.primary }}
              accessibilityLabel={t(`privacy.choices.${type}.title`)}
            />
          </View>
        ))}

        <Text style={[typography.caption, styles.footnote]}>{t('privacy.revokeNote')}</Text>
        <Text style={[typography.caption, styles.footnote]}>{t('privacy.complianceNote')}</Text>

        {reason === 'consent_required' && canEdit && (
          <PrimaryButton title={t('privacy.agreeAndContinue')} onPress={agreeAndContinue} loading={saving === 'medical_record_storage'} />
        )}
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
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  banner: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bannerAction: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  point: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  pointIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  pointText: {
    flex: 1,
    gap: 2,
  },
  sectionTitle: {
    marginTop: spacing.md,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footnote: {
    marginTop: spacing.xs,
  },
});
