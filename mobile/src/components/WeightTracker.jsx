import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { alertSeverityColors, colors, radii, spacing, typography } from '../theme/theme';
import { addWeightEntry, deleteWeightEntry, fetchWeightHistory } from '../api/client';
import { showAlert } from '../utils/alert';
import { useT } from '../i18n/I18nContext';

const RANGES = [7, 30, 90, 365];
const CHART_W = 320;
const CHART_H = 160;
const PAD = { left: 36, right: 10, top: 10, bottom: 22 };

function shortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function signed(value) {
  if (value == null) return '–';
  return `${value > 0 ? '+' : ''}${value}`;
}

function WeightChart({ entries, healthyRange }) {
  if (entries.length === 0) return null;
  const values = entries.map((e) => e.weightKg);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (healthyRange) {
    lo = Math.min(lo, healthyRange.min);
    hi = Math.max(hi, healthyRange.max);
  }
  const span = hi - lo || 1;
  lo -= span * 0.1;
  hi += span * 0.1;
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const times = entries.map((e) => new Date(e.recordedAt).getTime());
  const t0 = times[0];
  const tSpan = times[times.length - 1] - t0 || 1;
  const x = (i) => PAD.left + (entries.length === 1 ? innerW / 2 : ((times[i] - t0) / tSpan) * innerW);
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const points = entries.map((e, i) => `${x(i)},${y(e.weightKg)}`).join(' ');
  const ticks = [hi, (hi + lo) / 2, lo];

  return (
    <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
      {healthyRange && (
        <Rect
          x={PAD.left}
          y={y(Math.min(healthyRange.max, hi))}
          width={innerW}
          height={Math.max(0, y(Math.max(healthyRange.min, lo)) - y(Math.min(healthyRange.max, hi)))}
          fill={colors.successMuted}
        />
      )}
      {ticks.map((tick) => (
        <G key={tick}>
          <Line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(tick)} y2={y(tick)} stroke={colors.border} strokeWidth={1} />
          <SvgText x={PAD.left - 4} y={y(tick) + 3} fontSize={9} fill={colors.textTertiary} textAnchor="end">
            {tick.toFixed(1)}
          </SvgText>
        </G>
      ))}
      {entries.length > 1 && <Polyline points={points} fill="none" stroke={colors.primary} strokeWidth={2.5} />}
      {entries.map((e, i) => (
        <Circle key={e.id} cx={x(i)} cy={y(e.weightKg)} r={3.5} fill={colors.primary} />
      ))}
      <SvgText x={PAD.left} y={CHART_H - 6} fontSize={9} fill={colors.textTertiary}>
        {shortDate(entries[0].recordedAt)}
      </SvgText>
      {entries.length > 1 && (
        <SvgText x={CHART_W - PAD.right} y={CHART_H - 6} fontSize={9} fill={colors.textTertiary} textAnchor="end">
          {shortDate(entries[entries.length - 1].recordedAt)}
        </SvgText>
      )}
    </Svg>
  );
}

function Stat({ label, value, tone }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={typography.caption}>{label}</Text>
    </View>
  );
}

