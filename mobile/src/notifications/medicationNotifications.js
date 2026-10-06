import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { fetchMedicationReminders, logMedicationDose } from '../api/client';
import { getSetting, setSetting } from '../utils/localSettings';
import { dateKey, planDoseNotifications } from './dosePlan';

// Dose reminders as local notifications with Taken / Snooze / Skip buttons.
// Apple Watch mirrors an iPhone notification (buttons included) and Wear OS
// bridges an Android one, so this is also what puts the reminder on a wrist
// even without the watch app. The dedicated watch apps add the glance screens.
//
// Reminders are one-shot and re-planned from the server's list whenever the
// app opens or a dose is logged (see dosePlan.js), so a dose that is already
// taken never fires. Only the signed-in account's own medicines are scheduled;
// a family member's reminders stay on their own device.

const CATEGORY_ID = 'dose-reminder';
const ACTION_TAKEN = 'dose-taken';
const ACTION_SNOOZE = 'dose-snooze';
const ACTION_SKIP = 'dose-skip';
const SNOOZE_MINUTES = 10;
const SETTING_KEY = 'doseRemindersEnabled';

export function doseRemindersEnabled() {
  return getSetting(SETTING_KEY, true) !== false;
}

export function setDoseRemindersEnabled(enabled) {
  setSetting(SETTING_KEY, !!enabled);
}

async function ensurePermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

let categoryReady = false;
async function ensureCategory(t) {
  if (categoryReady) return;
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    { identifier: ACTION_TAKEN, buttonTitle: t('doseReminder.taken'), options: { opensAppToForeground: false } },
    { identifier: ACTION_SNOOZE, buttonTitle: t('doseReminder.snooze', { minutes: SNOOZE_MINUTES }), options: { opensAppToForeground: false } },
    { identifier: ACTION_SKIP, buttonTitle: t('doseReminder.skip'), options: { opensAppToForeground: false, isDestructive: true } },
  ]);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('doses', {
      name: t('doseReminder.channel'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  categoryReady = true;
}

function content(item, t) {
  const food = item.foodRelation ? ` · ${t(`doseReminder.food.${item.foodRelation}`)}` : '';
  return {
    title: t('doseReminder.title', { name: item.name }),
    body: `${t('doseReminder.body')}${food}`,
    categoryIdentifier: CATEGORY_ID,
    data: { screen: 'MedicationsTab', medicationId: item.medicationId, name: item.name, slot: item.slot, date: item.date, foodRelation: item.foodRelation || null },
    ...(Platform.OS === 'android' ? { channelId: 'doses' } : {}),
  };
}

// Cancels this module's pending reminders and schedules the current plan.
// `enabled: false` just cancels. Never throws - a reminder is a nice-to-have.
export async function syncDoseReminders({ t, enabled = doseRemindersEnabled() }) {
  if (Platform.OS === 'web') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => String(n.identifier).startsWith('dose|'))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    if (!enabled || !(await ensurePermission())) return;

    await ensureCategory(t);
    const now = new Date();
    const { reminders } = await fetchMedicationReminders(dateKey(now));
    for (const item of planDoseNotifications(reminders, now)) {
      await Notifications.scheduleNotificationAsync({
        identifier: item.id,
        content: content(item, t),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.at },
      });
    }
  } catch (err) {
    console.warn('Could not schedule dose reminders', err.message);
  }
}

async function snooze(data, t) {
  const at = new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000);
  await Notifications.scheduleNotificationAsync({
    identifier: `dose|${data.medicationId}|${data.date}|${data.slot}|snooze`,
    content: content(data, t),
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

// Handles a tap on the reminder or one of its buttons, from the phone or a
// mirrored watch. `navigate` opens a screen for a plain tap. Returns an
// unsubscribe function.
export function onDoseNotificationResponse(navigate, t) {
  if (Platform.OS === 'web') return () => {};

  // The launch-time lookup can return a response this session already saw.
  const seen = new Set();
  async function handle(response) {
    const request = response.notification.request;
    const key = `${request.identifier}|${response.actionIdentifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    const data = request.content.data;
    if (request.content.categoryIdentifier !== CATEGORY_ID || !data?.medicationId) return;

    try {
      if (response.actionIdentifier === ACTION_TAKEN || response.actionIdentifier === ACTION_SKIP) {
        const status = response.actionIdentifier === ACTION_TAKEN ? 'taken' : 'skipped';
        await logMedicationDose(data.medicationId, data.slot, status, data.date);
        await syncDoseReminders({ t });
      } else if (response.actionIdentifier === ACTION_SNOOZE) {
        await snooze(data, t);
      } else if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        navigate(data.screen || 'MedicationsTab');
      }
    } catch (err) {
      console.warn('Could not handle the dose reminder action', err.message);
    }
  }

  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  // An action tapped while the app was closed is delivered at launch.
  Notifications.getLastNotificationResponseAsync?.().then((last) => last && handle(last)).catch(() => {});
  return () => subscription.remove();
}
