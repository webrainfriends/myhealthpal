module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Required by react-native-mediapipe / vision-camera frame processors
    // (AI Workout Coach live pose tracking).
    plugins: ['react-native-worklets-core/plugin'],
  };
};
