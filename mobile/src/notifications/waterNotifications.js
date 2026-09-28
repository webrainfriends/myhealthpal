import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// A daily local nudge to log water intake - unlike Retest Radar's reminders
// (retestNotifications.js), there's no per-user server data to compute here
// (just "did you log water today"), so this is local-only: no push-token
// registration, no server-side reminder job, just one repeating local
// notification the device schedules for itself. See retestNotifications.js
// for the fuller write-up of why local vs. server push is chosen per feature.

const WATER_REMINDER_ID = 'water-reminder';
const REMINDER_HOUR = 15; // one afternoon check-in, not a stream of nudges

if (Platform.OS !== 'web') {
  // Idempotent with retestNotifications.js's own call (both modules load at
  // app start and set the same handler) - harmless to set twice.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// Cancels then (if enabled) reschedules the single repeating reminder - the
// same cancel-then-rebuild shape syncLocalRetestReminders uses, just for one
// fixed daily notification instead of one per plan/milestone.
export async function syncWaterReminder(enabled) {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(WATER_REMINDER_ID).catch(() => {});
    if (!enabled) return;
    if (!(await ensurePermission())) return;

    await Notifications.scheduleNotificationAsync({
      identifier: WATER_REMINDER_ID,
      content: {
        title: 'Time for a water check-in',
        body: "Log how much water you've had today.",
        data: { screen: 'Diet' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, hour: REMINDER_HOUR, minute: 0, repeats: true },
    });
  } catch (err) {
    console.warn('Could not schedule the water reminder', err.message);
  }
}

// Opens the Diet screen when the user taps the reminder. Returns an
// unsubscribe function.
export function onWaterNotificationTap(navigate) {
  if (Platform.OS === 'web') return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.screen === 'Diet') navigate('Diet');
  });
  return () => subscription.remove();
}
