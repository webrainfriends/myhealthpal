const pool = require('../db/pool');
const { pendingInsuranceReminders, policyLabel } = require('./insuranceRules');
const { sendExpoPush, SEND_WINDOW_UTC } = require('../retest/retestReminderService');

// Premium and renewal reminders for confirmed policies, pushed to the
// account's devices (and to caregivers following the profile) - the same
// hourly, once-per-period pattern as retest/retestReminderService.js.

function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `${currency ? `${currency} ` : ''}${n.toLocaleString('en-IN')}`;
}

function buildMessage(pending, profile = null) {
  const [first] = pending;
  const name = policyLabel(first.policy);
  const whose = profile ? `${profile.name}'s ` : '';
  let title;
  let body;
  if (first.kind === 'premium_due') {
    title = `${whose}${name} premium is due`;
    body = first.amount ? `${money(first.amount, first.policy.currency)} is due - pay before the grace period ends to keep cover active.` : 'Pay before the grace period ends to keep cover active.';
  } else if (first.kind === 'premium_14d') {
    title = `${whose}${name} premium due in ${first.daysLeft} day${first.daysLeft === 1 ? '' : 's'}`;
    body = first.amount ? `${money(first.amount, first.policy.currency)} is coming up.` : 'A premium instalment is coming up.';
  } else if (first.kind === 'renewal_7d') {
    title = `${whose}${name} renews in ${first.daysLeft} day${first.daysLeft === 1 ? '' : 's'}`;
    body = 'Check the renewal terms and any changes to your cover.';
  } else {
    title = `${whose}${name} renews in ${first.daysLeft} days`;
    body = 'A good time to review your cover and ask your insurer about any changes.';
  }
  if (pending.length > 1) body += ` (+${pending.length - 1} more in My Insurance)`;
  return { title, body, data: { screen: 'Insurance', policyId: first.policy.id, profileId: profile ? profile.id : null } };
}

async function runInsuranceReminders({ today = new Date(), send = sendExpoPush, ignoreSendWindow = false } = {}) {
  const hour = today.getUTCHours();
  if (!ignoreSendWindow && (hour < SEND_WINDOW_UTC.start || hour >= SEND_WINDOW_UTC.end)) return { sent: 0 };

  // Same audience rule as Retest Radar: each account about its own policies,
  // plus caregivers about the people they follow - for accounts with a
  // device and insurance reminders switched on.
  const { rows: recipients } = await pool.query(
    `SELECT r.member_id, r.recipient_id, m.display_name AS member_name, array_agg(pt.token) AS tokens
     FROM (
       SELECT id AS member_id, id AS recipient_id FROM users
       UNION
       SELECT member_user_id, owner_user_id FROM family_links
     ) r
     JOIN users m ON m.id = r.member_id
     JOIN users rc ON rc.id = r.recipient_id AND rc.insurance_reminders_enabled = true
     JOIN push_tokens pt ON pt.user_id = r.recipient_id
     WHERE EXISTS (SELECT 1 FROM insurance_policies ip WHERE ip.user_id = r.member_id AND ip.ingestion_status = 'Completed')
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
      const { rows: policies } = await pool.query(
        `SELECT * FROM insurance_policies WHERE user_id = $1 AND ingestion_status = 'Completed'`,
        [memberId]
      );
      const { rows: sentRows } = await pool.query(
        `SELECT policy_id, kind, period FROM insurance_reminders_sent WHERE policy_id = ANY($1)`,
        [policies.map((p) => p.id)]
      );
      const alreadySent = new Set(sentRows.map((r) => `${r.policy_id}:${r.kind}:${String(r.period).slice(0, 10)}`));
      const pending = pendingInsuranceReminders(policies, alreadySent, today);
      if (pending.length === 0) continue;

      for (const recipient of memberRecipients) {
        const profile = recipient.recipient_id === memberId ? null : { id: memberId, name: recipient.member_name || 'Family member' };
        await send(recipient.tokens, buildMessage(pending, profile));
        sent += 1;
      }
      for (const item of pending) {
        await pool.query(
          `INSERT INTO insurance_reminders_sent (policy_id, kind, period) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [item.policy.id, item.kind, item.period]
        );
      }
    } catch (err) {
      // One profile's failure must not stop everyone else's reminders;
      // unsent items are retried next run.
      // eslint-disable-next-line no-console
      console.error(`Insurance reminders failed for profile ${memberId}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { runInsuranceReminders, buildMessage };
