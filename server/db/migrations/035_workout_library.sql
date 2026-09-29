-- AI Workout Coach Phase 5 (issue #135): broader exercise library. The
-- movement rules live in the app's exercise configs (mobile/src/workout/
-- engine/exerciseConfigs.js); these rows make the exercises selectable and
-- carry the MET value used for calorie estimates. Additive and idempotent.
INSERT INTO workout_exercise_definition (id, name, category, met_value, is_hold, supported_view_angles) VALUES
  ('lateral_raise', 'Lateral raise', 'shoulders', 3.0, FALSE, ARRAY['front']),
  ('shoulder_press', 'Shoulder press', 'shoulders', 3.5, FALSE, ARRAY['front']),
  ('triceps_extension', 'Triceps extension', 'arms', 3.0, FALSE, ARRAY['side', 'front']),
  ('calf_raise', 'Calf raise', 'legs', 3.0, FALSE, ARRAY['side']),
  ('situp', 'Sit-up / crunch', 'core', 3.8, FALSE, ARRAY['side']),
  ('jumping_jack', 'Jumping jack', 'cardio', 8.0, FALSE, ARRAY['front']),
  ('high_knees', 'High knees', 'cardio', 8.0, FALSE, ARRAY['front', 'side']),
  ('mountain_climber', 'Mountain climbers', 'cardio', 8.0, FALSE, ARRAY['side'])
ON CONFLICT (id) DO NOTHING;
