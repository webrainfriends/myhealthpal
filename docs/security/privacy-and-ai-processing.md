# Privacy and AI processing

## Consent

Stored in `user_consents`, one current row per person and type. Every change is recorded as a `CONSENT_GRANTED` or `CONSENT_REVOKED` audit event, along with the policy version.

| Consent | Needed for | Without it |
|---|---|---|
| `medical_record_storage` (required) | Uploading any file: reports, scans, Gmail imports | Uploads return 409 `consent_required`, and the app opens Privacy & AI |
| `ai_document_processing` | Sending a report's content or a photo to the AI provider for extraction | Reports are parsed locally by the heuristic extractor; scanned images stay "OCR Pending" and medication or meal photo scans explain that AI is off |
| `ai_health_insights` | Report summaries, insight wording, chat, diet tips, recipes, food-text estimates, dashboard grouping of unknown tests | Built-in template text is used instead; chat and recipe features say they are off |

- **Revoking** stops future AI calls immediately. Viewing and deleting stored reports keep working.
- **`POLICY_VERSION`** (in `security/consentService.js`): bumping it treats every earlier grant as absent, so people are asked again.
- **Family profiles:** a caregiver decides for a *managed* profile (a parent without their own login), and `granted_by_user_id` records who. An adult with their own account always decides for themselves; a caregiver can see their choices but not change them.

## What each AI purpose sends to the provider

All calls go through `server/src/ai/privacyGateway.js`. Nothing outside `src/ai/` may import the SDK, and a test enforces it.

| Purpose | Consent | Sent |
|---|---|---|
| `report_extraction` | ai_document_processing | Extracted report text or tables, rendered page images, or the image itself. No name, account or ids. |
| `medication_scan`, `diet_photo` | ai_document_processing | The scan's text or image only |
| `report_summary` | ai_health_insights | Result names, values, units, ranges and flags, plus comparisons with earlier results |
| `insight_explanation`, `diet_insight` | ai_health_insights | The structured observation, such as type, values and direction |
| `chat` | ai_health_insights | The conversation and tool results, with internal UUIDs stripped (`stripInternalIds`) and report storage fields removed |
| `recipe`, `diet_text_estimate`, `custom_card_grouping` | ai_health_insights | Meal preferences and relevant flags, food descriptions, or test names |
| `reference_lookup` | none | A medicine's name only, with no personal data |

**Minimization:**
- Prompts never include the person's name, email or account id.
- Storage paths, object keys and wrapped keys are never sent.
- Chat tool results have record ids removed before they reach the model.

**Audit:** every call records `AI_PROCESSING_STARTED`, `AI_PROCESSING_COMPLETED` or `AI_PROCESSING_FAILED`, with the purpose and provider only. A refused call records `AI_PROCESSING_BLOCKED`. Prompts and responses are never logged.

**Stored model output:** `extraction_runs.raw_model_output` and the equivalent scan columns keep the model's structured output for review and debugging. It is health data under the same database protections as extracted results, and it is deleted with its report.

## Logging

`server/src/lib/safeLog.js` is used by the global error handler and background jobs. It:
- redacts JWTs, bearer tokens, token query parameters, API keys and 64-hex keys;
- drops sensitive object fields (values, text, prompts, paths, keys);
- never logs a pg error's `detail` or parameters.

Error responses to clients are generic.

## Compliance note

These are technical controls. They do **not** by themselves make a deployment compliant with HIPAA, GDPR, India's DPDP Act, Singapore's PDPA or similar laws. Compliance also depends on:
- jurisdiction and data residency (for example, the UAE's health-data localization rules)
- contracts: the data processing agreement with Anthropic, and a BAA where applicable
- the provider's retention settings
- breach-notification processes, access governance and retention policies
- honoring user-rights requests

Deployment owners must check these for each target market. The app's own text says as much ("no app is automatically compliant…").
