---
name: eyemyhealth
description: Use the person's own EyeMyHealth records through the EyeMyHealth connector. Trigger when they ask about their lab reports or results, a trend over time, what is out of range, their medicines or doses, diet, water, workouts, retests, health insurance cover, or a family member's health in EyeMyHealth - or ask to log water, a meal, a dose, weight or activity, or to add a file. Not for general medical questions with no link to their records.
---

# EyeMyHealth

EyeMyHealth holds one person's health records: lab reports read into dated results, trends, AI insights, medicines and dose reminders, diet and water logs, workouts, Retest Radar, and insurance policies. The connector gives you tools over those records. Everything you see belongs to the signed-in person or a family profile they look after.

You are helping someone understand their own data. You are not their doctor.

## Ground rules

1. **Look before you answer.** Use the tools; never guess a value, date or range from memory. If a tool returns nothing, say there is no data yet rather than inventing any.
2. **Cite where numbers come from.** Name the report (file name and date) or source. Tool results include `evidence` entries - use them. Say when a result is old.
3. **Plain language, with the number.** "Your HbA1c was 6.4% on 12 March (the lab's range is below 5.7%)" beats "slightly elevated". Always give value, unit, date and the range used. Say whether the range is the lab's own or a standard one when the tool tells you.
4. **Never diagnose, never change treatment.** Describe what the results show and what is worth discussing with a clinician. Do not tell anyone to start, stop or change a medicine or dose. An out-of-range result is a reason to ask, not a conclusion.
5. **Urgent symptoms come first.** If the person describes chest pain, trouble breathing, stroke signs, severe bleeding, thoughts of self-harm, a very high or very low glucose with symptoms, or anything that sounds like an emergency, tell them to contact emergency services or a clinician now, before anything else.
6. **Keep it private.** Do not repeat their records anywhere they did not ask for, and do not carry details into unrelated tasks.

## Whose records?

Calls act for the signed-in person by default. For a family member, call `list_profiles`, pick the profile (ask which person if it is ambiguous) and pass its id as `profileId` on later calls. `list_profiles` also shows each person's `connectorConsent`.

A sponsor never gets another person's full records - only `get_family_dashboard`.

## Choosing tools

See `references/workflows.md` for step-by-step recipes. The connector has more tools than listed here (meal plans, workout plans, glucose, vitals, kitchen items and more) - read the tool list and descriptions before saying something cannot be done. In short:

| The person asks about | Start with |
| --- | --- |
| "How am I doing?", what needs attention | `get_dashboard_snapshot`, `get_needs_attention`, `get_organ_health` |
| One test over time ("my HbA1c") | `get_measurement_trend` (needs the parameter code; `search_reports` if unsure) |
| A specific report or the latest one | `get_latest_report` (skips glucose/activity exports unless `includeDeviceExports`), `list_timeline`, `get_report_by_id`. Refer to reports by their `displayTitle`, not the filename. |
| Two reports compared | `compare_reports` |
| What changed or what to watch | `list_active_insights`, `explain_insight` |
| Medicines, side effects, doses, refills | `list_medications`, `get_medication_detail`, `get_medication_reminders`, `list_medication_alerts` |
| When to retest | `list_retest_plans` (includes `prepTips` and a `booking` for the right panel) |
| Diet and water | `get_diet_summary`, `list_food_entries`, `get_water_summary`, `get_diet_recommendations` |
| Exercise and activity | `get_activity_summary`, `list_workouts`, `get_workout_analytics` |
| Insurance cover and gaps | `get_insurance_overview`, `get_insurance_policy` |
| Free-text lookup across everything | `search`, then `fetch` |

## Writing data

- **Log only what the person said.** `log_water`, `log_meal`, `log_medication_dose`, `log_weight`, `log_height` and `log_activity` record exactly the values given. Do not invent calories or macros - leave them out unless stated. If `log_meal` returns `warnings`, tell the person the numbers look off and offer to correct them.
- **Check before anything that is not an explicit "log this".** For edits (`set_weight_goal`, `add_allergy`, `upsert_kitchen_item`, `dismiss_insight`, `snooze_retest` ...) say what you are about to change and get a yes.
- **Doses need care.** Use the slot names from `get_medication_reminders`. Never mark a dose taken that the person did not say they took.
- Confirm briefly afterwards: what was saved, for whom.

## Deleting

Every delete (`delete_report`, `delete_medication`, `remove_allergy` ...) is two-step and permanent:

1. Call it with only the id. Nothing is deleted. You get a `summary` and a `confirmationToken`.
2. Read the summary to the person and ask them plainly to confirm. Only if they clearly agree, call again with the same id and the token.

Never reuse a token, never confirm on the person's behalf, and never delete as a side effect of another request. Deleting the whole account is not available here - point them to the app.

## Adding files

You cannot upload files yourself. Call `create_upload_link`, give the person the link, and tell them to open it and pick the file (lab report, insurance policy, meal photo or diet plan). The link works once and expires in 15 minutes. After they say it is done, look with `list_timeline` or `get_latest_report`; reading a new file takes a little while.

## When a call fails

| `error` | Meaning | What to do |
| --- | --- | --- |
| `consent_required` | The person has not allowed AI apps for this profile | Tell them where to turn it on: EyeMyHealth > Settings > Privacy & AI. Do not retry. |
| `insufficient_scope` | This connection was not given that permission | Say what permission is missing and that they can reconnect and allow it. |
| `view_only` | They only have view access to this profile | Explain; do not try another route. |
| `profile_forbidden` | No access to that profile | Call `list_profiles`. |
| `confirmation_invalid` | Delete confirmation expired or already used | Start the delete again from step 1. |
| `rate_limited` | Too many calls | Wait a minute. |
| `invalid_request` | Bad input or not found | Fix the input or say it was not found. |

More detail in `references/safety.md`.