// Daily weight log: quick entry, range-switchable trend chart, summary
// stats and BMI, plus the recent daily readings (tap ✕ to delete one).
export default function WeightTracker({ refreshKey, onChanged }) {
  const t = useT();
  const [days, setDays] = useState(30);
  const [history, setHistory] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setHistory(await fetchWeightHistory(days));
    } catch (err) {
      showAlert(t('healthProfile.couldNotLoad'), err.message);
    }
  }, [days, t]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleLog() {
    const num = Number(input);
    if (!input.trim() || !Number.isFinite(num) || num <= 0 || num >= 500) return;
    setBusy(true);
    try {
      await addWeightEntry(num);
      setInput('');
      await load();
      onChanged?.();
    } catch (err) {
      showAlert(t('healthProfile.couldNotSave'), err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    setBusy(true);
    try {
      await deleteWeightEntry(id);
      await load();
      onChanged?.();
    } catch (err) {
      showAlert(t('healthProfile.couldNotSave'), err.message);
    } finally {
      setBusy(false);
    }
  }

  const stats = history?.stats;
  const entries = history?.entries || [];
  const bmiPalette = stats?.bmi ? alertSeverityColors[stats.bmi.category === 'normal' ? 'info' : 'attention'] : null;
  // Losing weight is shown green, gaining amber - a neutral general cue only.
  const changeTone = stats ? (stats.changeKg < 0 ? colors.success : stats.changeKg > 0 ? colors.warning : undefined) : undefined;

  return (
    <View style={[styles.card, styles.section]}>
      <Text style={typography.heading}>{t('healthProfile.weightTitle')}</Text>
      {stats ? (
        <Text style={styles.currentValue}>{stats.latestKg} kg</Text>
      ) : (
        <Text style={typography.bodySecondary}>{t('healthProfile.noEntryYet')}</Text>
      )}

      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.rowInput]}
          value={input}
          onChangeText={setInput}
          placeholder={t('healthProfile.addPlaceholder', { unit: 'kg' })}
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
        />
        <TouchableOpacity style={styles.addButton} onPress={handleLog} disabled={busy}>
          <Text style={styles.addButtonLabel}>{t('healthProfile.log')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity key={r} style={[styles.rangeChip, days === r && styles.rangeChipActive]} onPress={() => setDays(r)}>
            <Text style={[styles.rangeText, days === r && styles.rangeTextActive]}>
              {r === 365 ? '1y' : `${r}d`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {entries.length > 0 ? (
        <>
          <WeightChart entries={entries} healthyRange={stats.healthyRangeKg} />
          {stats.healthyRangeKg && (
            <Text style={typography.caption}>
              {t('healthProfile.healthyRange', { min: stats.healthyRangeKg.min, max: stats.healthyRangeKg.max })}
            </Text>
          )}
          <View style={styles.statGrid}>
            <Stat label={t('healthProfile.statChange')} value={`${signed(stats.changeKg)} kg`} tone={changeTone} />
            <Stat label={t('healthProfile.statSinceLast')} value={`${signed(stats.previousChangeKg)} kg`} />
            <Stat label={t('healthProfile.statAverage')} value={`${stats.averageKg} kg`} />
            <Stat label={t('healthProfile.statLowest')} value={`${stats.lowestKg} kg`} />
            <Stat label={t('healthProfile.statHighest')} value={`${stats.highestKg} kg`} />
            <Stat label={t('healthProfile.statDays')} value={String(stats.entryCount)} />
          </View>
          {stats.bmi ? (
            <View style={[styles.bmiBadge, { backgroundColor: bmiPalette.bg }]}>
              <Text style={[styles.bmiValue, { color: bmiPalette.fg }]}>BMI {stats.bmi.value}</Text>
              <Text style={[typography.caption, { color: bmiPalette.fg }]}>
                {t(`healthProfile.bmiCategory.${stats.bmi.category}`)}
              </Text>
            </View>
          ) : (
            <Text style={typography.bodySecondary}>{t('healthProfile.bmiNeedsBoth')}</Text>
          )}

          <Text style={[typography.heading, styles.historyTitle]}>{t('healthProfile.history')}</Text>
          {[...entries].reverse().slice(0, 14).map((e) => (
            <View key={e.id} style={styles.historyRow}>
              <Text style={typography.body}>{new Date(e.recordedAt).toLocaleDateString()}</Text>
              <Text style={styles.historyValue}>
                {e.weightKg} kg{e.bmi != null ? ` · BMI ${e.bmi}` : ''}
              </Text>
              <TouchableOpacity onPress={() => handleDelete(e.id)} disabled={busy} hitSlop={8}>
                <Text style={styles.deleteText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : (
        history && <Text style={typography.bodySecondary}>{t('healthProfile.noEntriesInRange')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md },
  section: { marginTop: spacing.md, gap: spacing.sm },
  currentValue: { fontSize: 32, fontWeight: '800', color: colors.primary },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  rowInput: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  addButton: { backgroundColor: colors.primary, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 12 },
  addButtonLabel: { color: '#fff', fontWeight: '700' },
  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.primaryMuted },
  rangeChipActive: { backgroundColor: colors.primary },
  rangeText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  rangeTextActive: { color: '#fff' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  stat: { width: '33.33%' },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  bmiBadge: { borderRadius: radii.md, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bmiValue: { fontSize: 18, fontWeight: '800' },
  historyTitle: { marginTop: spacing.sm },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  historyValue: { fontWeight: '700', color: colors.textPrimary },
  deleteText: { color: colors.textTertiary, fontSize: 16 },
});
