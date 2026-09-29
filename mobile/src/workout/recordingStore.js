// Holds the in-progress/just-finished recording between the live screen and
// the summary screen: the temp file path and sampled landmarks for the
// replay overlay. Kept in memory only (not in navigation params - the
// landmark list can be large) and cleared as soon as the user has chosen
// what to do with the recording.
const state = { byWorkout: {} };

export function setRecording(workoutId, data) {
  state.byWorkout[workoutId] = { ...(state.byWorkout[workoutId] || {}), ...data };
}

export function getRecording(workoutId) {
  return state.byWorkout[workoutId] || null;
}

export function clearRecording(workoutId) {
  delete state.byWorkout[workoutId];
}
