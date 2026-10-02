# Shipping EyeMyHealth to the App Store and Google Play

The iPhone, iPad and Android apps are the existing `mobile/` Expo app, built
with EAS. The web app (`mobile/` web export served by nginx) and the MCP
connector (`server/src/mcp`) are unchanged and keep using the same API.

## What is already set up

| Area | Setting |
| --- | --- |
| Identifiers | iOS `com.eyemyhealth.app`, Android `com.eyemyhealth.app` (`mobile/app.json`; change before first upload if you own a different ID) |
| Devices | iPhone + iPad (`supportsTablet`), Android phones + tablets, all orientations |
| Tablet layout | Native screens are centred in an 840 pt reading column; web layout untouched |
| API | Release builds talk to `https://eyemyhealth.com` (override with `EXPO_PUBLIC_API_BASE_URL` in `eas.json`); both stores block plain HTTP |
| Sign-in | Guest, Sign in with Apple (native on iOS/iPadOS, web popup on web). Google remains web-only |
| Privacy | Account deletion in Settings, consent screens, camera/photo/health/location/Bluetooth purpose strings, no microphone permission |
| Builds | `mobile/eas.json`: `development`, `preview` (internal / APK), `production` (store, auto-increment) |

## One-time steps only you can do

1. **Accounts**: Apple Developer Program, Google Play Console.
2. **EAS**: `cd mobile && npx eas login && npx eas init` (writes
   `extra.eas.projectId`, which Retest Radar push needs).
3. **Domain with HTTPS**: run `scripts/configure-domain.sh` for the domain you
   use, then make `eas.json` and `PRODUCTION_API_URL` in
   `mobile/src/api/client.js` match it. Replace `eyemyhealth.com` if different.
4. **Apple**: create the App ID with Sign in with Apple, HealthKit and Push
   Notifications; create the app in App Store Connect; put its numeric ID in
   `eas.json` → `submit.production.ios.ascAppId`.
5. **Server env**: `APPLE_CLIENT_ID=<web services id>,com.eyemyhealth.app`
   so native Apple tokens verify too.
6. **Push**: upload an APNs key and (Android) FCM credentials via `eas credentials`.
7. **Google Play**: create the app, a service account with release access, save its key
   as `mobile/google-play-service-account.json` (git-ignored).

## Build and submit

```bash
cd mobile
npm run build:ios && npx eas submit -p ios --latest
npm run build:android && npx eas submit -p android --latest
```

Native modules (BLE, HealthKit, Health Connect, vision camera) need these
EAS builds; Expo Go cannot run them.

## Store listing checklist

- **Privacy policy URL** (required by both stores) - host one that matches
  `docs/security/privacy-and-ai-processing.md`.
- **App Privacy / Data safety forms**: health & fitness data, photos, contact
  info (email), identifiers; data is encrypted, linked to the user, deletable
  in-app; AI processing only with consent.
- **Health apps**: Apple needs the HealthKit justification text (steps, and
  workout heart rate only when switched on); Google needs the Health
  Connect permissions declaration form.
- **Medical disclaimer**: state in the description that the app does not
  diagnose and is not a substitute for a clinician.
- **Screenshots**: iPhone 6.9", iPad 13", Android phone and 10" tablet.
- **Review account**: Guest sign-in works with no credentials; say so in the
  review notes.

## Known follow-ups (not done here)

- Native Google sign-in on Android (needs an Android OAuth client and
  `@react-native-google-signin/google-signin`); Android users sign in as guest
  or via web until then.
- Tablet two-pane layouts (list + detail) and a sidebar tab bar; the current
  change is a readable-width cap only.
- Health Connect needs the permissions-rationale activity declared for Play
  review; verify on a device build.
- Not tested on real devices or simulators here.
