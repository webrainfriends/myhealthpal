import { StyleSheet, Text, View } from 'react-native';
import { card3D, colors, radii, spacing, typography } from '../theme/theme';

const CHART_HEIGHT = 150;
const WATER = '#1E90FF';
const WATER_LIGHT = '#E6F2FF';

// Pure stats over gap-filled daily rows ({ date, totalMl }) and the person's
// min/ideal/max target - exported so the numbers can be tested without UI.
export function computeWaterStats(days, target) {
  const logged = days.filter((d) => d.totalMl > 0);
  const total = logged.reduce((s, d) => s + d.totalMl, 0);
  const min = target?.min_ml ?? 0;
  const goalDays = min > 0 ? days.filter((d) => d.totalMl >= min).length : 0;
  const best = logged.reduce((b, d) => (d.totalMl > (b?.totalMl ?? 0) ? d : b), null);

  // Streak of consecutive goal days ending today - or yesterday, so a day
  // that isn't finished yet doesn't zero a streak that is still alive.
  let streak = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].totalMl < min) i -= 1;
  for (; i >= 0 && min > 0 && days[i].totalMl >= min; i -= 1) streak += 1;

  return {
    today: days.length ? days[days.length - 1].totalMl : 0,
    average: logged.length ? Math.round(total / logged.length) : 0,
    total,
    best,
    goalDays,
    loggedDays: logged.length,
    streak,
  };
}

const litres = (ml) => `${(ml / 1000).toFixed(ml >= 10000 ? 0 : 1)} L`;
const shortDate = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

// ~5 evenly spaced dates (always including the first and last day), laid out
// with space-between so no label is ever squeezed into a single bar's width.
function axisLabels(days) {
  if (days.length <= 5) return days;
  const picks = new Set([0, days.length - 1]);
  for (let k = 1; k < 4; k += 1) picks.add(Math.round((k * (days.length - 1)) / 4));
  return [...picks].sort((x, y) => x - y).map((i) => days[i]);
}

function barColor(ml, target) {
  if (!target) return WATER;
  if (ml <= 0) return colors.border;
  if (ml < target.min_ml) return colors.warning;
  if (ml > target.max_ml) return colors.danger;
  return WATER;
}

function Tile({ label, value, sub, tint, edge }) {
  return (
    <View style={[styles.tile, { backgroundColor: tint }, card3D(edge)]}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={typography.caption}>{sub}</Text> : null}
    </View>
  );
}

// Daily water-intake bar chart (bars coloured by whether the day reached the
// person's minimum / stayed under the maximum, with a dashed ideal line) and
// the stat tiles around it.
export default function WaterIntakeSection({ days = [], target, title = 'Water intake' }) {
  const stats = computeWaterStats(days, target);
  const scaleMax = Math.max(target?.max_ml ?? 0, ...days.map((d) => d.totalMl), 1000) * 1.05;
  const y = (ml) => (ml / scaleMax) * CHART_HEIGHT;
  const dense = days.length > 14;

  return (
    <View>
      <Text style={[typography.heading, styles.heading]}>{title}</Text>

      <View style={styles.tileRow}>
        <Tile label="Today" value={litres(stats.today)} sub={target ? `of ${litres(target.ideal_ml)} goal` : null} tint={WATER_LIGHT} edge={WATER} />
        <Tile label="Daily average" value={stats.loggedDays ? litres(stats.average) : '–'} sub={target && stats.loggedDays ? `${Math.round((stats.average / target.ideal_ml) * 100)}% of goal` : null} tint={colors.tealMuted} edge={colors.teal} />
      </View>

      <View style={[styles.chartCard, card3D(WATER)]}>
        <View style={[styles.plot, { height: CHART_HEIGHT }]}>
          {target && (
            <>
              <View style={[styles.band, { bottom: y(target.min_ml), height: Math.max(y(target.max_ml) - y(target.min_ml), 0) }]} />
              <View style={[styles.idealLine, { bottom: y(target.ideal_ml) }]} />
            </>
          )}
          <View style={styles.bars}>
            {days.map((d, i) => (
              <View key={d.date} style={styles.barCol}>
                <View
                  accessibilityLabel={`${d.date}: ${d.totalMl} millilitres`}
                  style={[styles.bar, { height: Math.max(d.totalMl > 0 ? y(d.totalMl) : 3, 3), backgroundColor: barColor(d.totalMl, target), maxWidth: dense ? 10 : 22 }]}
                />
              </View>
            ))}
          </View>
        </View>
        <View style={styles.labels}>
          {axisLabels(days).map((d) => (
            <Text key={d.date} style={styles.label}>{shortDate(d.date)}</Text>
          ))}
        </View>
        <View style={styles.legend}>
          <Text style={styles.legendItem}><Text style={{ color: WATER }}>■</Text> In range</Text>
          <Text style={styles.legendItem}><Text style={{ color: colors.warning }}>■</Text> Under min</Text>
          <Text style={styles.legendItem}><Text style={{ color: colors.danger }}>■</Text> Over max</Text>
          <Text style={styles.legendItem}>┄ Ideal {target ? litres(target.ideal_ml) : ''}</Text>
        </View>
      </View>

      <View style={styles.tileRow}>
        <Tile label="Goal days" value={`${stats.goalDays}/${days.length}`} sub="reached your minimum" tint={colors.successMuted} edge={colors.success} />
        <Tile label="Current streak" value={`${stats.streak} day${stats.streak === 1 ? '' : 's'}`} sub="in a row" tint={colors.warningMuted} edge={colors.warning} />
      </View>
      <View style={styles.tileRow}>
        <Tile label="Best day" value={stats.best ? litres(stats.best.totalMl) : '–'} sub={stats.best ? shortDate(stats.best.date) : null} tint={colors.accentMuted} edge={colors.accent} />
        <Tile label="Total" value={litres(stats.total)} sub={`over ${stats.loggedDays} logged day${stats.loggedDays === 1 ? '' : 's'}`} tint={colors.primaryMuted} edge={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: spacing.lg, marginBottom: spacing.sm },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  tile: { flex: 1, borderRadius: radii.lg, padding: spacing.md, gap: 2 },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  tileLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  chartCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  plot: { justifyContent: 'flex-end' },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: WATER_LIGHT, borderRadius: 4 },
  idealLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderColor: WATER, borderStyle: 'dashed' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: CHART_HEIGHT },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: CHART_HEIGHT },
  bar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 10, color: colors.textTertiary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { fontSize: 11, color: colors.textSecondary },
});
