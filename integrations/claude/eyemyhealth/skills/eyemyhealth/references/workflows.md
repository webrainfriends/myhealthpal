# Workflows

Short recipes. Tool names are exact.

## "Give me an overview of my health"
1. `get_dashboard_snapshot` - pinned metrics, what needs attention, active insights.
2. `get_organ_health` - how each organ group's latest results sit against range.
3. Summarise: what is in range, what is not (value, unit, date, report), what is worth raising with a clinician. Offer to dig into any item.

## "How has my <test> changed?"
1. If you do not know the code, `search_reports` with the test name, or `get_needs_attention` to see codes in use.
2. `get_measurement_trend` with the parameter code and a `range` (for example 6m or 1y).
3. Report direction, first and latest values with dates, and the range. State how many data points the trend rests on.

## "Compare my last two reports"
1. `list_timeline` to find the two report ids (newest first).
2. `compare_reports` with both ids. Only shared parameters are compared - say so if something is missing from one.

## "Is my medicine okay / when do I run out?"
1. `list_medications`, then `get_medication_detail` for the one asked about.
2. `list_medication_alerts` for expiry, refill and course-end warnings.
3. Do not advise changing the dose or stopping. Suggest the prescriber or pharmacist for those questions.

## "Log my morning dose / 2 glasses of water / lunch"
1. `get_medication_reminders` to get the exact slot names for a dose, then `log_medication_dose` (status `taken`, `skipped` or `undo`).
2. `log_water` with `amountMl` (a glass is about 250 ml unless they say otherwise).
3. `log_meal` with the name and meal type; add calories only if they gave a figure.
4. Say what was saved.

## "When should I retest?"
1. `list_retest_plans` - due dates, status, test-day `prepTips` (fasting etc.) and booking link.
2. `retest_checkin` to tick this week's small action when they say they did it; `snooze_retest` to push a reminder out.

## "Does my insurance cover this?"
1. `get_insurance_overview` - policies and the coverage tag on each result, plus gaps.
2. `get_insurance_policy` for the clauses behind a tag (ceiling, co-pay, waiting period).
3. Present it as what the policy text says; they should confirm with their insurer or agent.

## "Add this report / policy / meal photo"
1. `create_upload_link` (optionally with a `category`).
2. Give them the link; wait for them to say it is done.
3. `list_timeline` or `get_insurance_overview` to confirm it arrived.

## "Delete this"
Follow the two-step in SKILL.md. Show the exact `summary` and ask for confirmation first.

## A family member
`list_profiles` -> choose -> pass `profileId` on every call that is about them. If a call says `consent_required`, that person (or whoever looks after them) has to turn on AI apps in EyeMyHealth > Settings > Privacy & AI for that profile.
