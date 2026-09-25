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

// One combined notification per profile per run, led by the most urgent
// item, so several plans never turn into a burst of separate pushes.
// `profile` is set when the recipient is a caregiver (a family_links owner)
// rather than the person the plans belong to.
function buildMessage(allPending, profile = null) {
  const pending = allPending.filter((item) => !item.silent);
  const [first] = pending;
  const name = first.plan.parameterDisplayName;
  const whose = profile ? `${profile.name}'s` : 'your';
  let title;
  let body;
  if (first.kind === 'due') {
    title = `Time to recheck ${whose} ${name}`;
    body = 'The recheck date is here. Book the test and upload the report when it arrives.';
  } else if (first.kind === 'two_weeks') {
    title = `${profile ? `${profile.name}'s ` : ''}${name} recheck in ${first.plan.daysLeft} days`;
    body = 'Plan the lab visit now so it fits the week.';
  } else {
    title = `This week for ${whose} ${name}`;
    body = first.plan.microAction;
  }
  if (pending.length > 1) body += ` (+${pending.length - 1} more in Retest Radar)`;
  return { title, body, data: { screen: 'RetestRadar', planId: first.plan.id, profileId: profile ? profile.id : null } };
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

  // Who hears about whose plans: every account about its own, plus every
  // caregiver (family_links owner, manage or view) about each member they
  // follow - e.g. a son abroad gets "Dad: Time to recheck your HbA1c".
  // Only recipients with a device and reminders switched on count.
  const { rows: recipients } = await pool.query(
    `SELECT r.member_id, r.recipient_id, m.display_name AS member_name, array_agg(pt.token) AS tokens
     FROM (
       SELECT id AS member_id, id AS recipient_id FROM users
       UNION
       SELECT member_user_id, owner_user_id FROM family_links
     ) r
     JOIN users m ON m.id = r.member_id
     JOIN users rc ON rc.id = r.recipient_id AND rc.retest_reminders_enabled = true
     JOIN push_tokens pt ON pt.user_id = r.recipient_id
     GROUP BY r.member_id, r.recipient_id, m.display_name`
  );
  const byMember = new Map();
  for (const row of recipients) {
    if (!byMember.has(row.member_id)) byMember.set(row.member_id, []);
    byMember.get(row.member_id).push(row);
  }

  let sent = 0;
  for (const [memberId, memberRecipients] of byMember) {
    try {
      await recomputeForUser(memberId);
      const plans = await listVisiblePlans(memberId, today);
      if (plans.length === 0) continue;

      const { rows: sentRows } = await pool.query(
        `SELECT plan_id, kind, period FROM retest_reminders_sent WHERE plan_id = ANY($1)`,
        [plans.map((p) => p.id)]
      );
      const alreadySent = new Set(sentRows.map((r) => `${r.plan_id}:${r.kind}:${r.period}`));
      const pending = pendingReminders(plans, alreadySent, today);
      if (pending.length === 0) continue;

      for (const recipient of memberRecipients) {
        const profile =
          recipient.recipient_id === memberId ? null : { id: memberId, name: recipient.member_name || 'Family member' };
        await send(recipient.tokens, buildMessage(pending, profile));
        sent += 1;
      }
      for (const item of pending) {
        await pool.query(
          `INSERT INTO retest_reminders_sent (plan_id, kind, period) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [item.plan.id, item.kind, item.period]
        );
      }
    } catch (err) {
      // One profile's failure (bad token batch, network blip) must not stop
      // everyone else's reminders; unsent items are retried next run.
      // eslint-disable-next-line no-console
      console.error(`Retest reminders failed for profile ${memberId}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { runReminders, pendingReminders, buildMessage, SEND_WINDOW_UTC };
