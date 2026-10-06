// Apple Watch app target for @bacons/apple-targets (see docs/wearables.md).
// Inert until that plugin is added to app.json "plugins".
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'watch',
  name: 'EyeMyHealthWatch',
  displayName: 'EyeMyHealth',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI'],
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#6C4DFF',
  },
});
