# MyHealthPal

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
npm run seed           # creates the demo user
npm start               # listens on PORT (default 4000)
```

Requires a running PostgreSQL instance matching `DATABASE_URL`.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config/supported-formats` | Supported extensions + max upload size |
| `GET` | `/api/reports` | List the current user's reports |
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

There is no authentication system yet; every request acts as a single seeded
demo user (`DEMO_USER_ID`), overridable with an `x-user-id` header.

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
   confidence}`. Two are implemented against the same contract:
   - `heuristic` (default): the local table-header/tokenized-line parser
     (`src/services/parameterExtractor.js`) — no external calls.
   - `claude`: calls the Anthropic Messages API with a forced tool call
     (`record_health_parameters`) whose strict JSON schema the model output is
     validated against; only active when `ANTHROPIC_API_KEY` is set.
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
- No push/local alerting — "needs attention" is a pull (dashboard) view, not
  a background-triggered alert.
- No authentication/authorization — see above.

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
Timeline / Upload) sit inside a stack so Report detail and Parameter trend
push over them full-screen:

- **Dashboard** (`src/screens/DashboardScreen.jsx`) — pinned-metric cards
  (value, date, source, change vs. prior; tap for the trend view; ✕ to
  unpin), a "Needs attention" list, recent reports, and a picker
  (`ParameterPickerModal.jsx`) to pin new metrics from the registry.
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

The mobile app was verified by starting the Expo/Metro dev server and
pulling a full JS bundle for it (`/index.bundle`) after each round of
changes, which resolves and transforms every screen, component, and
third-party import with no errors (1019 modules in the final bundle). There
was no device/simulator available in this environment, so the UI has not
been visually exercised — that step is still needed before shipping.
