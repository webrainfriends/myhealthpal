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
    posture: 'vertical',
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
    posture: 'horizontal',
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
    posture: 'vertical',
    asymmetric: true, // legs move differently (front/back)
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
    posture: 'vertical',
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
    posture: 'horizontal',
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

  // ---- Phase 5 library (angle-based, so they reuse the same counter) ----
  lateral_raise: {
    id: 'lateral_raise',
    name: 'Lateral raise',
    kind: 'reps',
    symmetry: true,
    posture: 'vertical',
    required: ['LEFT_HIP', 'LEFT_SHOULDER', 'LEFT_WRIST'],
    // Arm abduction: hip-shoulder-wrist. ~20 deg at the side -> ~90 deg raised.
    metric: { type: 'angle', joints: ['{S}_HIP', '{S}_SHOULDER', '{S}_WRIST'], combine: 'avg' },
    reps: { direction: 'increase', extended: 150, flexed: 95, partial: 120 },
    cues: { down: 'Raise your arms to shoulder height.', partial: 'Rep not counted - raise higher.' },
    rules: [],
  },
  shoulder_press: {
    id: 'shoulder_press',
    name: 'Shoulder press',
    kind: 'reps',
    symmetry: true,
    posture: 'vertical',
    required: ['LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST'],
    // Elbow angle: ~85 deg at the shoulders -> ~165 deg overhead.
    metric: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_ELBOW', '{S}_WRIST'], combine: 'avg' },
    reps: { direction: 'increase', extended: 100, flexed: 25, partial: 60 },
    cues: { down: 'Press all the way overhead.', partial: 'Rep not counted - press higher.' },
    rules: [],
  },
  triceps_extension: {
    id: 'triceps_extension',
    name: 'Triceps extension',
    kind: 'reps',
    symmetry: true,
    posture: 'vertical',
    required: ['LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST'],
    metric: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_ELBOW', '{S}_WRIST'], combine: 'avg' },
    reps: { direction: 'increase', extended: 110, flexed: 25, partial: 65 },
    cues: { down: 'Straighten your arms fully.', partial: 'Rep not counted - extend further.' },
    rules: [],
  },
  calf_raise: {
    id: 'calf_raise',
    name: 'Calf raise',
    kind: 'reps',
    posture: 'vertical',
    required: ['LEFT_KNEE', 'LEFT_ANKLE', 'LEFT_FOOT_INDEX'],
    // Ankle angle knee-ankle-toe: ~105 deg standing -> ~140 deg on tiptoes.
    metric: { type: 'angle', joints: ['{S}_KNEE', '{S}_ANKLE', '{S}_FOOT_INDEX'], combine: 'avg' },
    reps: { direction: 'increase', extended: 78, flexed: 48, partial: 62 },
    cues: { down: 'Rise higher onto your toes.', partial: 'Rep not counted - rise higher.' },
    rules: [],
  },
  situp: {
    id: 'situp',
    name: 'Sit-up / crunch',
    kind: 'reps',
    posture: 'any',
    required: ['LEFT_SHOULDER', 'LEFT_HIP', 'LEFT_KNEE'],
    // Torso curl: shoulder-hip-knee ~155 deg lying -> ~80 deg sitting up.
    metric: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_HIP', '{S}_KNEE'], combine: 'avg' },
    reps: { extended: 140, flexed: 90, partial: 115 },
    cues: { down: 'Curl up a little higher.', partial: 'Rep not counted - come up higher.' },
    rules: [],
  },
  jumping_jack: {
    id: 'jumping_jack',
    name: 'Jumping jack',
    kind: 'reps',
    posture: 'vertical',
    required: ['LEFT_HIP', 'LEFT_SHOULDER', 'LEFT_WRIST'],
    // Arms swing from the sides (~20 deg) to overhead (~160 deg).
    metric: { type: 'angle', joints: ['{S}_HIP', '{S}_SHOULDER', '{S}_WRIST'], combine: 'avg' },
    reps: { direction: 'increase', extended: 145, flexed: 40, partial: 90 },
    cues: { down: 'Reach your arms fully overhead.', partial: 'Rep not counted - reach higher.' },
    rules: [],
  },
  high_knees: {
    id: 'high_knees',
    name: 'High knees',
    kind: 'reps',
    posture: 'vertical',
    required: ['LEFT_SHOULDER', 'LEFT_HIP', 'LEFT_KNEE'],
    // Hip flexion of whichever leg is lifted (min over sides).
    metric: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_HIP', '{S}_KNEE'], combine: 'min' },
    reps: { extended: 165, flexed: 110, partial: 135 },
    cues: { down: 'Drive your knees higher.', partial: 'Rep not counted - lift your knee higher.' },
    rules: [],
  },
  mountain_climber: {
    id: 'mountain_climber',
    name: 'Mountain climbers',
    kind: 'reps',
    posture: 'horizontal',
    required: ['LEFT_SHOULDER', 'LEFT_HIP', 'LEFT_KNEE'],
    metric: { type: 'angle', joints: ['{S}_SHOULDER', '{S}_HIP', '{S}_KNEE'], combine: 'min' },
    reps: { extended: 165, flexed: 115, partial: 140 },
    cues: { down: 'Drive your knee toward your chest.', partial: 'Rep not counted - bring the knee further in.' },
    rules: [],
  },
};

function getExercise(id) {
  const ex = EXERCISES[id];
  if (!ex) throw new Error(`Unknown exercise "${id}"`);
  return ex;
}

function hasExercise(id) {
  return Object.prototype.hasOwnProperty.call(EXERCISES, id);
}

module.exports = { EXERCISES, getExercise, hasExercise };
