const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');

let a;
let b;
let tokenA;
let tokenB;

test.before(async () => {
  a = (await pool.query(`INSERT INTO users (display_name) VALUES ('workout test A') RETURNING id`)).rows[0].id;
  b = (await pool.query(`INSERT INTO users (display_name) VALUES ('workout test B') RETURNING id`)).rows[0].id;
  tokenA = signSession({ id: a });
  tokenB = signSession({ id: b });
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

test('workout lifecycle: create, idempotent batch, complete, summary, isolation', async () => {
  const { server, base } = await listen();
  try {
    assert.equal((await fetch(`${base}/api/activity/workouts/exercises`)).status, 401);
    const ex = await (await fetch(`${base}/api/activity/workouts/exercises`, { headers: H(tokenA) })).json();
    assert.ok(ex.exercises.some((e) => e.id === 'squat'));

    const bad = await fetch(`${base}/api/activity/workouts`, { method: 'POST', headers: H(tokenA), body: JSON.stringify({ exerciseId: 'nope', targetSets: 1, targetReps: 5 }) });
    assert.equal(bad.status, 400);

    const created = await (await fetch(`${base}/api/activity/workouts`, {
      method: 'POST', headers: H(tokenA),
      body: JSON.stringify({ exerciseId: 'squat', targetSets: 2, targetReps: 3, targetRestSeconds: 60 }),
    })).json();
    const id = created.id;
    await fetch(`${base}/api/activity/workouts/${id}/start`, { method: 'POST', headers: H(tokenA) });

    const payload = {
      sets: [{
        clientId: 's1', setNumber: 1, restSecondsAfter: 70,
        reps: [
          { clientId: 'r1', repNumber: 1, classification: 'valid', rangeOfMotionScore: 0.95, durationMs: 2000 },
          { clientId: 'r2', repNumber: 2, classification: 'partial', rangeOfMotionScore: 0.6, durationMs: 1500 },
        ],
        formEvents: [{ clientId: 'e1', ruleCode: 'KNEE_VALGUS', severity: 'minor', bodySide: 'right', measuredValue: 12 }],
      }],
    };
    for (let i = 0; i < 2; i += 1) {
      const r = await fetch(`${base}/api/activity/workouts/${id}/sets`, { method: 'POST', headers: H(tokenA), body: JSON.stringify(payload) });
      assert.equal(r.status, 200);
    }
    const counts = await pool.query(
      `SELECT (SELECT COUNT(*) FROM workout_rep r JOIN workout_set s ON s.id = r.workout_set_id WHERE s.workout_session_id = $1)::int AS reps,
              (SELECT COUNT(*) FROM workout_form_event WHERE workout_session_id = $1)::int AS events`, [id]);
    assert.deepEqual(counts.rows[0], { reps: 2, events: 1 });

    const done = await (await fetch(`${base}/api/activity/workouts/${id}/complete`, { method: 'POST', headers: H(tokenA), body: JSON.stringify({ activeSeconds: 300 }) })).json();
    assert.equal(done.status, 'completed');
    assert.equal(done.metrics.validReps, 1);
    assert.equal(done.metrics.partialReps, 1);
    assert.ok(done.calories.high > done.calories.low);
    assert.equal(done.calories.methodVersion, 'met-v1');
    assert.equal(done.adherence.setsCompleted, 0.5);
    assert.ok(done.summaryText.length > 0);

    assert.equal((await fetch(`${base}/api/activity/workouts/${id}/summary`, { headers: H(tokenB) })).status, 404);
    assert.equal((await fetch(`${base}/api/activity/workouts/${id}/sets`, { method: 'POST', headers: H(tokenB), body: JSON.stringify(payload) })).status, 404);
    const hist = await (await fetch(`${base}/api/activity/workouts/history`, { headers: H(tokenA) })).json();
    assert.equal(hist.workouts.length, 1);
  } finally {
    server.close();
  }
});

test('phase 2: plans, tempo/symmetry adherence, comparison with the previous session', async () => {
  const { server, base } = await listen();
  const post = (path, t, body) => fetch(`${base}/api/activity/workouts${path}`, { method: 'POST', headers: H(t), body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().then((j) => [r.status, j]));
  try {
    const [bad] = await post('/plans', tokenA, { name: 'x', exercises: [{ exerciseId: 'squat', targetSets: 2 }] });
    assert.equal(bad, 400); // rep exercise without targetReps

    const [st, plan] = await post('/plans', tokenA, {
      name: 'Leg day',
      exercises: [
        { exerciseId: 'squat', targetSets: 1, targetReps: 2, targetRestSeconds: 30, tempoDownSeconds: 3, tempoUpSeconds: 2 },
        { exerciseId: 'plank', targetSets: 1, targetHoldSeconds: 20 },
      ],
    });
    assert.equal(st, 200);
    assert.equal(plan.exercises.length, 2);
    assert.equal((await fetch(`${base}/api/activity/workouts/plans/${plan.id}`, { headers: H(tokenB) })).status, 404);

    const [, run] = await post(`/plans/${plan.id}/run`, tokenA);
    assert.equal(run.sessions.length, 2);
    assert.ok(run.sessions.every((s) => s.plan_run_id === run.planRunId));

    const squat = run.sessions[0];
    const mkSet = (id, rom) => ({
      clientId: id, setNumber: 1,
      reps: [1, 2].map((n) => ({ clientId: `r${n}`, repNumber: n, classification: 'valid', rangeOfMotionScore: rom, durationMs: 4000, eccentricMs: 2000, holdMs: 300, concentricMs: 1500, symmetryScore: 0.9 })),
    });
    await post(`/${squat.id}/start`, tokenA);
    await post(`/${squat.id}/sets`, tokenA, { sets: [mkSet('s1', 0.9)] });
    const [, done] = await post(`/${squat.id}/complete`, tokenA, { activeSeconds: 60 });
    assert.equal(done.metrics.tempo.actual.downSeconds, 2);
    assert.equal(done.adherence.symmetry, 0.9);
    assert.ok(done.adherence.tempoAdherence > 0 && done.adherence.tempoAdherence < 1);
    assert.equal(done.target.tempo.down, 3);

    // A second squat session should compare against the first.
    const [, s2] = await post('/', tokenA, { exerciseId: 'squat', targetSets: 1, targetReps: 2 });
    await post(`/${s2.id}/start`, tokenA);
    await post(`/${s2.id}/sets`, tokenA, { sets: [mkSet('s1', 0.95)] });
    const [, done2] = await post(`/${s2.id}/complete`, tokenA, { activeSeconds: 60 });
    assert.ok(done2.metrics.comparison, 'expected a comparison with a previous squat session');
    assert.equal(done2.metrics.comparison.validReps.current, 2);
    assert.match(done2.summaryText, /Compared with your previous session/);

    const del = await fetch(`${base}/api/activity/workouts/plans/${plan.id}`, { method: 'DELETE', headers: H(tokenA) });
    assert.equal(del.status, 200);
  } finally {
    server.close();
  }
});

test('phase 4: heart rate, zone adherence and device energy on completion', async () => {
  const { server, base } = await listen();
  const post = (path, t, body) => fetch(`${base}/api/activity/workouts${path}`, { method: 'POST', headers: H(t), body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().then((j) => [r.status, j]));
  try {
    const [badZone] = await post('/', tokenA, { exerciseId: 'squat', targetSets: 1, targetReps: 1, targetHrZoneLow: 150, targetHrZoneHigh: 120 });
    assert.equal(badZone, 400);

    const [, s] = await post('/', tokenA, { exerciseId: 'squat', targetSets: 1, targetReps: 1, targetHrZoneLow: 120, targetHrZoneHigh: 150 });
    await post(`/${s.id}/start`, tokenA);
    const t0 = Date.now();
    const samples = [0, 30, 60, 90].map((sec, i) => ({ t: new Date(t0 + sec * 1000).toISOString(), bpm: [100, 130, 135, 100][i] }));
    const [, done] = await post(`/${s.id}/complete`, tokenA, { activeSeconds: 600, heartRate: { source: 'apple_health', samples } });
    assert.equal(done.calories.methodVersion, 'met-hr-v2');
    assert.ok(done.calories.inputs.sources.includes('heart rate'));
    assert.equal(done.heartRate.avgBpm, 116);
    assert.deepEqual(done.heartRate.zone, { low: 120, high: 150 });
    assert.ok(done.adherence.heartRateZoneTime > 0.5 && done.adherence.heartRateZoneTime < 0.8);
    assert.match(done.summaryText, /heart rate/i);

    // Without HR the v1 method is kept and no HR block appears.
    const [, plain] = await post('/', tokenA, { exerciseId: 'squat', targetSets: 1, targetReps: 1 });
    await post(`/${plain.id}/start`, tokenA);
    const [, done2] = await post(`/${plain.id}/complete`, tokenA, { activeSeconds: 600 });
    assert.equal(done2.calories.methodVersion, 'met-v1');
    assert.equal(done2.heartRate, null);
    assert.equal(done2.adherence.heartRateZoneTime, null);

    // Device-reported energy wins over estimates.
    const [, dev] = await post('/', tokenA, { exerciseId: 'squat', targetSets: 1, targetReps: 1 });
    await post(`/${dev.id}/start`, tokenA);
    const [, done3] = await post(`/${dev.id}/complete`, tokenA, { activeSeconds: 600, deviceActiveKcal: 100 });
    assert.deepEqual([done3.calories.low, done3.calories.high], [90, 110]);
  } finally {
    server.close();
  }
});
