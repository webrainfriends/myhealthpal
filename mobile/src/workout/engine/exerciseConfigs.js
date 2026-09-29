// Exercises as data (issue #135 §2): the counter, analyzer and UI read this
// instead of hard-coding per-exercise logic, so adding an exercise is a new
// entry here (the server's workout_exercise_definition catalogue lists the
// same ids). All angles are in degrees.
//
// metric: how the per-frame tracking value is derived.
//   { type: 'angle', joints: [a, b, c], sides: true }  - joint names use a
//   {S} placeholder expanded to LEFT/RIGHT; `combine` picks avg or min of
//   the visible sides (lunge tracks the deeper, i.e. front, knee).
// reps: extended (top) / flexed (full depth) / partial thresholds on that
//   value; a rep needs the value to pass `flexed` (valid) or at least
//   `partial` (partial), then return past `extended`.

const LM = (n) => n; // documentation aid: MediaPipe-style landmark names

const EXERCISES = {
  squat: {
    id: 'squat',
    symmetry: true,
    name: 'Squat',
    kind: 'reps',
    required: ['LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE'],
    metric: { type: 'angle', joints: [LM('{S}_HIP'), LM('{S}_KNEE'), LM('{S}_ANKLE')], combine: 'avg' },
    reps: { extended: 160, flexed: 100, partial: 130 },
    cues: { down: 'Go slightly deeper.', partial: 'Rep not counted - incomplete range.' },
    rules: [
      { code: 'TORSO_LEAN', severity: 'minor', phase: 'bottom', measure: { type: 'inclination', from: '{S}_HIP', to: '{S}_SHOULDER' }, max: 55, message: 'Keep your chest up.' },
    ],
  },
  pushup: {
    id: 'pushup',
    symmetry: true,
    name: 'Push-up',
    kind: 'reps',
    required: ['LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'LEFT_HIP', 'LEFT_ANKLE'],
    metric: { type: 'angle', joints: [LM('{S}_SHOULDER'), LM('{S}_ELBOW'), LM('{S}_WRIST')], combine: 'avg' },
    reps: { extended: 155, flexed: 95, partial: 125 },
    cues: { down: 'Lower your chest a bit more.', partial: 'Rep not counted - incomplete range.' },
    rules: [
      { code: 'BODY_LINE', severity: 'significant', phase: 'any', measure: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_HIP', '{S}_ANKLE'] }, min: 160, message: 'Keep your body in a straight line.' },
    ],
  },
  lunge: {
    id: 'lunge',
    name: 'Lunge',
    kind: 'reps',
    required: ['LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE', 'RIGHT_HIP', 'RIGHT_KNEE', 'RIGHT_ANKLE'],
    metric: { type: 'angle', joints: [LM('{S}_HIP'), LM('{S}_KNEE'), LM('{S}_ANKLE')], combine: 'min' },
    reps: { extended: 160, flexed: 100, partial: 130 },
    cues: { down: 'Lower your back knee a little more.', partial: 'Rep not counted - incomplete range.' },
    rules: [
      { code: 'TORSO_LEAN', severity: 'minor', phase: 'bottom', measure: { type: 'inclination', from: '{S}_HIP', to: '{S}_SHOULDER' }, max: 30, message: 'Keep your torso upright.' },
    ],
  },
  bicep_curl: {
    id: 'bicep_curl',
    symmetry: true,
    name: 'Biceps curl',
    kind: 'reps',
    required: ['LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST'],
    metric: { type: 'angle', joints: [LM('{S}_SHOULDER'), LM('{S}_ELBOW'), LM('{S}_WRIST')], combine: 'avg' },
    reps: { extended: 150, flexed: 55, partial: 100 },
    cues: { down: 'Curl all the way up.', partial: 'Rep not counted - incomplete range.' },
    rules: [
      { code: 'BODY_SWING', severity: 'minor', phase: 'any', measure: { type: 'inclination', from: '{S}_HIP', to: '{S}_SHOULDER' }, max: 15, message: 'Avoid swinging your body.' },
    ],
  },
  plank: {
    id: 'plank',
    name: 'Plank',
    kind: 'hold',
    required: ['LEFT_SHOULDER', 'LEFT_HIP', 'LEFT_ANKLE'],
    metric: { type: 'angle', joints: [LM('{S}_SHOULDER'), LM('{S}_HIP'), LM('{S}_ANKLE')], combine: 'avg' },
    // A hold only counts while the body line stays at or above this angle.
    hold: { minAngle: 160 },
    rules: [
      { code: 'HIP_SAG', severity: 'significant', phase: 'any', measure: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_HIP', '{S}_ANKLE'] }, min: 160, message: 'Lift your hips into a straight line.' },
    ],
  },
};

function getExercise(id) {
  const ex = EXERCISES[id];
  if (!ex) throw new Error(`Unknown exercise "${id}"`);
  return ex;
}

module.exports = { EXERCISES, getExercise };
