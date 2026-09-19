# MyHealthPal

Universal health report upload and document ingestion (implements
[issue #1](https://github.com/webrainfriends/myhealthpal/issues/1)): a
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
| `GET` | `/api/reports/:id` | Report detail + extracted parameters |
| `POST` | `/api/reports/:id/retry` | Re-run ingestion after a failure |
| `PATCH` | `/api/reports/:id/parameters/:paramId` | Correct an extracted value |
| `POST` | `/api/reports/:id/confirm` | Confirm reviewed parameters, mark report Completed |

There is no authentication system yet; every request acts as a single seeded
demo user (`DEMO_USER_ID`), overridable with an `x-user-id` header.

### Ingestion pipeline

Upload → validate (type/size/non-empty) → store original file → create a
report row (`Uploaded`) → an in-process async job (`enqueueProcessing`, a
drop-in stand-in for a real queue like BullMQ/SQS) picks a format adapter:

- **CSV/XLSX** parse directly into rows (`csv-parse`, `exceljs`).
- **DOCX** and **text-native PDF** (`mammoth`, `pdfjs-dist`) extract raw text.
- **Scanned PDF** (little/no selectable text) and **JPEG/PNG** are flagged
  `image_scanned`; there's no OCR/vision engine wired into this environment,
  so those reports land in `Needs Review` with zero extracted parameters
  instead of fabricating results. `src/adapters/imageAdapter.js` is the single
  place to plug in a real OCR/document-vision call.

Every adapter output feeds the same format-neutral
`src/services/parameterExtractor.js`, which pulls `{test_name, value, unit,
reference_range, status_flag, date}` either from table headers (CSV/XLSX) or
from a tokenized line parser (PDF/DOCX text). Non-numeric clinical results
(`Trace`, `Positive`, `Not Detected`, `<5`, `>200`, …) are preserved as-is.

Processing always ends in `Needs Review` (never straight to `Completed`) so
the user has a chance to correct values before confirming. Confirming a
report (`POST /confirm`) marks its parameters `is_confirmed`; retrying a
report only replaces non-confirmed parameters, so a retry can never duplicate
an already-confirmed measurement. A failed adapter (corrupt file, password-
protected PDF, unreadable legacy `.doc`) never deletes the original upload —
the report moves to `Failed` with a human-readable `processing_error` and can
be retried.

### Known scope limits

- `generateSummary` (`src/services/summaryService.js`) is a heuristic,
  template-based summary (flag counts, low-confidence counts) — a stand-in
  for a real LLM-backed summarizer, kept behind one function so it's a
  single call site to swap.
- Legacy binary `.doc`/`.xls` files are accepted (per the format
  requirement) but parsed with the same DOCX/XLSX-family libraries, which
  only understand the modern XML-based formats; a genuine legacy binary file
  will land in `Failed` with a clear message rather than silently mis-parsing.
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
  `Uploaded`/`Processing`; once `Needs Review`, lets the user edit each
  extracted parameter inline and confirm; retries a `Failed` report.

### Testing notes

The server's ingestion pipeline was exercised end-to-end against generated
CSV/XLSX/DOCX/PDF/PNG fixtures (upload → processing → review → edit →
confirm, plus a corrupt-file and unsupported-type rejection). The mobile app
was verified by starting the Expo/Metro dev server and pulling a full JS
bundle for it (`/index.bundle`), which resolves and transforms every screen,
component, and third-party import with no errors. There was no
device/simulator available in this environment, so the UI has not been
visually exercised — that step is still needed before shipping.
