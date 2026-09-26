# EyeMyHealth

A light-themed React Native (Expo) app on top of an Express + PostgreSQL API,
covering:

- Universal health report upload and document ingestion
  ([issue #1](https://github.com/webrainfriends/myhealthpal/issues/1)).
- AI extraction and normalization of health parameters into a longitudinal,
  provider-agnostic dataset
  ([issue #2](https://github.com/webrainfriends/myhealthpal/issues/2)).
- A dated timeline with versioned, plain-language AI report summaries
  ([issue #3](https://github.com/webrainfriends/myhealthpal/issues/3)).
- A personal dashboard with pinned metrics, trends, and drill-down to source
  ([issue #4](https://github.com/webrainfriends/myhealthpal/issues/4)).
- AI-generated longitudinal health insights with evidence links and a
  dismiss/feedback lifecycle
  ([issue #11](https://github.com/webrainfriends/myhealthpal/issues/11)).
- A retrieval-grounded conversational assistant over the user's own data
  ([issue #10](https://github.com/webrainfriends/myhealthpal/issues/10)).
- AI photo-based diet tracking: scan a meal to identify items and estimate
  calories/macros, auto-tagged by meal (breakfast/lunch/snack/dinner/supper)
  from the time logged, plus a pattern analysis with recommendations that
  considers the user's confirmed lab results and active medications.
- Retest Radar: a "check again by" countdown for every out-of-range result
  and every medicine linked to a lab value, a small weekly action to tick
  off until then, and push reminders two weeks before and on the date
  (see "Retest Radar" below).
- Family Health Eye: one account looks after parents and family members.
  It can add a "managed" profile for someone who won't use the app, or
  follow another account that shares itself with an invite code (view-only
  or full access). Caregivers get that person's recheck reminders too.
- Guest, Google, and Apple sign-in, with every user's reports, timeline,
  dashboard, insights, and chat history strictly scoped to their own signed-in
  session and never visible to anyone else.

## Structure

- `server/` — Node.js/Express API, PostgreSQL schema, format-neutral document
  ingestion pipeline (PDF/DOCX/CSV/XLS/XLSX/JPEG/PNG).
- `mobile/` — React Native (Expo) app, light theme, upload + report review UI.

## Server

```bash
cd server
cp .env.example .env   # adjust DATABASE_URL if needed
npm install
npm run migrate        # creates schema
npm run seed           # (re)seeds the Health Parameter Registry
npm start               # listens on PORT (default 4000)
```

Requires a running PostgreSQL instance matching `DATABASE_URL`. There is no
seeded demo user anymore — every account (guest, Google, or Apple) is
created the same way real users get one, via `POST /api/auth/guest` (or the
app's "Continue as Guest" button). See "Authentication" below.

### Deploying to EC2

The repo includes a GitHub Actions workflow, `.github/workflows/deploy.yml`,
that deploys to an EC2 instance over SSH on every push to `main` (or on
demand via **Actions -> Deploy to EC2 -> Run workflow**). The API runs
directly with Node.js + pm2 - no image build needed for it. `mobile/` (the
Expo app, otherwise phone/simulator-only) is exported as a static web build
and served as the landing page - it talks to the API same-origin, through
nginx's `/api/` proxy, so it never needs to know the EC2 host's actual
address. nginx fronts both on one port: `/api/*` reverse-proxies to the
API's own internal port, everything else serves the web build. Postgres
runs in a small dedicated Docker container (the same way exambuddy's stack
on this host does) rather than the host's native PostgreSQL install, since
sharing that repeatedly hit unexplained authentication failures that a
dedicated, isolated container sidesteps.

| Setting | Value |
|---|---|
| Host | `ec2-13-250-133-109.ap-southeast-1.compute.amazonaws.com` |
| AWS region | `ap-southeast-1` |
| SSH user | `ubuntu` |
| App URL after deploy (web app + API) | `http://ec2-13-250-133-109.ap-southeast-1.compute.amazonaws.com:5250` |
| App domain (web app + API) | `https://eyemyhealth.com` (+ `www.`) — once DNS points at the host; see step 7 |
| Internal API port (nginx -> API) | `4010`, `127.0.0.1` only |
| Web build root | `/var/www/myhealthpal-web` (rewritten every deploy) |

This is the same host used by other apps in the org (each on its own port),
so the bootstrap script below is safe to re-run and won't touch an existing
Docker/nginx install or other apps'/containers' data.

One-time setup before the first deploy:

1. **Bootstrap the instance** (installs Node.js 20, pm2, Docker, nginx, and
   git) — SSH in once and run:
   ```bash
   ssh ubuntu@ec2-13-250-133-109.ap-southeast-1.compute.amazonaws.com \
     'bash -s' < scripts/bootstrap-ec2.sh
   ```
2. **Open the app port** in the instance's security group: allow inbound TCP
   **5250** (nginx) from the internet, and keep 22/SSH restricted as you
   prefer. Neither the app's own port (4010) nor Postgres's port need a
   rule — Postgres is bound to `127.0.0.1`, and 4010 simply isn't opened,
   which is what keeps it reachable only through nginx.
3. **Add a GitHub secret**: in this repo's Settings -> Secrets and variables
   -> Actions, add `EC2_SSH_KEY` containing the private key (PEM) that
   matches the EC2 instance's key pair (the same key already used for other
   apps on this host works, if it's the same instance).
4. **Optional: turn on real AI extraction.** Add a second secret,
   `ANTHROPIC_API_KEY`. With it set, every report (PDF/DOCX/CSV/XLS/XLSX
   text, or a JPEG/PNG scan via the model's vision input) is read by Claude
   instead of the local heuristic parser, pulling out every test
   parameter/value/unit/reference range/flag *and* report-level details -
   the issuing lab/facility name, the overall panel/report type, its date,
   free-text notes (fasting status, specimen condition, physician remarks),
   and any critical/panic-value alert text. Without this secret, deploys
   still work, just with the more limited local parser (tabular "name:
   value" lines only, no lab name/notes/alerts). Setting or rotating it
   takes effect on the next push - no other step needed.
5. **Optional: offer "Sign in with Google."** Create an OAuth 2.0 **Web
   application** Client ID at [Google Cloud Console -> APIs & Services ->
   Credentials](https://console.cloud.google.com/apis/credentials), with
   this deploy's URL (`http://ec2-13-250-133-109.ap-southeast-1.compute.amazonaws.com:5250`)
   added under **Authorized JavaScript origins**. Add it as a repo secret
   named `GOOGLE_CLIENT_ID`. It's not a secret value in the usual sense
   (every sign-in request sends it from the browser), but keeping it as a
   repo secret avoids hardcoding it and lets it be rotated freely. Leave
   unset to simply not offer this option - guest sign-in always still works.
6. **Optional: offer "Sign in with Apple."** Create a Services ID under
   [Apple Developer -> Certificates, Identifiers & Profiles ->
   Identifiers](https://developer.apple.com/account/resources/identifiers/list/serviceId),
   enable "Sign in with Apple" for it, and register this deploy's exact
   origin as a **Return URL**. Add the Services ID as a repo secret named
   `APPLE_CLIENT_ID`. Apple additionally requires the page to be served over
   **HTTPS** (or `localhost`) and that same origin to be domain-verified -
   the plain `http://` URL this workflow deploys to does not satisfy that,
   so the button stays hidden until the site is served over HTTPS - use
   the `https://eyemyhealth.com` origin from step 7 for this. Leave unset
   (or unmet) to simply not offer this option - guest sign-in always still
   works.
7. **The app's domain, `eyemyhealth.com`.** Every deploy also serves the
   app at `eyemyhealth.com` and `www.eyemyhealth.com` on the standard ports
   (80/443), in addition to — not instead of — the `:5250` URL above
   (`scripts/configure-domain.sh`; set `APP_DOMAIN` in
   `.github/workflows/deploy.yml` to change or disable it). It adds its own
   nginx site that forwards those hostnames to the existing `:5250` site,
   is checked with `nginx -t` and rolled back on any error, never claims
   the host's default site (other apps on ports 80/443 keep their own
   hostnames), and never fails the deploy. To make it live:
   - At your domain registrar's DNS settings, add **A records** for
     `eyemyhealth.com` (`@`) and `www` pointing to **`13.250.133.109`**
     (if that isn't an Elastic IP, allocate one first — a plain EC2 public
     IP changes whenever the instance is stopped/started).
   - In the instance's security group, allow inbound TCP **80** and
     **443** from the internet.
   - Push/re-run the deploy. The first deploy after DNS resolves to the
     host obtains a free Let's Encrypt HTTPS certificate (renewed
     automatically by certbot's timer) and redirects `http://` to
     `https://`. Until then the domain is served over plain HTTP, or skipped
     if DNS isn't pointed yet — the deploy log's `[domain]` lines say which.
   - Optional: a `LETSENCRYPT_EMAIL` repo secret for certificate expiry
     notices.
   - If you use Google sign-in, add `https://eyemyhealth.com` (and
     `https://www.eyemyhealth.com`) to the OAuth client's **Authorized
     JavaScript origins** too.

That's it — every push to `main` after that pulls the latest code, rebuilds
the web app, runs `npm ci` for the API, applies migrations, restarts the
app under pm2, and rewrites the nginx site config and extraction provider
config (plain, secret-free besides the API key itself, so they're simply
kept in sync every deploy rather than only created once). The
`myhealthpal-postgres` container
and `server/.env` (DB password, `DATABASE_URL`) are created once, directly
on the host, the first time the workflow runs, and are left untouched on
every deploy after that - the container's data lives in a named Docker
volume, so it survives redeploys.

### Authentication

Every request that touches a user's own data (reports, timeline, dashboard,
pinned parameters, insights, chat) requires a signed-in session - there is
no client-supplied user id anywhere anymore (an earlier version trusted an
`x-user-id` header outright, which let any caller read/write any other
user's data just by setting it; that no longer exists in any form).

- **Sign-in options**, all in `src/routes/auth.js`:
  - `POST /api/auth/guest` — always available, no credentials. Creates a
    brand-new anonymous account tied to this device/browser only (its token
    lives in `localStorage` on web - see `mobile/src/auth/tokenStorage.js`).
    Clearing browser storage or switching devices loses access to it; there
    is no account-recovery path for a guest, by design.
  - `POST /api/auth/google` — verifies a Google Identity Services ID token
    (`{idToken}`) against Google's own public keys via `google-auth-library`,
    server-side, and upserts a user keyed on Google's `sub` claim. Only
    active when `GOOGLE_CLIENT_ID` is configured; hidden client-side
    otherwise (`GET /api/auth/config`).
  - `POST /api/auth/apple` — verifies an Apple identity token
    (`{identityToken, fullName}`) against Apple's public JWKS via
    `jsonwebtoken`/`jwks-rsa`, and upserts a user keyed on Apple's `sub`
    claim. `fullName` is only ever sent by Apple once, client-side, on a
    person's very first authorization (never inside the token itself), so
    the client captures and forwards it that one time or it's gone for
    good. Only active when `APPLE_CLIENT_ID` is configured.
  - Every option issues the same kind of session token (a JWT signed with
    `JWT_SECRET`, `src/services/authService.js`) - there's no different
    trust level between a guest and a Google/Apple account other than what
    identity backs it.
- **Every subsequent request** sends that token as `Authorization: Bearer
  <token>`. `src/middleware/auth.js` verifies it, loads the user it belongs
  to, and attaches it as `req.user` - routes read `req.user.id`, never
  anything from the request itself, to decide whose data they're
  reading/writing. `app.js` applies this middleware to every user-data
  router; `/api/auth/*`, `/api/health-parameters` (global reference data,
  not user-specific), and `/api/config/supported-formats` are the only
  routes that don't require it.
- **No refresh-token flow or per-session revocation yet** - sessions are
  long-lived (180 days) since there's no way back in otherwise. Rotating
  `JWT_SECRET` invalidates every session at once (the only revocation
  mechanism that exists today), which the deploy workflow deliberately
  never does automatically (see "Deploying to EC2" above) since that would
  sign every user out on every deploy.
- Two providers (Google/Apple) can plausibly report the same email address
  for the same person, so accounts are never matched by email - only by
  `(auth_provider, provider_user_id)` (migration `007_auth.sql`). Email is
  informational/display data, not an identity key.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config/supported-formats` | Supported extensions + max upload size |
| `GET` | `/api/auth/config` | Which sign-in options are enabled (`googleClientId`/`appleClientId`, or `null`) |
| `POST` | `/api/auth/guest` | Create a new anonymous account, get back `{token, user}` |
| `POST` | `/api/auth/google` | Sign in with a Google ID token, `{idToken}` -> `{token, user}` |
| `POST` | `/api/auth/apple` | Sign in with an Apple identity token, `{identityToken, fullName?}` -> `{token, user}` |
| `GET` | `/api/auth/me` | The signed-in user (requires `Authorization: Bearer <token>`) |
| `GET` | `/api/reports` | List the current user's reports (requires `Authorization: Bearer <token>`, as does every route below) |
| `POST` | `/api/reports` | Upload a report (`multipart/form-data`, field `file`) |
| `GET` | `/api/reports/:id` | Report detail + extracted, normalized measurements |
| `POST` | `/api/reports/:id/retry` | Re-run ingestion + extraction after a failure |
| `PATCH` | `/api/reports/:id/measurements/:measurementId` | Correct a value/unit/date/mapping (recorded as a correction) |
| `POST` | `/api/reports/:id/confirm` | Confirm reviewed measurements, mark report Completed |
| `PATCH` | `/api/reports/:id` | Correct a report's effective date |
| `GET` | `/api/health-parameters?search=` | Search the canonical parameter registry (for mapping/pinning) |
| `GET` | `/api/timeline` | Chronological reports, filterable by date range/type/source/category/search |
| `GET` | `/api/dashboard/snapshot` | Pinned metrics + latest values, needs-attention list, recent reports |
| `GET` | `/api/dashboard/parameters/:code/trend?range=` | Time series for one canonical parameter (`7d/30d/90d/6m/1y/all`) |
| `GET`/`POST` `/api/pinned-parameters`, `DELETE .../:parameterId` | Manage the dashboard's tracked metrics |
| `GET` | `/api/insights?state=` | List insights (`active` default, or `dismissed`/`superseded`/`resolved`/`all`) |
| `POST` | `/api/insights/:id/dismiss` | Dismiss an insight |
| `POST` | `/api/insights/:id/feedback` | Record `{feedback: "useful"\|"not_useful"}` |
| `POST` | `/api/chat/sessions`, `GET /api/chat/sessions` | Create/list chat sessions |
| `GET` | `/api/chat/sessions/:id/messages` | Session message history |
| `POST` | `/api/chat/sessions/:id/messages` | Send a message, get back `{answer, evidence}` |

See "Authentication" above for how sign-in and session verification work.

### Ingestion pipeline

Upload → validate (type/size/non-empty) → store original file → create a
report row (`Uploaded`) → an in-process async job (`enqueueProcessing`, a
drop-in stand-in for a real queue like BullMQ/SQS) picks a format adapter:

- **CSV/XLSX** parse directly into rows (`csv-parse`, `exceljs`).
- **DOCX** and **text-native PDF** (`mammoth`, `pdfjs-dist`) extract raw text.
- **Scanned PDF** (little/no selectable text) and **JPEG/PNG** are flagged
  `image_scanned`. With `EXTRACTION_PROVIDER=heuristic` (default) these land
  in `Needs Review` with zero extracted values rather than fabricating
  results; with `EXTRACTION_PROVIDER=claude`, JPEG/PNG are sent to Claude's
  vision input for real OCR/document-vision extraction (scanned *PDF* pages
  still aren't rasterized, so those remain `Needs Review` either way —
  `src/extraction/providers/claudeProvider.js` is where a page-render step
  would plug in).

### Extraction & normalization (issue #2)

Every adapter's normalized document (`{contentKind, tables, text}`) is handed
to `src/extraction/extractionService.js`, which:

1. Runs the configured **provider** (`src/extraction/providers/`) to get raw
   candidates `{test_name, value, unit, reference_range, status_flag, date,
   confidence}`, plus an optional report-level `document` object
   (`{labName, reportType, reportDate, notes[], alerts[]}`). Two providers
   are implemented against the same contract:
   - `heuristic` (default): the local table-header/tokenized-line parser
     (`src/services/parameterExtractor.js`) — no external calls, no
     `document` (reading report-level details needs whole-document
     understanding, not line tokenizing).
   - `claude`: calls the Anthropic Messages API with a forced tool call
     (`record_health_parameters`) whose strict JSON schema the model output is
     validated against; only active when `ANTHROPIC_API_KEY` is set. Reads
     the issuing lab/facility name, the overall panel/report type, its date,
     free-text notes (fasting status, specimen condition, physician
     remarks), and any critical/panic-value alert text, alongside every test
     result. `document.reportDate` also feeds `reportDateService.js` as a
     fallback when no "X date:"-labeled text is found. `document.labName`/
     `reportType` persist onto `reports.source_provider`/`report_type`
     (never overwritten by a later run that didn't detect one);
     `notes`/`alerts` persist onto `reports.notes`/`alerts` the same way.
   Routing to a different LLM/document model means adding a module here —
   normalization, dedup, and persistence never change.
2. **Normalizes** each candidate against the Health Parameter Registry
   (`health_parameters` + `parameter_aliases` + `unit_conversions`,
   `src/extraction/registry.js`): matches the raw test name to a canonical
   parameter by exact code/name/alias. Zero matches → `Needs Review`,
   unmapped. More than one match → `Needs Review`, `ambiguous`, with all
   candidate IDs retained — the app never guesses between plausible medical
   interpretations. A confident match gets safe unit conversion (e.g. mmol/L
   → mg/dL) when a registered rule covers it; otherwise the original unit is
   kept and normalization is flagged rather than assumed. Values are also
   classified as `numeric` / `inequality` (`<5`, `>200`, comparator
   preserved) / `qualitative` (`Positive`, `Not Detected`, …) / `coded`.
3. **Deduplicates** against the user's other *confirmed* measurements
   (`src/extraction/dedupService.js`): same canonical parameter, same
   calendar day, same value, different report → flagged `duplicate_status:
   suspected` with a link to the earlier measurement. Nothing is ever
   deleted or silently merged.
4. **Persists** everything to `health_measurements`, always keeping the raw,
   as-printed test name/value/unit (`raw_*` columns) alongside any normalized
   fields, plus a `measurement_sources` row per measurement (provenance —
   page/section when known) and an `extraction_runs` row (provider, raw model
   output, diagnostics) for the attempt as a whole.

Every extraction run replaces the previous attempt's *unconfirmed*
measurements only — confirmed ones are immutable until the user edits them
again, so retrying a report can never duplicate a confirmed result. Editing a
measurement (`PATCH .../measurements/:id`, including overriding its canonical
mapping) writes one `measurement_corrections` row per changed field before
updating the row, so AI output vs. user correction is always distinguishable.
Confirming a report (`POST /confirm`) marks all its measurements
`is_confirmed`. Processing always ends in `Needs Review`, never straight to
`Completed` — the user reviews before anything is treated as confirmed
medical data. A failed adapter or provider (corrupt file, password-protected
PDF, unreadable legacy `.doc`, missing `ANTHROPIC_API_KEY`) never deletes the
original upload — the report moves to `Failed` with a human-readable
`processing_error` and can be retried.

### Timeline & report dating (issue #3)

After extraction, `src/extraction/reportDateService.js` looks for the
report's actual clinical date(s) — never the upload date, which is tracked
separately and never silently substituted:

1. Scans the document text for labeled dates ("Sample Date:", "Test Date:",
   "Result Date:"/"Reported on:", "Report Date:", "Consultation/Visit Date:"),
   falling back to a bare "Date:" label (lower confidence) and, failing that,
   to whatever date(s) the extracted measurements themselves carried (e.g. a
   CSV "Date" column) — agreement across multiple measurements counts for
   more than a single one.
2. Every date found is kept independently in `report_dates` (typed:
   `sample_collection`/`test`/`result`/`report_publication`/`consultation`/
   `upload`). One is chosen as `reports.effective_date` for timeline
   ordering, by priority (sample collection first, upload never eligible).
3. If nothing was found, the report is `date_status: 'Needs Review'` with no
   effective date rather than defaulting to the upload date — `PATCH
   /api/reports/:id` lets the user set/correct it (`date_status` becomes
   `'Confirmed'`).

`src/extraction/reportNarrativeService.js` generates a versioned,
plain-language summary per report (`report_summaries` /
`report_summary_versions`): what kind of report it is, what the source
itself flags as abnormal, a comparison against the user's prior *confirmed*
result for the same canonical parameter when one exists (explicitly labeled
as a comparison, never presented as the source document's own claim), and
what couldn't be confidently read. It always ends with a fixed
not-medical-advice line. Regeneration is version-gated on `reports.
data_version` (bumped by processing, measurement corrections, and
confirmation) so an unrelated report reload never re-generates for nothing.
Like extraction, it has a heuristic default and an optional Claude narrative
mode (`SUMMARY_PROVIDER=claude`).

`src/extraction/reportDedupService.js` looks at the *pattern* across a
report's measurements (not just individual ones, per issue #2's
`dedupService.js`): if most of a new report's mapped measurements turn out
to duplicate an earlier confirmed report, the new report is linked via
`likely_duplicate_of_report_id` so the timeline doesn't present it as an
independent clinical event — still fully visible, never deleted.

`GET /api/timeline` returns reports sorted by effective date (falling back
to upload date only for ordering, never presented as if it were the real
one) with per-report measurement/abnormal counts and the current narrative
summary, filterable by date range, report type, source, parameter category,
and free-text search over the filename or measurement names.

### Dashboard (issue #4)

`GET /api/dashboard/snapshot` returns three sections pulled from confirmed
measurements only: **tracked metrics** (the user's pinned canonical
parameters, each with its latest value/unit/date/source and, when
comparable, the change from the prior confirmed value — never a misleading
delta across incompatible units), **needs attention** (recent abnormal-
flagged or unresolved-review measurements, linking back to their report),
and **recent reports**. `user_pinned_parameters` tracks what's pinned;
`/api/pinned-parameters` manages it.

`GET /api/dashboard/parameters/:code/trend` returns a date-range-filtered
time series for one canonical parameter, every point still carrying its
source report id. Beyond ~60 points it's collapsed into weekly averages for
chart readability (`aggregated: true` in the response) — the underlying
per-measurement rows are untouched and still reachable by re-querying
without that threshold, so "dense" and "sparse" data are never conflated
into one misleading line.

### AI insights and change detection (issue #11)

`src/insights/insightRules.js` is a small catalog of pure, deterministic
detectors that run over a user's confirmed measurement history for one
canonical parameter at a time — every number is calculated in code, never
asked of an LLM:

- **new_result** — first-ever confirmed value for a parameter.
- **change_from_previous** — ≥15% change vs. the prior confirmed value (or
  any change in a qualitative result), with the exact percentage computed
  in code.
- **sustained_trend** — 3 consecutive confirmed values monotonically rising
  or falling.
- **new_abnormal_flag** — the source report flags a value abnormal where the
  prior confirmed result wasn't.
- **repeated_abnormal** — 3 consecutive confirmed results all flagged
  abnormal.

`src/insights/insightExplanationService.js` turns a candidate into a title +
plain-language explanation: a heuristic template by default, or (`INSIGHT_
PROVIDER=claude`) a Claude-phrased rewrite — validated by
`explanationOnlyReferencesEvidenceNumbers()`, which rejects (falls back to
the heuristic template) any generated text containing a number not present
in that candidate's own evidence data. This is deliberately strict rather
than trying to sanitize: a hallucinated number must never reach the user.

`src/insights/insightService.js` (`runForMeasurement`) is called after a
report is confirmed and after a correction to an already-confirmed
measurement (`supersedeInsightsForMeasurement` invalidates old insights
first). It dedupes via `dedup_key` — point-in-time insight types key to the
measurement itself (idempotent replays), window types (trend/repeated) key
to the parameter and only replace the active one when the evidence set
actually changed — and auto-resolves outstanding `new_abnormal_flag`/
`repeated_abnormal` insights once a parameter's value returns to normal.
Every insight stores structured `evidence` (`[{type, id}]` — never free-text
citations) so the UI can render a "view source" link, plus a `rule_version`
and `provider`/`model` when an LLM phrased it.

### Conversational health assistant (issue #10)

The chat feature never exposes the database to an LLM prompt. Instead,
`src/chat/tools.js` defines a small set of deterministic, user-scoped
retrieval functions (latest report, report by ID, compare two reports,
parameter trend with min/max/average/direction pre-calculated, date-range
search, highest/lowest in range, keyword search, explain/list insights).
**Authorization is structural, not a runtime check**: no tool's input schema
declares a user/account field, and every implementation queries by
`context.userId`, which the orchestrator injects from the authenticated
request — never from the model's tool-call arguments. This is verified by
an automated test (`test/chatTools.security.test.js`) that creates two real
users and asserts one cannot fetch the other's report by ID, even when the
ID is passed directly or under a smuggled `userId` argument.

`src/chat/chatOrchestrator.js` runs one turn: a deterministic, regex-based
`safetyPreCheck.js` scans for emergency phrasing (chest pain, suicidal
ideation, stroke symptoms, anaphylaxis, overdose, …) and short-circuits to a
fixed emergency-services response with **no model call at all** if matched.
Otherwise it drives a bounded tool-calling loop (max 5 iterations) against
the configured provider, collecting every tool result's evidence, and ends
in a grounded final answer. The system prompt requires the model to use
tools for any personal-data claim, never state a value it didn't get from a
tool result, and never diagnose or instruct medication changes.

The provider contract (`src/chat/providers/`) is generic — a
`converse({systemPrompt, messages, tools})` call taking/returning
provider-neutral message and tool-call shapes — so `claudeChatProvider.js`
is the only file that knows Anthropic's request/response format;
`unavailableProvider.js` is the honest fallback when no `ANTHROPIC_API_KEY`
is configured (chat, unlike extraction, has no meaningful heuristic
substitute — it says so rather than faking natural-language understanding).
Conversation memory is session-scoped: only past user/assistant *text* turns
are replayed into a new turn, never past tool-call scratchpads, so an old
retrieval can't linger as a stale "fact" that conflicts with current data —
every personal-data claim comes from a fresh tool call. `chat_events` logs
non-sensitive telemetry (latency, tokens, tool name, success) — never
message content.

### Diet tracking

`POST /api/diet/scans` (multipart, field `file`, JPG/PNG only) uploads a
photo of food/drink and processes it the same way a medication scan does
(`src/diet/dietScanService.js`, modeled directly on
`medicationScanService.js`): an in-process async job reads the image with
Claude vision (`src/extraction/providers/dietPhotoProvider.js`, forced tool
call `record_food_items`) to identify every distinct item and estimate its
full nutrition profile for the portion shown — not just calories, but every
nutrient on the FDA Nutrition Facts label: protein, carbs, fat, saturated
fat, fiber, sugar, sodium, cholesterol, potassium, calcium, iron, and
vitamin D (`food_entries` — `013_diet_micronutrients.sql`). When a packaged
product's own printed nutrition facts are legible in the photo, the model is
instructed to read those exact printed values (including converting a
printed %DV micronutrient line to its actual amount) rather than estimating
from general food data. When the portion size can't be confidently judged
from the photo at all (no visible package, no countable unit), the model is
instructed to leave every nutrient null and set `needs_quantity` rather than
guess — the review screen (`GET /api/diet/scans/:id`) then asks the person
directly, and any individual nutrient it isn't reasonably confident about is
left null rather than a fabricated precise-looking number. Requires
`ANTHROPIC_API_KEY` (no heuristic vision substitute, same as medication
scanning); `DIET_PROVIDER` only controls whether the *recommendation text*
below is Claude-rephrased.

A manually-typed entry gets the same AI nutrition estimate a photo scan
gets, just from a name instead of an image
(`src/extraction/providers/dietTextProvider.js`, forced tool call
`estimate_food_nutrition`, sharing its nutrient JSON-schema fragment with
the photo provider via `nutrientFields.js` so the two can't drift apart).
It recognizes a single ingredient ("banana") as well as a dish/recipe by
its common name ("chicken biryani", "vegetable lasagna") and estimates from
that dish's typical standard composition, not just its most prominent
ingredient — the model is only allowed to report `recognized: false` (no
estimate at all) for input that isn't identifiable as food/drink, never
for a real but informally-named dish. `POST /api/diet/entries` calls this
automatically whenever a manual entry is saved with no `calories` given, so
typing just a name is enough to get full nutrition without an extra step;
saving still succeeds with blank nutrition if estimation fails (no
`ANTHROPIC_API_KEY`, a transient error, or the food not being recognized)
rather than blocking the save. `POST /api/diet/entries/estimate` exposes
the same estimator standalone — what the mobile app's "Estimate nutrition
with AI" button calls to preview/refresh numbers (e.g. after changing the
name or quantity) before saving, and what a scan-review candidate flagged
`needs_quantity` can call once the person fills in a quantity, reusing the
name the photo already identified.

Every item — scanned or entered manually via `POST /api/diet/entries` — is
auto-tagged into `breakfast`/`lunch`/`snack`/`dinner`/`supper` from the time
it was consumed (`classifyMealType`'s fixed time-of-day bands), always
user-correctable afterward and re-derived automatically if the consumed-at
time is edited without an explicit meal override. A scanned item starts
unconfirmed (like a scanned medication) until reviewed
(`POST /api/diet/entries/:id/confirm`); a manual one is trusted immediately.
`GET /api/diet/summary?days=` returns per-day calorie/macro totals and a
meal breakdown for a recent window, the diet analog of
`GET /api/activity/summary`.

`GET /api/diet/recommendations` returns a cached, regenerable pattern
analysis (`src/diet/dietInsightService.js`): every number (daily
calorie/macro/micronutrient averages, how many days ran over a general
sodium/sugar/cholesterol guideline or under the general iron guideline,
late-night-eating frequency, skipped-breakfast frequency) is computed in
code from confirmed entries over a rolling window, never asked of an LLM.
That pattern is then cross-referenced against the user's active medications
(matched to `medicationKnowledgeBase.js`'s drug category, e.g. an
antidiabetic, antihypertensive/diuretic, statin, gout, reflux, or iron
supplement medication) and confirmed abnormal-flagged lab results on
diet-relevant parameters (glucose/HbA1c, cholesterol/triglycerides, sodium,
potassium, uric acid, serum iron) to surface considerations like "keep
sodium low and consistent" when both a blood-pressure medication and a
flagged sodium result are present, or "pair iron-rich meals with vitamin C"
when both an iron supplement and a low-iron-intake pattern (or a flagged
serum iron result) are present. Tip text is a heuristic template by default,
or (`DIET_PROVIDER=claude`) a Claude rephrasing — validated the same way
`insightExplanationService.js` validates insight text: rejected (falling
back to the heuristic template) if it mentions any number not traceable to
that tip's own structured evidence, so a hallucinated calorie/gram figure
can never reach the user. Every non-informational tip ends with a fixed
not-medical-advice line, and the model is explicitly instructed never to
diagnose or suggest a medication change. The cached row is regenerated
whenever the confirmed-entry count for the window has changed since it was
last built, or on demand (`?refresh=true`).

Every `food_entries` row carries `ai_verified` (`014_diet_ai_verified.sql`)
— whether its current numbers are exactly what an AI estimate produced,
with nothing typed over since. A photo-scanned item is verified as soon as
the scan can estimate it (never for one still flagged `needs_quantity`); a
manual entry is verified when the server's own auto-estimate filled it in,
or when the mobile client explicitly says so after applying a fresh
"Estimate with AI" result. Editing any nutrition-affecting field by hand -
in `FoodEntryForm.jsx` client-side for instant feedback, and again
server-side in `PATCH /entries/:id` as a safety net
(`src/diet/aiVerificationService.js`'s `nutritionValuesChanged`) - resets it
to false; an explicit `ai_verified` in a request body always wins over that
default logic. This is a provenance signal for the mobile app's "✨ AI
estimate" badge (`FoodEntryCard.jsx`, `StatusBadge`), not a correctness
claim.

`GET /api/diet/summary?days=` (already covering up to 90 days of per-day
totals) backs the mobile **Diet stats** screen: a dependency-free calorie
bar chart (reusing `MiniTrendChart.jsx`, the same sparkline
`ParameterTrendScreen.jsx` uses for lab trends), averages over the days
actually logged (not diluted by empty days) for every macro/micronutrient,
and a per-meal-type calorie breakdown - literally where the calories came
from, computed client-side from the same `history[].meals` data the Diet
tab's daily view already receives.

`POST /api/diet/recipes/generate` (`src/diet/dietRecipeService.js`, forced
tool call `generate_recipe`) generates one complete recipe - ingredients,
ordered instructions, and estimated nutrition per serving - from an
optional meal type and free-text preferences (ingredients on hand, a
restriction, a cuisine). It reuses `dietInsightService.js`'s
`computeConsiderations()` so the same active-medication/abnormal-lab
considerations that drive recommendation tips can shape the recipe (e.g.
lower sodium for a blood-pressure consideration); the model is only allowed
to explain the fit (`why_this_recipe`) in terms of considerations it was
actually given, with a fixed not-medical-advice line appended, and any
stated preference/restriction is treated as a hard constraint. Nothing is
persisted server-side - "Log this recipe" on the mobile app is an ordinary
`POST /api/diet/entries` using the returned nutrition, `ai_verified: true`
since it's AI-estimated the same as any other entry.

### Retest Radar

Gives people a reason to open the app between lab visits. A plan in
`retest_plans` (migration `020_retest_plans.sql`) is a "check again by" date
for one parameter. The date is computed only by rules in
`server/src/retest/retestRules.js`, never by an LLM:

- **Out-of-range latest result:** the due date is the result date plus a
  per-parameter cadence, for example HbA1c 90 days, lipids 180, vitamin D and
  B12 84, TSH 42, anything else 90. A flag containing "critical" or "panic"
  brings it down to 14 days.
- **Linked medicine started after the latest result:** the due date is the
  medicine's start date plus the end of its onset window
  (`medication_parameter_links.typical_onset_weeks_*`). A result already
  measured inside that window means the effect has been checked, so this rule
  stops applying.
- **Both rules apply:** the earlier date wins.

Plans are recomputed on load (`GET /api/retest`) and by the reminder job, the
same pull model as medication alerts:

- A newer confirmed result for the parameter closes the plan (`done`).
- A dismissed or snoozed plan stays that way until its situation changes.
- Each plan carries a fixed, non-numeric weekly action (for example "15
  minutes of morning sunlight on 3 days this week"). Ticking it records a
  `retest_checkins` row for that week, which feeds the week streak.

Endpoints, all under `requireAuth`:

- `GET /api/retest`
- `POST /api/retest/:id/snooze | dismiss | checkin`
- `PUT /api/retest/settings` (reminders on/off)
- `POST`/`DELETE /api/retest/push-token`

How reminders are sent:

- The API process runs `retestReminderService.runReminders` every hour.
  Pushes go through Expo's push service only between 03:00 and 15:00 UTC.
- Each user gets at most one combined push per run, covering: two weeks
  before the date, on the date, and the weekly action.
- Each reminder is recorded in `retest_reminders_sent`, so it is never
  repeated.
- Set `RETEST_REMINDERS=off` to disable the job.
- `npm run retest-reminders` sends one pass immediately, ignoring the time
  window.

On mobile, `mobile/src/notifications/retestNotifications.js` registers the
device's Expo push token after sign-in. Push tokens need an EAS `projectId`
in `app.json` (`extra.eas.projectId`) and a physical device. Without them
(web, simulator, no projectId), the same reminders are scheduled as local
notifications instead. Tapping any of them opens the Retest Radar screen.

### Family Health Eye

Every family member is an ordinary `users` row, so every existing table and
route scopes their data with no changes. Migration `021_family_profiles.sql`
adds:

- a `managed` `auth_provider`: a profile with no sign-in of its own
- `family_links (owner_user_id, member_user_id, relation, access)`, where
  `access` is `manage` or `view`
- `family_invites`: single-use codes that expire after 7 days

How profile switching works:

- The client sends `X-Profile-Id` to act as a linked profile.
- `requireAuth` honors the header only when a `family_links` row grants it,
  and refuses every non-GET request on a `view` link.
- `req.accountUser` is always the signed-in account; `req.user` is the
  active profile.
- `requireAccountAuth` ignores the header entirely. It covers account-level
  routes: `/api/auth`, `/api/family`, and `/api/account` (push tokens,
  reminder settings).
- AI usage is always billed to the signed-in account.

Family routes:

- `GET /api/family`: returns this account's profiles, plus who can see its
  own data.
- `POST`/`PATCH`/`DELETE /api/family/members[/:id]`: create a managed
  profile, set its name, relation or summary language, or remove it.
  Removing the last manager of a managed profile deletes the profile and all
  its data.
- `POST /api/family/invites` and `POST /api/family/invites/redeem`: share or
  join a profile by code.
- `DELETE /api/family/shared-with/:userId`: revoke someone's access to your
  own data.

The Retest Radar reminder job notifies each profile's own devices, and every
linked caregiver's devices too ("Time to recheck Dad's HbA1c"). Tapping a
caregiver's reminder opens that profile.

Retest Radar's **Book test** button opens `LAB_BOOKING_URL_TEMPLATE`, with
`{test}` replaced by the test name. The default is a nearby-labs map search;
point it at a lab partner's booking page when you have one. The button shows
prominently once a recheck is 14 days away or less.

### Known scope limits

- `generateSummary` (`src/services/summaryService.js`) is a heuristic,
  template-based summary (flag counts, low-confidence/duplicate counts) — a
  stand-in for a real LLM-backed summarizer, kept behind one function so it's
  a single call site to swap.
- Legacy binary `.doc`/`.xls` files are accepted (per the format
  requirement) but parsed with the same DOCX/XLSX-family libraries, which
  only understand the modern XML-based formats; a genuine legacy binary file
  will land in `Failed` with a clear message rather than silently mis-parsing.
- The registry seed (`server/db/registry-seed-data.js`) is a curated starter
  set of ~18 common lab parameters, not an exhaustive one — extend it rather
  than hardcoding test names elsewhere.
- Diet tracking's meal-time bands and sodium/sugar/fiber/iron/cholesterol
  thresholds are fixed, general-population dietary-guideline defaults (like insights'
  15%/30% thresholds) — not personalized, and evaluated against the server
  process's local time the same way `routes/activity.js` treats "today",
  since there's no stored per-user timezone anywhere in the app yet.
- The Claude provider hasn't been exercised end-to-end in this environment
  (no `ANTHROPIC_API_KEY` configured here); the heuristic provider was used
  for all testing described below. Its request/response shape was reviewed
  against the Anthropic Messages/tool-use API but not run live.
- Report-level date detection is regex/label-based, not NLP — it handles
  common lab-report phrasing but won't catch every layout. It always fails
  toward `Needs Review` rather than guessing.
- Only one data source exists: report upload (`reports.source_type =
  'report_upload'`). Apple Health, Samsung Health, Accu-Chek, Libre, etc.
  aren't implemented — there's no credentialed access to those APIs in this
  environment — but `source_type` and the dedicated `measurement_sources`/
  `health_measurements` provenance model exist specifically so a future
  connector is a new writer into the same tables, not a schema change.
  Dashboard/timeline source filters are wired but only ever see one value
  today.
- The only push/local alerting is Retest Radar's reminders. "Needs attention"
  and medication alerts are still pull (on-load) views.
- Insight thresholds (15%/30% change, 3-point trend/repeat windows) are fixed
  constants, not per-user/per-parameter configuration; exploratory
  correlations and wearable/glucose-pattern insight types from the issue's
  catalog are out of scope (no connected device data exists to detect
  patterns in — see the dashboard's scope limits above).
- The chat assistant's tool-calling loop against a live model hasn't been
  exercised end-to-end in this environment (no `ANTHROPIC_API_KEY`
  configured here) — its deterministic paths (safety intercept, honest
  failure with no provider, tool authorization, message persistence) are
  covered by automated tests, but the actual Claude conversation loop was
  reviewed against the Messages/tool-use API, not run live.
- Chat has no streaming, cancellation, or multi-provider fallback yet — each
  turn is a single request/response with a 30s timeout and a bounded
  tool-call loop (max 5 iterations). The provider contract supports adding
  these later without changing the orchestrator's shape.
- No authentication/authorization — see above.

### Automated tests

`cd server && npm test` runs `node --test` over `server/test/`: the insight
rule catalog and its evidence-number validator (synthetic fixtures, per
issue #11's explicit ask), the safety pre-check's emergency/non-emergency
phrasing, the chat orchestrator's non-LLM paths, and — the most
safety-critical one — `chatTools.security.test.js`, which creates two real
database users and asserts one cannot retrieve the other's report through
any tool, including a deliberately smuggled `userId` argument. These need a
reachable `DATABASE_URL` (same as the server itself).

## Mobile app

```bash
cd mobile
npm install
npm start   # Expo dev server; scan the QR code with Expo Go, or press i/a
```

Set `expo.extra.apiBaseUrl` in `app.json` (or `EXPO_PUBLIC_API_BASE_URL`) to
point at your server if it isn't reachable at `http://localhost:4000`
(`http://10.0.2.2:4000` is used automatically for the Android emulator).

Light theme tokens live in `src/theme/theme.js`. Bottom tabs (Dashboard /
Timeline / Ask / Upload) sit inside a stack so Report detail, Parameter
trend, and Insights push over them full-screen:

- **Dashboard** (`src/screens/DashboardScreen.jsx`) — an "AI insights"
  preview (`InsightCard.jsx`, dismiss inline, "See all" to the full
  Insights screen), pinned-metric cards (value, date, source, change vs.
  prior; tap for the trend view; ✕ to unpin), a "Needs attention" list,
  recent reports, and a picker (`ParameterPickerModal.jsx`) to pin new
  metrics from the registry.
- **Insights** (`src/screens/InsightsScreen.jsx`) — the full active-insight
  list with dismiss and useful/not-useful feedback, tapping through to the
  source report.
- **Ask** (`src/screens/ChatScreen.jsx`) — a chat UI over `/api/chat`;
  assistant replies that cite a report render a "View source" chip that
  jumps straight to Report detail.
- **Timeline** (`src/screens/TimelineScreen.jsx`) — search + category-filter
  chips over `GET /api/timeline`, each item showing its effective date (or a
  "Date needs review" flag), counts, a likely-duplicate note, and its current
  AI summary; taps into Report detail.
- **Upload** (`src/screens/UploadScreen.jsx`) — intentionally just the
  upload action: supported formats/limits, file picker
  (`expo-document-picker`), photo library and camera capture
  (`expo-image-picker`); the report list lives on the Timeline tab instead.
- **Report detail** (`src/screens/ReportDetailScreen.jsx`) — polls while
  `Uploaded`/`Processing`; shows/edits the effective date inline; the
  versioned narrative summary (falling back to the short heuristic one);
  once `Needs Review`, each measurement's canonical-mapping status
  (mapped/unmapped/ambiguous, tap to search the registry via
  `ParameterPickerModal.jsx`), a possible-duplicate banner, inline field
  editing, and confirm; retries a `Failed` report.
- **Parameter trend** (`src/screens/ParameterTrendScreen.jsx`) — range chips
  (7D/30D/90D/6M/1Y/All) over `GET .../trend`, a dependency-free sparkline
  (`MiniTrendChart.jsx`, plain `View`s — no charting library), and a list of
  points that jump back to their source report.
- **Diet** (`src/screens/DietScreen.jsx`, reached from a Dashboard card) —
  camera/library capture (`expo-image-picker`) or manual entry
  (`FoodEntryForm.jsx`), today's calorie/macro totals and logged items
  (`FoodEntryCard.jsx`, color-coded by meal), and an AI recommendations
  section with a manual refresh. **Diet scan review**
  (`DietScanReviewScreen.jsx`) — polls a processing scan the same way
  Medication scan review does, lets the person fill in anything flagged
  `needs_quantity`, and confirms or discards each identified item.
  **Diet entry form** (`DietEntryFormScreen.jsx`) — the same shared form
  for adding an item by hand or editing/deleting an existing one, including
  the consumed-at time that drives its auto-assigned meal, and an "Estimate
  nutrition with AI" button (`FoodEntryForm.jsx`) that fills in the numbers
  from just the name (saving with no calories given also triggers this
  automatically, server-side). Any logged item that's still exactly what
  an AI estimate produced shows a "✨ AI estimate" badge
  (`FoodEntryCard.jsx`), which disappears the moment a nutrition value is
  edited by hand. **Diet stats** (`DietStatsScreen.jsx`, reached from the
  Diet tab's "View stats" link) — 7D/14D/30D/90D range chips over
  `GET /api/diet/summary`, a calorie sparkline, average macro/micronutrient
  values over the days actually logged, and a calories-by-meal-type
  breakdown. **Recipe ideas** (`DietRecipeScreen.jsx`, reached from the Diet
  tab) — an optional meal-type chip and free-text preferences field, a
  generated recipe (ingredients, steps, nutrition per serving, a
  considerations-grounded "why this recipe" note) from
  `POST /api/diet/recipes/generate`, and a "Log this recipe" button that
  saves it as a confirmed, AI-verified diet entry.

### Testing notes

The server's ingestion + extraction pipeline was exercised end-to-end against
generated CSV/XLSX/DOCX/PDF/PNG fixtures with the default heuristic provider:
upload → processing → canonical mapping → review → edit a value → confirm; a
corrupt file and an unsupported type were rejected as expected; re-uploading
an already-confirmed CSV correctly flagged the unchanged rows as suspected
duplicates while leaving a since-corrected row unflagged and the *report*
itself linked via `likely_duplicate_of_report_id`; an unmapped test name
landed in `Needs Review` and was resolved via a mapping correction. Report
date detection was verified for labeled-date CSV/measurement-date fallback,
a bare "Date:" line, and the "nothing found → Needs Review, no upload-date
fallback" case, plus a manual correction via `PATCH /api/reports/:id`. The
versioned narrative summary was confirmed to include a real comparison
against an earlier confirmed value (not just the current report's own
flags), and to skip regeneration when `data_version` hadn't moved. Timeline
filters (search, category) and the dashboard snapshot/trend/pin-unpin
endpoints were all exercised directly and returned the expected shapes,
including weekly-aggregation kicking in path for dense series (code path
verified; a real dense CGM-scale dataset wasn't available to generate here).
One real bug was caught this way and fixed: an ambiguous SQL column
reference in the report-level dedup query.

For insights, a controlled sequence of four AST results (normal → high →
higher → higher again) run through upload-and-confirm end to end was used
to verify, in order: `new_result` on the first, `change_from_previous`
(125% higher, computed) + `new_abnormal_flag` on the second, `sustained_
trend` on the third — correctly *superseded* by a new one with different
evidence on the fourth alongside `repeated_abnormal` firing for the first
time; a fifth normal result then correctly auto-resolved the outstanding
abnormal-flag insights; correcting an already-confirmed measurement's value
correctly superseded the insight generated from its old value. Dismiss and
feedback endpoints were exercised directly. The 17-test automated suite
(`npm test`) covers the rule catalog, the evidence-number validator, the
safety pre-check, the orchestrator's non-LLM paths, and cross-user tool
authorization.

For chat, the safety pre-check, the "no provider configured" failure path,
and full message persistence/history were verified end-to-end via the API
(a real emergency-phrased message correctly short-circuited with zero
model/tool calls and empty evidence; an ordinary question correctly failed
closed with a clear message rather than fabricating an answer, since no
`ANTHROPIC_API_KEY` is configured in this environment).

The mobile app was verified by starting the Expo/Metro dev server and
pulling a full JS bundle for it (`/index.bundle`) after each round of
changes, which resolves and transforms every screen, component, and
third-party import with no errors (1022 modules in the final bundle). There
was no device/simulator available in this environment, so the UI has not
been visually exercised — that step is still needed before shipping.
