const pool = require('../db/pool');
const { estimateCalories } = require('../workout/calorieEstimator');
const { summarize } = require('../workout/summaryProvider');
const analysis = require('../workout/analysis');
const hr = require('../workout/heartRate');
const progression = require('../workout/progression');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_VERSION = 'pose-v1';

class WorkoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const int = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const num01 = (v) => (Number.isFinite(Number(v)) && v !== null && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : null);
const ts = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (x) => (x == null ? null : Math.round(x * 100));

async function listExercises() {
  const { rows } = await pool.query(
    `SELECT id, name, category, movement_model_version, pose_rules_json, rep_state_machine_json,
            supported_view_angles, is_hold
     FROM workout_exercise_definition WHERE enabled ORDER BY name`
  );
  return rows;
}

async function getOwnedSession(userId, id) {
  if (!UUID_RE.test(String(id))) throw new WorkoutError(404, 'Workout not found.');
  const { rows } = await pool.query('SELECT * FROM workout_session WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw new WorkoutError(404, 'Workout not found.');
  return rows[0];
}

const tempoVal = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 20 ? Number(v) : undefined);

async function createSession(userId, body = {}, link = {}) {
  const { rows: ex } = await pool.query('SELECT id, is_hold FROM workout_exercise_definition WHERE id = $1 AND enabled', [body.exerciseId]);
  if (!ex[0]) throw new WorkoutError(400, 'Unknown exercise.');
  const targetSets = int(body.targetSets, 1, 20);
  if (!targetSets) throw new WorkoutError(400, 'targetSets must be between 1 and 20.');
  const targetReps = ex[0].is_hold ? null : int(body.targetReps, 1, 200);
  const targetHold = ex[0].is_hold ? int(body.targetHoldSeconds, 1, 3600) : null;
  if (ex[0].is_hold ? !targetHold : !targetReps) {
    throw new WorkoutError(400, ex[0].is_hold ? 'targetHoldSeconds is required.' : 'targetReps must be between 1 and 200.');
  }
  const rest = body.targetRestSeconds == null ? null : int(body.targetRestSeconds, 0, 1800);
  const tempo = [body.tempoDownSeconds, body.tempoPauseSeconds, body.tempoUpSeconds].map(tempoVal);
  if (tempo.includes(undefined)) throw new WorkoutError(400, 'Tempo values must be between 0 and 20 seconds.');
  const zoneLow = body.targetHrZoneLow == null ? null : int(body.targetHrZoneLow, 40, 220);
  const zoneHigh = body.targetHrZoneHigh == null ? null : int(body.targetHrZoneHigh, 40, 230);
  if ((body.targetHrZoneLow != null && zoneLow == null) || (body.targetHrZoneHigh != null && zoneHigh == null) || (zoneLow != null && zoneHigh != null && zoneLow >= zoneHigh)) {
    throw new WorkoutError(400, 'Heart-rate zone must be a valid low/high range in bpm.');
  }
  const mode = body.exerciseMode === 'auto' ? 'auto' : 'selected';
  const { rows } = await pool.query(
    `INSERT INTO workout_session (user_id, exercise_id, exercise_mode, detection_confidence, target_sets, target_reps,
                                  target_hold_seconds, target_rest_seconds, model_version,
                                  target_tempo_down_seconds, target_tempo_pause_seconds, target_tempo_up_seconds,
                                  workout_plan_id, plan_run_id, target_hr_zone_low, target_hr_zone_high)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [userId, ex[0].id, mode, num01(body.detectionConfidence), targetSets, targetReps, targetHold, rest, MODEL_VERSION,
      ...tempo, link.planId || null, link.planRunId || null, zoneLow, zoneHigh]
  );
  return rows[0];
}

async function startSession(userId, id) {
  const s = await getOwnedSession(userId, id);
  if (s.status === 'completed' || s.status === 'abandoned') throw new WorkoutError(409, 'Workout already finished.');
  const { rows } = await pool.query(
    `UPDATE workout_session SET status = 'active', started_at = COALESCE(started_at, NOW()) WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

const CLASSES = ['valid', 'partial', 'invalid'];
const SEVERITIES = ['info', 'minor', 'significant', 'reposition'];

// Idempotent on the client-generated ids, so a buffered batch can be
// retried after a dropped connection without duplicating sets/reps/events.
async function recordSets(userId, id, body = {}) {
  const s = await getOwnedSession(userId, id);
  if (s.status === 'completed' || s.status === 'abandoned') throw new WorkoutError(409, 'Workout already finished.');
  const sets = Array.isArray(body.sets) ? body.sets : [];
  if (sets.length === 0 || sets.length > 50) throw new WorkoutError(400, 'sets must contain 1-50 items.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const set of sets) {
      const clientId = typeof set.clientId === 'string' && set.clientId.length <= 64 ? set.clientId : null;
      const setNumber = int(set.setNumber, 1, 100);
      if (!clientId || !setNumber) throw new WorkoutError(400, 'Each set needs clientId and setNumber.');
      const reps = Array.isArray(set.reps) ? set.reps.slice(0, 500) : [];
      const valid = reps.filter((r) => r.classification === 'valid').length;
      const { rows } = await client.query(
        `INSERT INTO workout_set (workout_session_id, client_id, set_number, target_reps, completed_valid_reps, attempted_reps,
                                  hold_seconds, started_at, completed_at, rest_seconds_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (workout_session_id, client_id) DO UPDATE SET
           completed_valid_reps = EXCLUDED.completed_valid_reps, attempted_reps = EXCLUDED.attempted_reps,
           hold_seconds = EXCLUDED.hold_seconds, completed_at = EXCLUDED.completed_at,
           rest_seconds_after = EXCLUDED.rest_seconds_after
         RETURNING id`,
        [id, clientId, setNumber, s.target_reps, valid, reps.length, int(set.holdSeconds, 0, 3600),
          ts(set.startedAt), ts(set.completedAt), set.restSecondsAfter == null ? null : int(set.restSecondsAfter, 0, 3600)]
      );
      const setId = rows[0].id;
      for (const rep of reps) {
        const repId = typeof rep.clientId === 'string' && rep.clientId.length <= 64 ? rep.clientId : null;
        const repNumber = int(rep.repNumber, 1, 1000);
        if (!repId || !repNumber || !CLASSES.includes(rep.classification)) throw new WorkoutError(400, 'Invalid rep.');
        await client.query(
          `INSERT INTO workout_rep (workout_set_id, client_id, rep_number, counted, classification, started_at, completed_at,
                                    duration_ms, range_of_motion_score, posture_score, confidence, metrics_json,
                                    eccentric_ms, hold_ms, concentric_ms, symmetry_score)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (workout_set_id, client_id) DO NOTHING`,
          [setId, repId, repNumber, rep.classification === 'valid', rep.classification, ts(rep.startedAt), ts(rep.completedAt),
            int(rep.durationMs, 0, 600000), num01(rep.rangeOfMotionScore), num01(rep.postureScore), num01(rep.confidence),
            rep.metrics && typeof rep.metrics === 'object' ? JSON.stringify(rep.metrics).slice(0, 4000) : null,
            int(rep.eccentricMs, 0, 120000), int(rep.holdMs, 0, 120000), int(rep.concentricMs, 0, 120000), num01(rep.symmetryScore)]
        );
      }
      for (const ev of (Array.isArray(set.formEvents) ? set.formEvents : []).slice(0, 500)) {
        const evId = typeof ev.clientId === 'string' && ev.clientId.length <= 64 ? ev.clientId : null;
        if (!evId || typeof ev.ruleCode !== 'string' || !SEVERITIES.includes(ev.severity)) throw new WorkoutError(400, 'Invalid form event.');
        await client.query(
          `INSERT INTO workout_form_event (workout_session_id, workout_set_id, client_id, event_timestamp_ms, rule_code, severity,
                                          body_side, measured_value, expected_range_json, coaching_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (workout_session_id, client_id) DO NOTHING`,
          [id, setId, evId, int(ev.timestampMs, 0, 86400000), ev.ruleCode.slice(0, 64), ev.severity,
            ['left', 'right'].includes(ev.bodySide) ? ev.bodySide : null,
            Number.isFinite(Number(ev.measuredValue)) ? Number(ev.measuredValue) : null,
            ev.expectedRange ? JSON.stringify(ev.expectedRange).slice(0, 500) : null,
            typeof ev.message === 'string' ? ev.message.slice(0, 200) : null]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

// Aggregates the most recent earlier completed session of the same exercise
// (same user) into the shape analysis.compareSessions expects.
async function previousComparison(session, current) {
  const { rows } = await pool.query(
    `SELECT s.id, s.completed_at FROM workout_session s
     WHERE s.user_id = $1 AND s.exercise_id = $2 AND s.status = 'completed' AND s.id <> $3
       AND s.completed_at < COALESCE($4, NOW())
     ORDER BY s.completed_at DESC LIMIT 1`,
    [session.user_id, session.exercise_id, session.id, session.completed_at]
  );
  if (!rows[0]) return null;
  const { rows: reps } = await pool.query(
    `SELECT r.classification, r.range_of_motion_score FROM workout_rep r
     JOIN workout_set st ON st.id = r.workout_set_id WHERE st.workout_session_id = $1`,
    [rows[0].id]
  );
  const validCount = reps.filter((r) => r.classification === 'valid').length;
  const roms = reps.map((r) => num(r.range_of_motion_score)).filter((v) => v != null);
  return analysis.compareSessions(current, {
    completedAt: rows[0].completed_at,
    validReps: validCount,
    rom: roms.length ? avg(roms) : null,
    validRatio: reps.length ? validCount / reps.length : null,
  });
}

async function loadMetrics(session, exercise, heart = { samples: [], summary: null }) {
  const [{ rows: sets }, { rows: reps }, { rows: events }] = await Promise.all([
    pool.query('SELECT * FROM workout_set WHERE workout_session_id = $1 ORDER BY set_number', [session.id]),
    pool.query(
      `SELECT r.*, s.set_number FROM workout_rep r JOIN workout_set s ON s.id = r.workout_set_id
       WHERE s.workout_session_id = $1 ORDER BY s.set_number, r.rep_number`, [session.id]),
    pool.query(
      `SELECT rule_code, severity, COUNT(*)::int AS count FROM workout_form_event
       WHERE workout_session_id = $1 GROUP BY rule_code, severity ORDER BY count DESC`, [session.id]),
  ]);
  const valid = reps.filter((r) => r.classification === 'valid');
  const partial = reps.filter((r) => r.classification === 'partial').length;
  const invalid = reps.filter((r) => r.classification === 'invalid').length;
  const rests = sets.map((s) => s.rest_seconds_after).filter((v) => v != null);
  const totalHold = sets.reduce((a, s) => a + (s.hold_seconds || 0), 0);
  const romOf = (rs) => avg(rs.map((r) => Number(r.range_of_motion_score)).filter(Number.isFinite));
  const postureOf = (rs) => avg(rs.map((r) => Number(r.posture_score)).filter(Number.isFinite));
  const plannedSets = session.target_sets;
  const plannedReps = exercise.is_hold ? null : session.target_reps * plannedSets;

  const setsByNumber = new Map();
  for (const r of reps) setsByNumber.set(r.set_number, [...(setsByNumber.get(r.set_number) || []), r]);
  const setNums = [...setsByNumber.keys()].sort((a, b) => a - b);
  const firstSetRom = setNums.length ? romOf(setsByNumber.get(setNums[0])) : null;
  const lastSetRom = setNums.length > 1 ? romOf(setsByNumber.get(setNums[setNums.length - 1])) : null;

  const tempoTarget = session.target_tempo_down_seconds != null || session.target_tempo_up_seconds != null
    ? { down: num(session.target_tempo_down_seconds), pause: num(session.target_tempo_pause_seconds), up: num(session.target_tempo_up_seconds) }
    : null;
  const trend = analysis.qualityTrend(setsByNumber);
  const actualTempo = analysis.averageTempo(reps);
  const comparison = await previousComparison(session, {
    validReps: valid.length,
    rom: romOf(reps),
    validRatio: reps.length ? valid.length / reps.length : null,
  });

  // Every component is reported on its own; null means "not measured".
  const adherence = {
    plannedRepsAchieved: exercise.is_hold
      ? (session.target_hold_seconds ? Math.min(1, totalHold / (session.target_hold_seconds * plannedSets)) : null)
      : (plannedReps ? Math.min(1, valid.length / plannedReps) : null),
    setsCompleted: plannedSets ? Math.min(1, sets.length / plannedSets) : null,
    correctFormRatio: reps.length ? valid.length / reps.length : null,
    rangeOfMotionQuality: romOf(reps),
    postureQuality: postureOf(reps),
    restAdherence: rests.length && session.target_rest_seconds
      ? Math.max(0, 1 - Math.abs(avg(rests) - session.target_rest_seconds) / session.target_rest_seconds) : null,
    tempoAdherence: analysis.tempoAdherence(reps, tempoTarget),
    heartRateZoneTime: hr.zoneTimeRatio(heart.samples, session.target_hr_zone_low, session.target_hr_zone_high),
    symmetry: analysis.symmetry(reps),
    romFirstSet: firstSetRom,
    romLastSet: lastSetRom,
    basis: 'Each value is a 0-1 ratio computed from stored reps/sets; null means not measured.',
  };

  const metrics = {
    exerciseName: exercise.name,
    isHold: exercise.is_hold,
    plannedSets,
    completedSets: sets.length,
    plannedReps,
    validReps: valid.length,
    partialReps: partial,
    invalidReps: invalid,
    totalHoldSeconds: totalHold,
    targetRestSeconds: session.target_rest_seconds,
    avgRestSeconds: rests.length ? Math.round(avg(rests)) : null,
    romFirstSetPct: pct(firstSetRom),
    romLastSetPct: pct(lastSetRom),
    tempo: actualTempo && { planned: tempoTarget, actual: actualTempo },
    symmetryPct: pct(analysis.symmetry(reps)),
    heartRate: heart.summary,
    heartRateZoneTimePct: pct(hr.zoneTimeRatio(heart.samples, session.target_hr_zone_low, session.target_hr_zone_high)),
    trend,
    comparison,
    topFormIssues: events.slice(0, 3).map((e) => ({ rule: e.rule_code, severity: e.severity, count: e.count })),
  };
  return { metrics, adherence };
}

// Completed sessions of one exercise, newest first, in the shape
// workout/progression.js expects (built from the stored adherence/summary).
async function completedSessionsFor(userId, exerciseId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT s.id, s.completed_at, s.target_sets, s.target_reps, s.target_hold_seconds, s.target_rest_seconds,
            s.adherence_json, s.summary_json, e.is_hold,
            (SELECT COALESCE(SUM(completed_valid_reps), 0)::int FROM workout_set WHERE workout_session_id = s.id) AS valid_reps,
            (SELECT COALESCE(MAX(completed_valid_reps), 0)::int FROM workout_set WHERE workout_session_id = s.id) AS best_set_reps
     FROM workout_session s JOIN workout_exercise_definition e ON e.id = s.exercise_id
     WHERE s.user_id = $1 AND s.exercise_id = $2 AND s.status = 'completed'
     ORDER BY s.completed_at DESC LIMIT $3`,
    [userId, exerciseId, limit]
  );
  return rows.map((r) => ({
    targetSets: r.target_sets,
    targetReps: r.target_reps,
    targetHoldSeconds: r.target_hold_seconds,
    targetRestSeconds: r.target_rest_seconds,
    isHold: r.is_hold,
    plannedRepsAchieved: r.adherence_json?.plannedRepsAchieved ?? null,
    correctFormRatio: r.adherence_json?.correctFormRatio ?? null,
    fatigueDetected: !!r.summary_json?.metrics?.trend?.fatigueDetected,
    validReps: r.valid_reps,
    bestSetReps: r.best_set_reps,
    completedAt: r.completed_at,
  }));
}

async function getProgression(userId, exerciseId) {
  const { rows } = await pool.query('SELECT id FROM workout_exercise_definition WHERE id = $1', [exerciseId]);
  if (!rows[0]) throw new WorkoutError(404, 'Unknown exercise.');
  return { exerciseId, suggestion: progression.suggestNext(await completedSessionsFor(userId, exerciseId)) };
}

async function getAnalytics(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT s.exercise_id, e.name FROM workout_session s JOIN workout_exercise_definition e ON e.id = s.exercise_id
     WHERE s.user_id = $1 AND s.status = 'completed' ORDER BY e.name`, [userId]);
  const exercises = [];
  for (const r of rows) {
    exercises.push({ exerciseId: r.exercise_id, name: r.name, ...progression.buildAnalytics(await completedSessionsFor(userId, r.exercise_id, 30)) });
  }
  return { exercises };
}

async function completeSession(userId, id, body = {}) {
  const session = await getOwnedSession(userId, id);
  if (session.status === 'completed') return getSummary(userId, id);
  const { rows: ex } = await pool.query('SELECT * FROM workout_exercise_definition WHERE id = $1', [session.exercise_id]);
  const exercise = ex[0];

  const activeSeconds = int(body.activeSeconds, 0, 86400) ?? 0;
  const startedMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
  const elapsedSeconds = Math.max(activeSeconds, Math.round((Date.now() - startedMs) / 1000));

  const { rows: w } = await pool.query(
    'SELECT weight_kg FROM user_weight_entries WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1', [userId]
  ).catch(() => ({ rows: [] }));
  // Heart rate is opt-in and arrives from the phone's health store; samples
  // are validated, downsampled and stored so the estimate can be recomputed.
  const samples = hr.cleanSamples(body.heartRate?.samples);
  const heart = { samples, summary: hr.summarize(samples) };
  const deviceKcal = Number.isFinite(Number(body.deviceActiveKcal)) && Number(body.deviceActiveKcal) > 0 && Number(body.deviceActiveKcal) < 5000
    ? Math.round(Number(body.deviceActiveKcal)) : null;
  const calories = estimateCalories({
    metValue: exercise.met_value, weightKg: w[0]?.weight_kg, activeSeconds,
    heartRate: heart.summary, deviceActiveKcal: deviceKcal,
  });
  const { metrics, adherence } = await loadMetrics(session, exercise, heart);
  // Next-session suggestion from history including this session, so the
  // summary's recommendation is computed from measured numbers, not invented.
  const history = await completedSessionsFor(userId, session.exercise_id, 3);
  const current = {
    targetSets: session.target_sets, targetReps: session.target_reps, targetHoldSeconds: session.target_hold_seconds,
    targetRestSeconds: session.target_rest_seconds, isHold: exercise.is_hold,
    plannedRepsAchieved: adherence.plannedRepsAchieved, correctFormRatio: adherence.correctFormRatio,
    fatigueDetected: !!metrics.trend?.fatigueDetected,
  };
  metrics.nextSession = progression.suggestNext([current, ...history.slice(0, 2)]);
  const summary = await summarize(metrics, { userId });

  await pool.query(
    `UPDATE workout_session SET status = 'completed', completed_at = NOW(), active_seconds = $2, elapsed_seconds = $3,
       estimated_calories_low = $4, estimated_calories_high = $5, calorie_confidence = $6, calorie_method_version = $7,
       calorie_inputs_json = $8, adherence_json = $9, summary_json = $10, hr_json = $11, device_active_kcal = $12 WHERE id = $1`,
    [id, activeSeconds, elapsedSeconds, calories.low, calories.high, calories.confidence, calories.methodVersion,
      JSON.stringify(calories.inputs), JSON.stringify(adherence), JSON.stringify({ metrics, text: summary.text, source: summary.source }),
      samples.length ? JSON.stringify({ source: typeof body.heartRate?.source === 'string' ? body.heartRate.source.slice(0, 32) : null, summary: heart.summary, samples }) : null,
      deviceKcal]
  );
  return getSummary(userId, id);
}

async function getSummary(userId, id) {
  const s = await getOwnedSession(userId, id);
  const { rows: ex } = await pool.query('SELECT id, name, is_hold FROM workout_exercise_definition WHERE id = $1', [s.exercise_id]);
  return {
    id: s.id,
    status: s.status,
    exercise: ex[0],
    startedAt: s.started_at,
    completedAt: s.completed_at,
    activeSeconds: s.active_seconds,
    elapsedSeconds: s.elapsed_seconds,
    target: {
      sets: s.target_sets, reps: s.target_reps, holdSeconds: s.target_hold_seconds, restSeconds: s.target_rest_seconds,
      tempo: s.target_tempo_down_seconds != null || s.target_tempo_up_seconds != null
        ? { down: num(s.target_tempo_down_seconds), pause: num(s.target_tempo_pause_seconds), up: num(s.target_tempo_up_seconds) } : null,
    },
    planRunId: s.plan_run_id,
    heartRate: s.hr_json ? { source: s.hr_json.source, ...s.hr_json.summary, zone: s.target_hr_zone_low != null ? { low: s.target_hr_zone_low, high: s.target_hr_zone_high } : null } : null,
    adherence: s.adherence_json,
    calories: s.estimated_calories_low == null ? null : {
      low: s.estimated_calories_low, high: s.estimated_calories_high, confidence: s.calorie_confidence,
      methodVersion: s.calorie_method_version, inputs: s.calorie_inputs_json,
    },
    metrics: s.summary_json?.metrics || null,
    summaryText: s.summary_json?.text || null,
    summarySource: s.summary_json?.source || null,
  };
}

async function history(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT s.id, s.exercise_id, e.name AS exercise_name, s.status, s.started_at, s.completed_at, s.active_seconds,
            s.estimated_calories_low, s.estimated_calories_high,
            (SELECT COALESCE(SUM(completed_valid_reps),0)::int FROM workout_set WHERE workout_session_id = s.id) AS valid_reps
     FROM workout_session s JOIN workout_exercise_definition e ON e.id = s.exercise_id
     WHERE s.user_id = $1 AND s.status = 'completed' ORDER BY s.completed_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 30, 1), 100)]
  );
  return rows;
}

// ---- Workout plans (issue #135 Phase 2) ----------------------------------

function cleanPlanExercise(e, index) {
  const sets = int(e?.targetSets, 1, 20);
  if (!sets) throw new WorkoutError(400, 'Each plan exercise needs targetSets (1-20).');
  const tempo = [e.tempoDownSeconds, e.tempoPauseSeconds, e.tempoUpSeconds].map(tempoVal);
  if (tempo.includes(undefined)) throw new WorkoutError(400, 'Tempo values must be between 0 and 20 seconds.');
  const zone = [e.targetHrZoneLow == null ? null : int(e.targetHrZoneLow, 40, 220), e.targetHrZoneHigh == null ? null : int(e.targetHrZoneHigh, 40, 230)];
  if ((zone[0] == null) !== (zone[1] == null) || (zone[0] != null && zone[0] >= zone[1])) throw new WorkoutError(400, 'Heart-rate zone must be a valid low/high range in bpm.');
  return {
    zone,
    sequence: index + 1,
    exerciseId: e.exerciseId,
    sets,
    reps: e.targetReps == null ? null : int(e.targetReps, 1, 200),
    hold: e.targetHoldSeconds == null ? null : int(e.targetHoldSeconds, 1, 3600),
    rest: e.targetRestSeconds == null ? null : int(e.targetRestSeconds, 0, 1800),
    tempo,
  };
}

async function createPlan(userId, body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) throw new WorkoutError(400, 'Plan name must be 1-80 characters.');
  const list = Array.isArray(body.exercises) ? body.exercises : [];
  if (list.length === 0 || list.length > 20) throw new WorkoutError(400, 'A plan needs 1-20 exercises.');
  const cleaned = list.map(cleanPlanExercise);
  const { rows: known } = await pool.query('SELECT id, is_hold FROM workout_exercise_definition WHERE enabled AND id = ANY($1::text[])', [cleaned.map((c) => c.exerciseId)]);
  const byId = new Map(known.map((k) => [k.id, k]));
  for (const c of cleaned) {
    const ex = byId.get(c.exerciseId);
    if (!ex) throw new WorkoutError(400, 'Unknown exercise in plan.');
    if (ex.is_hold ? !c.hold : !c.reps) throw new WorkoutError(400, ex.is_hold ? 'Hold exercises need targetHoldSeconds.' : 'Rep exercises need targetReps.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO workout_plan (user_id, name) VALUES ($1,$2) RETURNING id', [userId, name]);
    for (const c of cleaned) {
      await client.query(
        `INSERT INTO workout_plan_exercise (workout_plan_id, exercise_id, sequence, target_sets, target_reps, target_hold_seconds,
                                            target_rest_seconds, target_tempo_down_seconds, target_tempo_pause_seconds, target_tempo_up_seconds,
                                            target_hr_zone_low, target_hr_zone_high)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [rows[0].id, c.exerciseId, c.sequence, c.sets, c.reps, c.hold, c.rest, ...c.tempo, ...c.zone]
      );
    }
    await client.query('COMMIT');
    return getPlan(userId, rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPlan(userId, id) {
  if (!UUID_RE.test(String(id))) throw new WorkoutError(404, 'Plan not found.');
  const { rows } = await pool.query('SELECT id, name, created_at FROM workout_plan WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw new WorkoutError(404, 'Plan not found.');
  const { rows: exercises } = await pool.query(
    `SELECT pe.*, e.name AS exercise_name, e.is_hold FROM workout_plan_exercise pe
     JOIN workout_exercise_definition e ON e.id = pe.exercise_id WHERE pe.workout_plan_id = $1 ORDER BY pe.sequence`, [id]);
  return { ...rows[0], exercises };
}

async function listPlans(userId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.created_at, COUNT(pe.id)::int AS exercise_count
     FROM workout_plan p LEFT JOIN workout_plan_exercise pe ON pe.workout_plan_id = p.id
     WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.created_at DESC`, [userId]);
  return rows;
}

async function deletePlan(userId, id) {
  const plan = await getPlan(userId, id);
  await pool.query('DELETE FROM workout_plan WHERE id = $1 AND user_id = $2', [plan.id, userId]);
  return { ok: true };
}

// One session per exercise, in order, sharing a plan_run_id so the app can
// walk through them and history can group them.
async function runPlan(userId, id) {
  const plan = await getPlan(userId, id);
  const { rows: [{ run }] } = await pool.query('SELECT gen_random_uuid() AS run');
  const sessions = [];
  for (const e of plan.exercises) {
    sessions.push(await createSession(userId, {
      exerciseId: e.exercise_id, targetSets: e.target_sets, targetReps: e.target_reps, targetHoldSeconds: e.target_hold_seconds,
      targetRestSeconds: e.target_rest_seconds, tempoDownSeconds: e.target_tempo_down_seconds,
      tempoPauseSeconds: e.target_tempo_pause_seconds, tempoUpSeconds: e.target_tempo_up_seconds,
      targetHrZoneLow: e.target_hr_zone_low, targetHrZoneHigh: e.target_hr_zone_high,
    }, { planId: plan.id, planRunId: run }));
  }
  return { planRunId: run, sessions };
}

module.exports = {
  getProgression, getAnalytics,
  createPlan, getPlan, listPlans, deletePlan, runPlan, WorkoutError, listExercises, createSession, startSession, recordSets, completeSession, getSummary, history };
