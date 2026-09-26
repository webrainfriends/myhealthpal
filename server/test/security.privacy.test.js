const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');
const { validateContent } = require('../src/security/fileSniffer');
const { inspectZip } = require('../src/security/zipGuard');
const { redact, describeError, redactString } = require('../src/lib/safeLog');
const { getAiClient, isAllowed, stripInternalIds } = require('../src/ai/privacyGateway');
const { setProviderClientForTests } = require('../src/ai/providerFactory');
const consentService = require('../src/security/consentService');

test.after(async () => {
  setProviderClientForTests(null);
  await pool.end();
});

// ---- Upload content checks -------------------------------------------------

function makeZip(entries) {
  const parts = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26)];
  const central = [];
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(e.compressed, 20);
    h.writeUInt32LE(e.uncompressed, 24);
    h.writeUInt16LE(name.length, 28);
    central.push(h, name);
  }
  const cd = Buffer.concat(central);
  const offset = parts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

test('file content must match its extension', () => {
  assert.equal(validateContent(Buffer.from('%PDF-1.7\n...'), 'pdf'), null);
  assert.equal(validateContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'png'), null);
  assert.equal(validateContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg'), null);
  assert.equal(validateContent(Buffer.from('Test,Value\nHbA1c,6.1\n'), 'csv'), null);
  assert.match(validateContent(Buffer.from('%PDF-1.7'), 'png'), /don't match/);
  assert.match(validateContent(Buffer.from([0xff, 0xd8, 0xff]), 'pdf'), /don't match/);
  assert.match(validateContent(Buffer.from('MZ\x90\x00'), 'pdf'), /program or script/);
  assert.match(validateContent(Buffer.from('#!/bin/sh\nrm -rf /'), 'csv'), /program or script/);
  assert.match(validateContent(Buffer.from('a,b\0c'), 'csv'), /not a readable CSV/);
  assert.match(validateContent(Buffer.from('<script>alert(1)</script>'), 'csv'), /not a readable CSV/);
  assert.match(validateContent(Buffer.alloc(0), 'pdf'), /empty/);
});

test('zip guard rejects bombs, huge archives and macros', () => {
  assert.equal(inspectZip(makeZip([{ name: 'word/document.xml', compressed: 2000, uncompressed: 9000 }])), null);
  assert.match(inspectZip(makeZip([{ name: 'a.xml', compressed: 1000, uncompressed: 50 * 1024 * 1024 }])), /compressed suspiciously/);
  assert.match(
    inspectZip(makeZip(Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.xml`, compressed: 40 * 1024 * 1024, uncompressed: 40 * 1024 * 1024 })))),
    /unsafe size/
  );
  assert.match(inspectZip(makeZip([{ name: 'word/vbaProject.bin', compressed: 10, uncompressed: 10 }])), /macros/);
  assert.match(inspectZip(Buffer.from('PK\x03\x04 not really a zip')), /not a valid/);
});

// ---- Log redaction ---------------------------------------------------------

test('redaction removes tokens, keys and health data from logs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuv';
  assert.ok(!redactString(`GET /api/files/report/1?token=${jwt}`).includes(jwt));
  assert.ok(!redactString(`Authorization: Bearer ${jwt}`).includes(jwt));
  assert.ok(!redactString('key sk-ant-api03-secretsecret').includes('secretsecret'));
  assert.ok(!redactString(`dek ${'ab'.repeat(32)}`).includes('ab'.repeat(32)));

  const out = redact({
    reportId: 'r1',
    raw_value: '13.2',
    storage_path: '/srv/uploads/x.pdf',
    encrypted_data_key: Buffer.from('k'),
    nested: { prompt: 'patient has diabetes', count: 3 },
  });
  assert.equal(out.raw_value, '[REDACTED]');
  assert.equal(out.storage_path, '[REDACTED]');
  assert.equal(out.encrypted_data_key, '[REDACTED]');
  assert.equal(out.nested.prompt, '[REDACTED]');
  assert.equal(out.nested.count, 3);

  // A pg error carries query parameters/row detail - never logged.
  const pgError = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (raw_value)=(13.2 g/dL) exists', parameters: ['13.2'] });
  const line = describeError(pgError);
  assert.match(line, /code=23505/);
  assert.ok(!line.includes('13.2'));
});

// ---- AI privacy gateway ------------------------------------------------------

test('no code outside src/ai/ talks to the AI SDK directly', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(__dirname, '..', 'src', 'ai')) walk(full);
      } else if (entry.name.endsWith('.js')) {
        const text = fs.readFileSync(full, 'utf8');
        if (/@anthropic-ai\/sdk|new Anthropic\(/.test(text)) offenders.push(path.relative(path.join(__dirname, '..'), full));
      }
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  assert.deepEqual(offenders, []);
});

test('internal ids are stripped before data reaches the model', () => {
  const out = stripInternalIds({
    id: '0b6f1b3e-1111-4222-8333-944444444444',
    report_id: '0b6f1b3e-1111-4222-8333-944444444444',
    measurementIds: ['a'],
    name: 'HbA1c',
    value: '6.1',
    items: [{ health_parameter_id: '0b6f1b3e-1111-4222-8333-944444444444', unit: '%' }],
  });
  assert.deepEqual(out, { name: 'HbA1c', value: '6.1', items: [{ unit: '%' }] });
});

test('db: the gateway enforces consent and audits without content', async (t) => {
  const { rows } = await pool.query(`INSERT INTO users (display_name) VALUES ('Gateway Test') RETURNING id`);
  const userId = rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  const calls = [];
  setProviderClientForTests({
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
      stream: () => ({ finalMessage: async () => ({ content: [] }) }),
    },
  });

  // No consent -> blocked, and no request reaches the provider.
  assert.equal(await isAllowed({ subjectUserId: userId, purpose: 'report_extraction' }), false);
  await assert.rejects(getAiClient({ subjectUserId: userId, purpose: 'report_extraction' }), (err) => err.code === 'ai_consent_required');
  await assert.rejects(getAiClient({ subjectUserId: null, purpose: 'chat' }), (err) => err.code === 'ai_consent_required');
  assert.equal(calls.length, 0);

  // Storage consent alone doesn't authorize AI.
  await consentService.setConsent({ userId, consentType: 'medical_record_storage', granted: true });
  await assert.rejects(getAiClient({ subjectUserId: userId, purpose: 'report_extraction' }));

  await consentService.setConsent({ userId, consentType: 'ai_document_processing', granted: true });
  const client = await getAiClient({ subjectUserId: userId, purpose: 'report_extraction' });
  await client.messages.create({ model: 'x', messages: [{ role: 'user', content: 'Glucose 140 mg/dL' }] });
  assert.equal(calls.length, 1);
  // ...but not insights (a separate consent).
  await assert.rejects(getAiClient({ subjectUserId: userId, purpose: 'chat' }));

  // Revoking stops future calls.
  await consentService.setConsent({ userId, consentType: 'ai_document_processing', granted: false });
  await assert.rejects(getAiClient({ subjectUserId: userId, purpose: 'report_extraction' }));

  // Reference lookups carry no personal data and need no consent.
  await (await getAiClient({ subjectUserId: null, purpose: 'reference_lookup' })).messages.create({ model: 'x', messages: [] });

  const events = await pool.query(
    `SELECT event_type, purpose, provider, row_to_json(e)::text AS j FROM security_audit_events e WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  const types = events.rows.map((r) => r.event_type);
  assert.ok(types.includes('AI_PROCESSING_BLOCKED'));
  assert.ok(types.includes('AI_PROCESSING_STARTED'));
  assert.ok(types.includes('AI_PROCESSING_COMPLETED'));
  assert.ok(types.includes('CONSENT_GRANTED'));
  assert.ok(types.includes('CONSENT_REVOKED'));
  assert.ok(events.rows.every((r) => !r.j.includes('Glucose')), 'no content in audit events');

  const consents = await consentService.getConsents(userId);
  assert.equal(consents.find((c) => c.type === 'medical_record_storage').granted, true);
  assert.equal(consents.find((c) => c.type === 'ai_document_processing').granted, false);
});
