const pool = require('../db/pool');
const { evaluateRetest, daysUntil, weekStart, checkinStreak } = require('./retestRules');

// Same exclusion the dashboard uses - a suspected/confirmed duplicate is
// never live data, so it must not drive (or close) a plan.
const EXCLUDE_DUPLICATES_SQL = `hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')`;

async function latestConfirmedPerParameter(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (hm.health_parameter_id)
            hm.health_parameter_id, hp.code AS parameter_code, hm.id AS measurement_id, hm.status_flag,
            COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS effective_date
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE r.user_id = $1 AND hm.is_confirmed = true AND hm.health_parameter_id IS NOT NULL
       AND ${EXCLUDE_DUPLICATES_SQL}
     ORDER BY hm.health_parameter_id, effective_date DESC NULLS LAST, hm.created_at DESC`,
    [userId]
  );
  return rows;
}

async function activeMedicationLinks(userId) {
  const { rows } = await pool.query(
    `SELECT mpl.health_parameter_id, hp.code AS parameter_code, m.name AS medication_name, m.start_date,
            mpl.typical_onset_weeks_min, mpl.typical_onset_weeks_max
     FROM medication_parameter_links mpl
     JOIN medications m ON m.id = mpl.medication_id
     JOIN health_parameters hp ON hp.id = mpl.health_parameter_id
     WHERE m.user_id = $1 AND m.is_confirmed = true AND m.status = 'active' AND m.start_date IS NOT NULL`,
    [userId]
  );
  return rows;
}

// Recomputes every parameter's plan against the user's current data. Pull
// model, like medication alerts: cheap enough to run on each load and from
// the reminder job. A dismissed or snoozed plan is left alone while its
// situation (same result, same reason, same due date) is unchanged; any
// change closes it ('done') and opens a fresh one.
async function recomputeForUser(userId) {
  const [latestRows, linkRows] = await Promise.all([latestConfirmedPerParameter(userId), activeMedicationLinks(userId)]);

  const byParameter = new Map();
  for (const row of latestRows) {
    byParameter.set(row.health_parameter_id, {
      parameterCode: row.parameter_code,
      latest: { measurementId: row.measurement_id, statusFlag: row.status_flag, effectiveDate: row.effective_date },
      medicationLinks: [],
    });
  }
  for (const link of linkRows) {
    if (!byParameter.has(link.health_parameter_id)) {
      byParameter.set(link.health_parameter_id, { parameterCode: link.parameter_code, latest: null, medicationLinks: [] });
    }
    byParameter.get(link.health_parameter_id).medicationLinks.push({
      medicationName: link.medication_name,
      startDate: link.start_date,
      onsetWeeksMin: link.typical_onset_weeks_min === null ? null : Number(link.typical_onset_weeks_min),
      onsetWeeksMax: link.typical_onset_weeks_max === null ? null : Number(link.typical_onset_weeks_max),
    });
  }

  const { rows: openPlans } = await pool.query(
    `SELECT * FROM retest_plans WHERE user_id = $1 AND status <> 'done'`,
    [userId]
  );
  const openByParameter = new Map(openPlans.map((p) => [p.health_parameter_id, p]));

  for (const [healthParameterId, input] of byParameter) {
    const candidate = evaluateRetest(input);
    const existing = openByParameter.get(healthParameterId);
    openByParameter.delete(healthParameterId);

    const unchanged =
      existing &&
      candidate &&
      existing.reason === candidate.reason &&
      String(existing.due_date) === candidate.dueDate &&
      (existing.last_measurement_id ?? null) === (candidate.lastMeasurementId ?? null);
    if (unchanged) continue;

    if (existing) {
      await pool.query(`UPDATE retest_plans SET status = 'done', updated_at = now() WHERE id = $1`, [existing.id]);
    }
    if (!candidate) continue;

    await pool.query(
      `INSERT INTO retest_plans (user_id, health_parameter_id, last_measurement_id, flag, reason, medication_name, micro_action, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        healthParameterId,
        candidate.lastMeasurementId,
        candidate.flag,
        candidate.reason,
        candidate.medicationName || null,
        candidate.microAction,
        candidate.dueDate,
      ]
    );
  }

  // A parameter with no data left at all (e.g. its only report was
  // deleted) can't need a recheck.
  for (const orphan of openByParameter.values()) {
    await pool.query(`UPDATE retest_plans SET status = 'done', updated_at = now() WHERE id = $1`, [orphan.id]);
  }
}

// Plans the user should currently see: active ones, plus snoozed ones whose
// snooze has run out. Soonest-due first.
async function listVisiblePlans(userId, today = new Date()) {
  const { rows } = await pool.query(
    `SELECT rp.*, hp.code AS parameter_code, hp.display_name AS parameter_display_name,
            COALESCE(array_agg(rc.week_start::text) FILTER (WHERE rc.week_start IS NOT NULL), '{}') AS checkin_weeks
     FROM retest_plans rp
     JOIN health_parameters hp ON hp.id = rp.health_parameter_id
     LEFT JOIN retest_checkins rc ON rc.plan_id = rp.id
     WHERE rp.user_id = $1
       AND (rp.status = 'active' OR (rp.status = 'snoozed' AND rp.snoozed_until <= $2::date))
     GROUP BY rp.id, hp.code, hp.display_name
     ORDER BY rp.due_date ASC`,
    [userId, today.toISOString().slice(0, 10)]
  );
  const thisWeek = weekStart(today);
  // week_start is aggregated as text: pool.js only maps a plain DATE to its
  // 'YYYY-MM-DD' string, a DATE[] would still come back as JS Dates.
  return rows.map((row) => {
    const weeks = row.checkin_weeks;
    return {
      id: row.id,
      healthParameterId: row.health_parameter_id,
      parameterCode: row.parameter_code,
      parameterDisplayName: row.parameter_display_name,
      lastMeasurementId: row.last_measurement_id,
      flag: row.flag,
      reason: row.reason,
      medicationName: row.medication_name,
      microAction: row.micro_action,
      dueDate: row.due_date,
      daysLeft: daysUntil(row.due_date, today),
      checkedInThisWeek: weeks.includes(thisWeek),
      streakWeeks: checkinStreak(weeks, today),
      createdAt: row.created_at,
    };
  });
}

module.exports = { recomputeForUser, listVisiblePlans };
