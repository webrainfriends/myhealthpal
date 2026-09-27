# Threat model: medical reports

## Assets
- Original medical documents: reports, prescriptions, photos.
- Extracted health data: measurements, summaries, chat history.
- Keys: the KMS key-encryption key, the wrapped data keys, session and download tokens.

## Trust boundaries

```
[Phone/browser] --TLS--> [nginx] --> [Node API] --> [PostgreSQL]  (wrapped keys, metadata, extracted data)
                                        |--> [Vault dir]           (ciphertext only)
                                        |--> [AWS KMS]             (KEK; wrap/unwrap only, via instance role)
                                        '--> [Anthropic API]       (only via privacy gateway, with consent)
```

## Threats and mitigations

| Threat | Mitigation | Residual risk |
|---|---|---|
| Disk, snapshot or backup of the vault is stolen | Ciphertext only; data keys are wrapped by KMS | None without KMS access |
| Database dump is stolen | Only wrapped keys, which KMS refuses to unwrap for callers outside the instance role | Extracted structured data (values, summaries) is in the database; protect it with database access controls and encrypted EBS/volume snapshots |
| Database *and* vault stolen together | Still needs KMS Decrypt through the instance role | A compromise of the running instance can use its role, so the role must be scoped to this key and encryption context. KMS CloudTrail logs every Decrypt |
| One user reads another's report (ID guessing) | `reportAccess.loadOwnedReport` on every route; UUIDs; 404 with no details; `ACCESS_DENIED` audited; HTTP tests cover every route | None known |
| Download link is leaked or replayed | 5-minute, single-report, user-bound token signed with a derived key; optional single use; no query string in nginx logs | Valid for its short lifetime unless single-use is on |
| Token or id tampering | Signature check, then report-id match, then ownership re-check | None known |
| Wrapped key or ciphertext swapped between rows | KMS encryption context plus GCM authenticated data bound to owner and object | None known |
| Malicious upload (parser exploit, ZIP bomb, macro, polyglot) | Magic-byte checks, ZIP guard, macro refusal, malware-scan hook, parser timeouts, page cap, CSP sandbox and nosniff on view | Zero-day bugs in pdfjs, mammoth or exceljs; keep dependencies updated |
| Health data leaks through logs | Redacting logger, generic client errors, no prompt or response logging | Logging added in future must use `safeLog` |
| Data sent to AI without permission | Central gateway with per-purpose consent; fails closed; tripwire test | The provider's own retention; see the privacy doc |
| Plaintext leftovers from legacy uploads | Verify-then-delete migration on deploy; legacy reads denied in production | Rows marked `failed` or `missing` in the migration counts need an operator's attention |
| Misconfiguration (dev key in production, missing KMS) | Startup validation; deploy preflight; dev provider refuses production | None known |

## Row-Level Security (evaluated, deferred)

PostgreSQL row-level security (RLS) would add defense in depth. It would need a per-request database role or `SET app.user_id` on pooled connections across every query path, including background jobs. That is invasive and error-prone with the single-role connection pool used today. Application authorization plus the HTTP negative tests are the control for now. Revisit RLS if the app moves to per-request transactions.

## Incident response

1. **Suspected server compromise:**
   - Remove the instance role's KMS permission, or disable the KMS key. From then on, no file can be decrypted by anyone.
   - Rotate `JWT_SECRET`, which invalidates every session and download link.
   - Check CloudTrail for KMS Decrypt calls and `security_audit_events` for access.
2. **Leaked download link:** it expires within the TTL. Turn on `DOWNLOAD_TOKEN_SINGLE_USE` if links are being shared.
3. **Leaked database dump:** the wrapped keys are useless without KMS. Treat the extracted structured data as exposed and follow breach-notification duties.
4. **Lost KMS key (deleted):** all files are unrecoverable, which is by design. Keep deletion protection with the 30-day waiting period.
