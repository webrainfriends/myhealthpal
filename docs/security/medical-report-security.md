# Medical report security

How EyeMyHealth protects uploaded medical files: lab reports, prescription and tablet scans, meal photos, and Gmail-imported reports. This covers [issue #104](https://github.com/webrainfriends/myhealthpal/issues/104). Related documents:
- [threat-model.md](threat-model.md)
- [key-management.md](key-management.md)
- [privacy-and-ai-processing.md](privacy-and-ai-processing.md)

## Summary

| Property | How |
|---|---|
| No plaintext at rest | Uploads are held in memory only (multer `memoryStorage`), then encrypted straight into the vault (`server/src/security/secureUpload.js`). Parsers read from buffers, so no plaintext temp files exist. |
| Envelope encryption | Each file gets its own random 256-bit data key and a random 96-bit IV, and is encrypted with AES-256-GCM. The authenticated data binds the file to its owner and object. The data key is stored only wrapped by the key-encryption key held in **AWS KMS** (`encryptedFileStore.js`, `providers/awsKms.js`). |
| Keys never beside files | Ciphertext lives in `ENCRYPTED_STORE_DIR` (`/var/lib/myhealthpal/vault`, mode 700, files 600). Wrapped keys live in PostgreSQL. The key-encryption key never leaves KMS. |
| Fail closed | A GCM tag, checksum, KMS or ownership failure means nothing is returned. There is no plaintext fallback. Production refuses to start without KMS. |
| Authorization first | Every report operation goes through `security/reportAccess.js` before anything is read or decrypted. |
| Consent | Separate, recorded consents for storage, AI document processing and AI insights (`security/consentService.js`). |
| One AI boundary | Every Claude call goes through `ai/privacyGateway.js`, which checks consent, records an audit event and strips internal ids. |
| Audit | `security_audit_events` is append-only (a trigger blocks UPDATE and DELETE). It holds no PHI: ids, event type, purpose, hashed IP and client category only. |
| Deletion | "Delete report permanently" removes the ciphertext, the wrapped key and every derived result. |

## Upload

```mermaid
sequenceDiagram
  participant App
  participant API as API (Express)
  participant KMS as AWS KMS
  participant Vault as Encrypted store
  participant DB as PostgreSQL
  App->>API: POST /api/reports (multipart, session token)
  API->>DB: consent medical_record_storage granted?
  API->>API: size, extension, magic bytes, ZIP-bomb guard, malware scan (memory only)
  API->>KMS: GenerateDataKey(AES_256, context{userId, objectKey})
  KMS-->>API: plaintext DEK + wrapped DEK
  API->>API: AES-256-GCM encrypt (random IV, AAD = owner+object); zero DEK
  API->>Vault: write ciphertext as random UUID (0600, temp file + rename)
  API->>DB: INSERT report + wrapped DEK, IV, tag, SHA-256, key ref/version
  API->>DB: audit REPORT_UPLOAD_STARTED, REPORT_ENCRYPTED
  API-->>App: 201 (no storage or key fields)
```

Processing (`services/ingestionService.js`, and the medication and diet scan services):
1. Loads the row and unwraps the data key with KMS `Decrypt` under the same context.
2. Checks the SHA-256 checksum and the GCM tag.
3. Decrypts into a Buffer and hands it to the adapter under a 60-second timeout.
4. Drops the buffer afterwards.

An audit event `REPORT_DECRYPTED_FOR_PROCESSING` is recorded. If AI consent is present, the gateway sends only the document content to the model.

## View and download

```mermaid
sequenceDiagram
  participant App
  participant API
  participant DB
  participant KMS
  App->>API: GET /api/reports/:id/file-url (session)
  API->>DB: owned by this user?
  API-->>App: /api/files/report/:id?token=… (5 min, jti, single report)
  App->>API: GET /api/files/report/:id?token=…
  API->>API: verify token (HKDF-derived key), report id match
  API->>DB: owned by token's user? (optional single-use jti)
  API->>KMS: Decrypt(wrapped DEK, context)
  API->>API: verify checksum + GCM tag, decrypt in memory
  API-->>App: bytes; Cache-Control no-store, nosniff, CSP sandbox
```

- The download token is signed with a key derived from `JWT_SECRET` (HKDF, label `report-download`). A session token can never be used as a download token, and a download token can never be used as a session token.
- Failures return a generic 404 or 410.
- nginx logs `/api/files/` requests without the query string, so tokens never reach access logs.

## Where plaintext exists, and for how long

| Place | Lifetime |
|---|---|
| Request memory during upload | Until encryption finishes (milliseconds) |
| Processing memory | For the duration of parsing and extraction |
| Download response | For the duration of the response |
| AI provider | Only with `ai_document_processing` or `ai_health_insights` consent; see [privacy-and-ai-processing.md](privacy-and-ai-processing.md) |

Plaintext never goes to disk, a temp directory, logs or the database. Extracted values, such as lab results, do live in the database: they are the app's structured data, protected by database access control. This vault is about the original documents.

## Deletion, retention and backups

- **`DELETE /api/reports/:id`** is permanent. It deletes the row (and with it the wrapped key and metadata) and every derived row through foreign-key cascades, then the ciphertext object, and records `REPORT_DELETED`.
- **`DELETE /api/medications/scans/:id` and `DELETE /api/diet/scans/:id`** do the same for scan photos. Items the person already confirmed are kept.
- **Retention:** `RETENTION_UNCONFIRMED_SCAN_DAYS` (off by default) runs a daily purge of old scan files.
- **Backups:**
  - A database backup contains only wrapped keys.
  - A backup of the vault contains only ciphertext.
  - Once a row is deleted, the wrapped key exists only in older database backups. Restoring one would also require the vault object and KMS access.
  - For true cryptographic erasure, keep database backup retention short, or, in an emergency, schedule deletion of the KMS key. That makes *all* files unreadable.
- **Existing plaintext uploads** are migrated by `scripts/encrypt-legacy-uploads.js`, which runs on every deploy: encrypt, verify by decrypting and comparing SHA-256, and only then delete the plaintext. It is idempotent and prints counts only. `--dry-run` changes nothing. After migration, legacy reads are denied (`LEGACY_PLAINTEXT_READS=deny`).

## File safety

- The extension must be allowed, and the magic bytes must match it (`fileSniffer.js`). Executables, scripts and HTML-as-CSV are rejected.
- DOCX/XLSX: the ZIP central directory is checked for total uncompressed size (100 MB or less), entry count, compression ratio and VBA macros (`zipGuard.js`).
- `MALWARE_SCANNER=clamd` streams the bytes to ClamAV before storage. Scanner errors reject the upload.
- Parsers run under `PARSER_TIMEOUT_MS`. PDFs over 200 pages are refused.
- Nothing is ever executed: no macros, and no embedded content is run.

## Operator checklist

- [ ] KMS key and EC2 instance role set up, and the `KMS_KEY_ID` secret added ([key-management.md](key-management.md)).
- [ ] The deploy's "security preflight" passes (`node scripts/check-kms.js`).
- [ ] `/var/lib/myhealthpal/vault` is backed up together with the database. Neither is useful without the other plus KMS.
- [ ] The deploy log shows the legacy migration counts, with `pending` reaching 0.
- [ ] `server/.env` has `NODE_ENV=production`, `KEY_PROVIDER=aws-kms` and `LEGACY_PLAINTEXT_READS=deny`, and no `LOCAL_DEV_MASTER_KEY`.
- [ ] Anthropic data-processing and retention terms reviewed for the target market ([privacy-and-ai-processing.md](privacy-and-ai-processing.md)).
- [ ] Optional: ClamAV installed and `MALWARE_SCANNER=clamd` set.
- [ ] Optional: `DOWNLOAD_TOKEN_SINGLE_USE=true` for one-time file links.
