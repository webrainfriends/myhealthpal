import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from '../api/client';
import { parseCalendarDate } from '../utils/date';

// Retest Radar reminders. The server sends push reminders (see
// server/src/retest/retestReminderService.js) once this device's Expo push
// token is registered. When that isn't possible - web, a simulator, a build
// without an EAS projectId, or a failed registration - the same reminders
// are scheduled as local notifications instead, so the user still gets them
// (never both, which would double every reminder).

const LOCAL_ID_PREFIX = 'retest-';
const LOCAL_REMINDER_HOUR = 9;

let serverPushActive = false;

if (Platform.OS !== 'web') {
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

// Called once per signed-in session. Resolves to whether the server can now
// push to this device; never throws - reminders are a nice-to-have and must
// not break sign-in.
export async function registerForRetestPush() {
  serverPushActive = false;
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    if (!(await ensurePermission())) return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token, Platform.OS);
    serverPushActive = true;
  } catch (err) {
    console.warn('Push registration failed; falling back to local reminders', err.message);
  }
  return serverPushActive;
}

function reminderDate(dueDate, daysBefore) {
  const due = parseCalendarDate(dueDate);
  if (!due) return null;
  const at = new Date(due.getFullYear(), due.getMonth(), due.getDate() - daysBefore, LOCAL_REMINDER_HOUR);
  return at.getTime() > Date.now() ? at : null;
}

// Re-schedules this device's local reminders for one profile's plans
// (`profile` is the family member being viewed, or null for the account's
// own), leaving other profiles' reminders alone. A no-op when the server is
// pushing, and on web.
export async function syncLocalRetestReminders(plans, { enabled, t, profile = null }) {
  if (Platform.OS === 'web' || serverPushActive) return;
  const prefix = `${LOCAL_ID_PREFIX}${profile ? profile.id : 'self'}-`;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(prefix))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    if (!enabled || plans.length === 0) return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;

    for (const plan of plans) {
      const name = profile ? `${profile.displayName} · ${plan.parameterDisplayName}` : plan.parameterDisplayName;
      const reminders = [
        { key: 'two_weeks', date: reminderDate(plan.dueDate, 14), title: t('retest.pushTwoWeeksTitle', { name }) },
        { key: 'due', date: reminderDate(plan.dueDate, 0), title: t('retest.pushDueTitle', { name }) },
      ];
      for (const reminder of reminders) {
        if (!reminder.date) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: `${prefix}${plan.id}-${reminder.key}`,
          content: {
            title: reminder.title,
            body: reminder.key === 'due' ? t('retest.pushDueBody') : plan.microAction,
            data: { screen: 'RetestRadar', planId: plan.id, profileId: profile ? profile.id : null },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.date },
        });
      }
    }
  } catch (err) {
    console.warn('Could not schedule local retest reminders', err.message);
  }
}

// Opens Retest Radar when the user taps one of these reminders. Returns an
// unsubscribe function.
export function onRetestNotificationTap(navigate) {
  if (Platform.OS === 'web') return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.screen === 'RetestRadar') navigate('RetestRadar', data);
  });
  return () => subscription.remove();
}
