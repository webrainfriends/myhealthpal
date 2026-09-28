import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { alertSeverityColors, colors, radii, spacing, typography } from '../theme/theme';
import { addAllergy, addHeightEntry, addWeightEntry, fetchHealthProfile, removeAllergy } from '../api/client';
import { showAlert } from '../utils/alert';
import { useT } from '../i18n/I18nContext';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString();
}

// A stat row is only ever "first recorded" vs "current" once at least two
// entries exist - a single entry is both, so the "first recorded" line is
// skipped rather than repeating the same value/date twice.
function StatCard({ title, unit, current, firstRecorded, firstRecordedAt, latestRecordedAt, onAdd, busy, t }) {
  const [input, setInput] = useState('');

  async function handleAdd() {
    const num = Number(input);
    if (!input.trim() || !Number.isFinite(num) || num <= 0) return;
    await onAdd(num);
    setInput('');
  }

  return (
    <View style={[styles.card, styles.section]}>
      <Text style={typography.heading}>{title}</Text>
      {current != null ? (
        <>
          <Text style={styles.currentValue}>
            {current} {unit}
          </Text>
          <Text style={typography.caption}>
            {t('healthProfile.recorded', { date: formatDate(latestRecordedAt) })}
          </Text>
          {firstRecorded != null && firstRecorded !== current && (
            <Text style={typography.caption}>
              {t('healthProfile.firstRecorded', { value: firstRecorded, unit, date: formatDate(firstRecordedAt) })}
            </Text>
          )}
        </>
      ) : (
        <Text style={typography.bodySecondary}>{t('healthProfile.noEntryYet')}</Text>
      )}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.rowInput]}
          value={input}
          onChangeText={setInput}
          placeholder={t('healthProfile.addPlaceholder', { unit })}
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
        />
        <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={busy}>
          <Text style={styles.addButtonLabel}>{t('healthProfile.log')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BmiCard({ bmi, t }) {
  if (!bmi) {
    return (
      <View style={[styles.card, styles.section]}>
        <Text style={typography.heading}>{t('healthProfile.bmiTitle')}</Text>
        <Text style={typography.bodySecondary}>{t('healthProfile.bmiNeedsBoth')}</Text>
      </View>
    );
  }
  const palette = alertSeverityColors[bmi.category === 'normal' ? 'info' : 'attention'];
  return (
    <View style={[styles.card, styles.section]}>
      <Text style={typography.heading}>{t('healthProfile.bmiTitle')}</Text>
      <View style={[styles.bmiBadge, { backgroundColor: palette.bg }]}>
        <Text style={[styles.bmiValue, { color: palette.fg }]}>{bmi.value}</Text>
        <Text style={[typography.caption, { color: palette.fg }]}>{t(`healthProfile.bmiCategory.${bmi.category}`)}</Text>
      </View>
      <Text style={typography.caption}>{t('healthProfile.bmiDisclaimer')}</Text>
    </View>
  );
}

function AllergyCard({ allergies, onAdd, onRemove, busy, t }) {
  const [input, setInput] = useState('');

  async function handleAdd() {
    if (!input.trim()) return;
    await onAdd(input.trim());
    setInput('');
  }

  return (
    <View style={[styles.card, styles.section]}>
      <Text style={typography.heading}>{t('healthProfile.allergiesTitle')}</Text>
      {allergies.length === 0 ? (
        <Text style={typography.bodySecondary}>{t('healthProfile.noAllergiesYet')}</Text>
      ) : (
        <View style={styles.chipRow}>
          {allergies.map((a) => (
            <TouchableOpacity key={a.id} style={styles.chip} onPress={() => onRemove(a.id)} disabled={busy}>
              <Text style={styles.chipText}>{a.allergen} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.rowInput]}
          value={input}
          onChangeText={setInput}
          placeholder={t('healthProfile.allergyPlaceholder')}
          placeholderTextColor={colors.textTertiary}
        />
        <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={busy}>
          <Text style={styles.addButtonLabel}>{t('healthProfile.add')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function HealthProfileScreen() {
  const t = useT();
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await fetchHealthProfile());
    } catch (err) {
      showAlert(t('healthProfile.couldNotLoad'), err.message);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function withBusy(action) {
    setBusy(true);
    try {
      setProfile(await action());
    } catch (err) {
      showAlert(t('healthProfile.couldNotSave'), err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('healthProfile.loading')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>{t('healthProfile.intro')}</Text>

        <StatCard
          title={t('healthProfile.weightTitle')}
          unit="kg"
          current={profile.weight.currentKg}
          firstRecorded={profile.weight.firstRecordedKg}
          firstRecordedAt={profile.weight.firstRecordedAt}
          latestRecordedAt={profile.weight.latestRecordedAt}
          onAdd={(value) => withBusy(() => addWeightEntry(value))}
          busy={busy}
          t={t}
        />

        <StatCard
          title={t('healthProfile.heightTitle')}
          unit="cm"
          current={profile.height.currentCm}
          firstRecorded={profile.height.firstRecordedCm}
          firstRecordedAt={profile.height.firstRecordedAt}
          latestRecordedAt={profile.height.latestRecordedAt}
          onAdd={(value) => withBusy(() => addHeightEntry(value))}
          busy={busy}
          t={t}
        />

        <BmiCard bmi={profile.bmi} t={t} />

        <AllergyCard
          allergies={profile.allergies}
          onAdd={(allergen) => withBusy(() => addAllergy(allergen))}
          onRemove={(id) => withBusy(() => removeAllergy(id))}
          busy={busy}
          t={t}
        />

        <PrimaryButton title={t('healthProfile.refresh')} onPress={load} variant="secondary" />
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
    gap: spacing.lg,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  currentValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  rowInput: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  addButton: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  addButtonLabel: {
    color: colors.primary,
    fontWeight: '700',
  },
  bmiBadge: {
    alignSelf: 'flex-start',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  bmiValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 13,
  },
});
