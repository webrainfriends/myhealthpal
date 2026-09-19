# MyHealthPal

Universal health report upload and document ingestion
([issue #1](https://github.com/webrainfriends/myhealthpal/issues/1)) plus AI
extraction and normalization of health parameters into a longitudinal,
provider-agnostic dataset
([issue #2](https://github.com/webrainfriends/myhealthpal/issues/2)): a
light-themed React Native (Expo) app on top of an Express + PostgreSQL
ingestion API.

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
| `GET` | `/api/health-parameters?search=` | Search the canonical parameter registry (for mapping corrections) |

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

Light theme tokens live in `src/theme/theme.js`. Screens:

- **Upload** (`src/screens/UploadScreen.jsx`) — supported formats/limits,
  file picker (`expo-document-picker`), photo library and camera capture
  (`expo-image-picker`), and a live, polling list of the user's reports.
- **Report detail** (`src/screens/ReportDetailScreen.jsx`) — polls while
  `Uploaded`/`Processing`; once `Needs Review`, shows each measurement's
  canonical-mapping status (mapped/unmapped/ambiguous, tap to search the
  registry and correct via `CanonicalMappingModal.jsx`), a possible-duplicate
  banner, inline field editing, and confirm; retries a `Failed` report.

### Testing notes

The server's ingestion + extraction pipeline was exercised end-to-end against
generated CSV/XLSX/DOCX/PDF/PNG fixtures with the default heuristic provider:
upload → processing → canonical mapping → review → edit a value → confirm; a
corrupt file and an unsupported type were rejected as expected; re-uploading
an already-confirmed CSV correctly flagged the unchanged rows as suspected
duplicates while leaving a since-corrected row unflagged; an unmapped test
name landed in `Needs Review` and was resolved via a mapping correction. The
mobile app was verified by starting the Expo/Metro dev server and pulling a
full JS bundle for it (`/index.bundle`), which resolves and transforms every
screen, component, and third-party import with no errors. There was no
device/simulator available in this environment, so the UI has not been
visually exercised — that step is still needed before shipping.
