const pool = require('../db/pool');
const { recomputeForUser, listVisiblePlans } = require('./retestService');
const { reminderKind, weekStart } = require('./retestRules');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Reminders only go out in a daytime window (UTC hours, inclusive start /
// exclusive end). 03-15 UTC is ~8:30am-8:30pm in India and ~7am-7pm in the
// Gulf, the launch markets; the job itself may run at any hour.
const SEND_WINDOW_UTC = { start: 3, end: 15 };

const KIND_PRIORITY = { due: 0, two_weeks: 1, weekly_tip: 2 };

// Picks what (if anything) each plan warrants today, most urgent first.
// Pure, so the policy is testable without a database or network.
function pendingReminders(plans, alreadySent, today = new Date()) {
  const week = weekStart(today);
  const pending = [];
  for (const plan of plans) {
    const tipDue = !plan.checkedInThisWeek && !alreadySent.has(`${plan.id}:weekly_tip:${week}`);
    const kind = reminderKind(plan.dueDate, today);
    if (kind && !alreadySent.has(`${plan.id}:${kind}:${plan.dueDate}`)) {
      pending.push({ plan, kind, period: plan.dueDate });
      // The date reminder stands in for this week's tip - recorded as sent
      // but not shown, so the user doesn't get a second push the next day.
      if (tipDue) pending.push({ plan, kind: 'weekly_tip', period: week, silent: true });
      continue;
    }
    if (tipDue) pending.push({ plan, kind: 'weekly_tip', period: week });
  }
  pending.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.plan.daysLeft - b.plan.daysLeft);
  return pending;
}

// One combined notification per user per run, led by the most urgent item,
// so several plans never turn into a burst of separate pushes.
function buildMessage(allPending) {
  const pending = allPending.filter((item) => !item.silent);
  const [first] = pending;
  const name = first.plan.parameterDisplayName;
  let title;
  let body;
  if (first.kind === 'due') {
    title = `Time to recheck your ${name}`;
    body = 'Your recheck date is here. Book the test and upload the report when it arrives.';
  } else if (first.kind === 'two_weeks') {
    title = `${name} recheck in ${first.plan.daysLeft} days`;
    body = 'Plan your lab visit now so it fits your week.';
  } else {
    title = `This week for your ${name}`;
    body = first.plan.microAction;
  }
  if (pending.length > 1) body += ` (+${pending.length - 1} more in Retest Radar)`;
  return { title, body, data: { screen: 'RetestRadar', planId: first.plan.id } };
}

async function sendExpoPush(tokens, message) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', ...message }))),
  });
  if (!response.ok) throw new Error(`Expo push failed with HTTP ${response.status}`);
  const payload = await response.json();
  // A token Expo reports as no longer registered will never work again.
  const tickets = Array.isArray(payload.data) ? payload.data : [];
  const stale = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
  if (stale.length > 0) await pool.query('DELETE FROM push_tokens WHERE token = ANY($1)', [stale]);
}

async function runReminders({ today = new Date(), send = sendExpoPush, ignoreSendWindow = false } = {}) {
  const hour = today.getUTCHours();
  if (!ignoreSendWindow && (hour < SEND_WINDOW_UTC.start || hour >= SEND_WINDOW_UTC.end)) return { sent: 0 };

  const { rows: users } = await pool.query(
    `SELECT u.id, array_agg(pt.token) AS tokens
     FROM users u JOIN push_tokens pt ON pt.user_id = u.id
     WHERE u.retest_reminders_enabled = true
     GROUP BY u.id`
  );

  let sent = 0;
  for (const user of users) {
    try {
      await recomputeForUser(user.id);
      const plans = await listVisiblePlans(user.id, today);
      if (plans.length === 0) continue;

      const { rows: sentRows } = await pool.query(
        `SELECT plan_id, kind, period FROM retest_reminders_sent WHERE plan_id = ANY($1)`,
        [plans.map((p) => p.id)]
      );
      const alreadySent = new Set(sentRows.map((r) => `${r.plan_id}:${r.kind}:${r.period}`));
      const pending = pendingReminders(plans, alreadySent, today);
      if (pending.length === 0) continue;

      await send(user.tokens, buildMessage(pending));
      for (const item of pending) {
        await pool.query(
          `INSERT INTO retest_reminders_sent (plan_id, kind, period) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [item.plan.id, item.kind, item.period]
        );
      }
      sent += 1;
    } catch (err) {
      // One user's failure (bad token batch, network blip) must not stop
      // everyone else's reminders; unsent items are retried next run.
      // eslint-disable-next-line no-console
      console.error(`Retest reminders failed for user ${user.id}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { runReminders, pendingReminders, buildMessage, SEND_WINDOW_UTC };
