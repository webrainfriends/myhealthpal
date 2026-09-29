# Key management

## Key hierarchy

```
AWS KMS key (KEK, symmetric, in KMS, never exported)       alias/myhealthpal-reports
   └── wraps ──> per-file data key (DEK, 256-bit, random)  stored wrapped in PostgreSQL
                     └── encrypts ──> one file (AES-256-GCM) stored in ENCRYPTED_STORE_DIR
```

- **Encryption context.** Every KMS call carries `{ app: "myhealthpal", userId, objectKey }`. KMS refuses to unwrap a data key under a different context, so a wrapped key copied onto another row is useless. The context is also recorded in CloudTrail, giving an independent audit trail.
- **Authenticated data.** The file's own AES-GCM additional authenticated data is `myhealthpal:v1:<userId>:<objectKey>`, so swapped ciphertext fails too.
- **No plaintext keys stored.** Plaintext data keys exist only in process memory for a single operation and are zeroed afterwards.

## One-time AWS setup (production)

1. **Create the key** in ap-southeast-1:
   - KMS → Customer managed keys → Create: symmetric, encrypt and decrypt.
   - Alias `myhealthpal-reports`.
   - Turn on **automatic key rotation**. KMS rotates the key material yearly and keeps old versions, so nothing needs re-wrapping.
2. **Create an IAM role for EC2**, for example `myhealthpal-app`, with this policy (replace the ARN):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["kms:GenerateDataKey", "kms:Decrypt", "kms:ReEncrypt*", "kms:DescribeKey"],
       "Resource": "arn:aws:kms:ap-southeast-1:<account>:key/<key-id>",
       "Condition": { "StringEquals": { "kms:EncryptionContext:app": "myhealthpal" } }
     }]
   }
   ```
3. **Attach the role** to the instance: EC2 → Instance → Actions → Security → Modify IAM role. The app uses the instance role through the AWS SDK's default credential chain, so no access keys are needed anywhere.
4. **Add the repository secret** `KMS_KEY_ID` (GitHub → Settings → Secrets and variables → Actions). It can be the key ARN or `alias/myhealthpal-reports`.
5. **Deploy.** The workflow's security preflight runs `scripts/check-kms.js`, which round-trips a data key. If that fails, the deploy stops and restores the previous code, and the running app is not touched.

Leave out `kms:ScheduleKeyDeletion` and similar permissions: the app never needs them.

## Rotation

| Situation | What to do |
|---|---|
| Yearly key-material rotation (KMS automatic rotation) | Nothing. KMS decrypts old wrapped keys transparently. |
| Moving to a **different** KMS key (new `KMS_KEY_ID`) | Keep the role allowed on **both** keys. Run `npm run rewrap-keys -- --dry-run`, then `npm run rewrap-keys`. This uses KMS `ReEncrypt`: the data keys never leave KMS in plaintext, and files are untouched. Remove the old key's permission once the dry run shows 0 remaining. |
| New cipher format (`encryption_version` 2) | Register it in `security/cipherVersions.js`, then run `npm run reencrypt-files`. Each file is decrypted with the old version, re-encrypted with a new data key, verified, and swapped in; the old object is then removed. |

Each re-wrapped or re-encrypted file records a `KEY_REWRAPPED` or `FILE_REENCRYPTED` audit event.

## Development and tests

- `KEY_PROVIDER=local-dev` plus `LOCAL_DEV_MASTER_KEY=$(openssl rand -hex 32)`, set in your shell or a git-ignored `.env`. Never commit it.
- The provider refuses to load when `NODE_ENV=production`, and the app logs a warning whenever it's in use.
- Changing the dev master key makes previously uploaded dev files unreadable, which is the expected result.

## Failure modes

| Failure | Behavior |
|---|---|
| KMS unreachable or access denied | Uploads and file views fail with an error. Nothing is stored or served unencrypted. |
| Key or vault configuration missing in production | The server exits at startup (`security/configValidation.js`). |
| Vault object missing or tampered | The view returns 404 and processing marks the report Failed. The checksum and GCM tag are both checked. |
