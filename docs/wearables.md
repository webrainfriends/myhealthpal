# Apple Watch and Wear OS

Status: phone, server and watch sources are written. The phone and server parts are tested. The two watch apps have **not been compiled or run** (no Xcode or Android SDK was available when they were written), so treat them as a first draft to build and try on a device.

## What a watch can do (first release)

- See today's doses and mark them Taken or Skipped.
- Log water (crown / bezel changes the amount) and, on Apple Watch, weight.
- See progress rings. Offline actions are queued and sent when the connection returns.
- For a family profile it is read-only.

Not built yet: meal log by voice, workouts, vitals screen, watch-face complications and Wear OS tiles, weight on Wear OS.

## How it fits together

```
Watch app ──(scoped token, REST)──> server ──> same data as the phone
   ▲
   └── pairing: watch shows a 6-digit code, the phone app approves it
```

- **Pairing, no password.** `POST /api/watch/pair/start` returns a code; the phone calls `POST /api/watch/pair/confirm`; the watch polls `POST /api/watch/pair/poll` and receives its token once. Code lifetime 5 minutes, wrong-code attempts are rate limited. (`server/src/routes/watch.js`, `server/src/services/watchService.js`, migration `042`.)
- **Limited token.** The watch token is a JWT with `scope: 'watch'` and a 90-day life. `server/src/middleware/auth.js` lets it call only the routes in `WATCH_ALLOWED` and checks its `watch_pairings` row on every request, so **Remove** on the phone (More → Watch) signs the watch out immediately. Account, family, reports and file routes are refused.
- **No duplicates offline.** `POST /api/water/entries` accepts `client_entry_id`; a retry returns the original entry.
- **Dose reminders without a watch app.** The phone schedules local notifications with Taken / Snooze / Skip buttons (`mobile/src/notifications/medicationNotifications.js`, planning in `dosePlan.js`). Apple Watch mirrors them and Wear OS bridges them. A button tapped while the app is closed relies on the OS starting the app in the background, which iOS and Android do not always allow; if it fails the dose stays pending.
- **Sign-in now persists on native.** `tokenStorage.js` uses `expo-secure-store` (Keychain / Keystore) so the app, and a notification button, can reach the API after a restart. Previously the native token lived in memory only.

## Building the Apple Watch app

Sources: `mobile/targets/watch/` (SwiftUI, watchOS 10+).

1. `cd mobile && npx expo install @bacons/apple-targets`
2. Add `"@bacons/apple-targets"` to `plugins` in `mobile/app.json`.
3. `npx expo prebuild --platform ios`, open the workspace in Xcode, set the team, run the watch scheme.
4. In App Store Connect, add the watch app to the existing EyeMyHealth record (see `docs/mobile-release.md`).

## Building the Wear OS app

Sources: `mobile/wearables/android/` (standalone Android Studio project, Compose for Wear OS, min SDK 30).

1. Open `mobile/wearables/android` in Android Studio and run the `wear` configuration on a Wear OS emulator or watch.
2. `applicationId` matches the phone app so Google Play can ship both from one listing; upload it as a Wear OS form factor in the Play Console.
3. Set `API_BASE_URL` in `wear/build.gradle.kts` for non-production servers.

## Checks

- Server: `cd server && node --test test/watch.routes.test.js` (needs `DATABASE_URL`). Covers pairing, one-time token, allow-list, revoke and water idempotency.
- Phone: `cd mobile && node --test` (includes `dosePlan.test.js`).
- Manual: pair a watch, log water in airplane mode, reconnect and confirm one entry; remove the watch on the phone and confirm it signs out.
