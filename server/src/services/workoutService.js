const pool = require('../db/pool');
const { estimateCalories } = require('../workout/calorieEstimator');
const { summarize } = require('../workout/summaryProvider');

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

async function createSession(userId, body = {}) {
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
  const mode = body.exerciseMode === 'auto' ? 'auto' : 'selected';
  const { rows } = await pool.query(
    `INSERT INTO workout_session (user_id, exercise_id, exercise_mode, detection_confidence, target_sets, target_reps,
                                  target_hold_seconds, target_rest_seconds, model_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, ex[0].id, mode, num01(body.detectionConfidence), targetSets, targetReps, targetHold, rest, MODEL_VERSION]
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
                                    duration_ms, range_of_motion_score, posture_score, confidence, metrics_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (workout_set_id, client_id) DO NOTHING`,
          [setId, repId, repNumber, rep.classification === 'valid', rep.classification, ts(rep.startedAt), ts(rep.completedAt),
            int(rep.durationMs, 0, 600000), num01(rep.rangeOfMotionScore), num01(rep.postureScore), num01(rep.confidence),
            rep.metrics && typeof rep.metrics === 'object' ? JSON.stringify(rep.metrics).slice(0, 4000) : null]
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

async function loadMetrics(session, exercise) {
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
    topFormIssues: events.slice(0, 3).map((e) => ({ rule: e.rule_code, severity: e.severity, count: e.count })),
  };
  return { metrics, adherence };
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
  const calories = estimateCalories({ metValue: exercise.met_value, weightKg: w[0]?.weight_kg, activeSeconds });
  const { metrics, adherence } = await loadMetrics(session, exercise);
  const summary = await summarize(metrics, { userId });

  await pool.query(
    `UPDATE workout_session SET status = 'completed', completed_at = NOW(), active_seconds = $2, elapsed_seconds = $3,
       estimated_calories_low = $4, estimated_calories_high = $5, calorie_confidence = $6, calorie_method_version = $7,
       calorie_inputs_json = $8, adherence_json = $9, summary_json = $10 WHERE id = $1`,
    [id, activeSeconds, elapsedSeconds, calories.low, calories.high, calories.confidence, calories.methodVersion,
      JSON.stringify(calories.inputs), JSON.stringify(adherence), JSON.stringify({ metrics, text: summary.text, source: summary.source })]
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
    target: { sets: s.target_sets, reps: s.target_reps, holdSeconds: s.target_hold_seconds, restSeconds: s.target_rest_seconds },
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

module.exports = { WorkoutError, listExercises, createSession, startSession, recordSets, completeSession, getSummary, history };
