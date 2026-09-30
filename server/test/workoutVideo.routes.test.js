const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../src/db/pool');
const config = require('../src/config');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');
const { setKeyProvider } = require('../src/security/keyProvider');
const { createLocalDevProvider } = require('../src/security/providers/localDev');
const { setConsent } = require('../src/security/consentService');

let a;
let b;
let tokenA;
let tokenB;
let tempDir;
let originalDir;

// A tiny but structurally valid MP4 header ('ftyp' box) plus filler bytes.
function fakeMp4(size = 4096) {
  const buf = Buffer.alloc(size, 7);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wvideo-'));
  originalDir = config.security.encryptedStoreDir;
  config.security.encryptedStoreDir = tempDir;
  if (!config.security.localDevMasterKey) config.security.localDevMasterKey = crypto.randomBytes(32).toString('hex');
  setKeyProvider(createLocalDevProvider({ masterKeyHex: config.security.localDevMasterKey, nodeEnv: 'test', keyVersion: 'local-dev-v1' }));
  a = (await pool.query(`INSERT INTO users (display_name) VALUES ('video test A') RETURNING id`)).rows[0].id;
  b = (await pool.query(`INSERT INTO users (display_name) VALUES ('video test B') RETURNING id`)).rows[0].id;
  tokenA = signSession({ id: a });
  tokenB = signSession({ id: b });
  for (const id of [a, b]) await setConsent({ userId: id, consentType: 'medical_record_storage', granted: true, grantedBy: id, sourcePlatform: 'test' });
});

test.after(async () => {
  config.security.encryptedStoreDir = originalDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[a, b]]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const J = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const A = (t) => ({ Authorization: `Bearer ${t}` });

function form(buf, name = 'workout.mp4') {
  const f = new FormData();
  f.append('video', new Blob([buf], { type: 'video/mp4' }), name);
  return f;
}

test('retained video: upload, verify, playback with ranges, cross-user isolation, hard delete', async () => {
  const { server, base } = await listen();
  const W = `${base}/api/activity/workouts`;
  try {
    const session = await (await fetch(W, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ exerciseId: 'squat', targetSets: 1, targetReps: 1 }) })).json();
    const id = session.id;
    const mp4 = fakeMp4();

    // Not finished yet -> refused.
    assert.equal((await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(mp4) })).status, 409);
    await fetch(`${W}/${id}/start`, { method: 'POST', headers: J(tokenA) });
    await fetch(`${W}/${id}/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ activeSeconds: 10 }) });

    // Wrong type / bad content / other user.
    assert.equal((await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(mp4, 'x.exe') })).status, 400);
    assert.equal((await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(Buffer.from('not a video at all'), 'x.mp4') })).status, 400);
    assert.equal((await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenB), body: form(mp4) })).status, 404);

    const up = await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(mp4) });
    assert.equal(up.status, 201);
    const asset = await up.json();
    assert.equal(asset.uploadStatus, 'uploaded');
    assert.equal(asset.sizeBytes, mp4.length);
    // Stored encrypted: the ciphertext file must not contain the plaintext filler.
    const stored = fs.readdirSync(tempDir).filter((f) => !f.includes('.tmp-'));
    assert.equal(stored.length, 1);
    assert.equal(fs.readFileSync(path.join(tempDir, stored[0])).includes(Buffer.alloc(64, 7)), false);
    assert.equal((await fetch(`${W}/${id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(mp4) })).status, 409);

    // Integrity: a wrong hash fails, the right one verifies.
    const wrong = await (await fetch(`${W}/${id}/video/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ sha256: 'ab'.repeat(32) }) })).json();
    assert.equal(wrong.verified, false);
    const sha = crypto.createHash('sha256').update(mp4).digest('hex');
    const ok = await (await fetch(`${W}/${id}/video/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ sha256: sha }) })).json();
    assert.equal(ok.verified, true);
    assert.equal(ok.uploadStatus, 'verified');
    const md5 = crypto.createHash('md5').update(mp4).digest('hex');
    const viaMd5 = await (await fetch(`${W}/${id}/video/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ md5 }) })).json();
    assert.equal(viaMd5.verified, true);
    const none = await (await fetch(`${W}/${id}/video/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({}) })).json();
    assert.equal(none.verified, false); // no hash supplied is never "verified"
    await fetch(`${W}/${id}/video/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ sha256: sha }) });

    // Other users can't read status, mint a URL, or see landmarks.
    assert.equal((await fetch(`${W}/${id}/video`, { headers: A(tokenB) })).status, 404);
    assert.equal((await fetch(`${W}/${id}/video/url`, { method: 'POST', headers: J(tokenB) })).status, 404);

    // Playback: token-only, range support, no-store.
    const { url } = await (await fetch(`${W}/${id}/video/url`, { method: 'POST', headers: J(tokenA) })).json();
    const full = await fetch(`${base}${url}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), mp4);
    const part = await fetch(`${base}${url}`, { headers: { Range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 10-19/${mp4.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), mp4.subarray(10, 20));
    assert.equal((await fetch(`${base}${url}`, { headers: { Range: 'bytes=99999-' } })).status, 416);
    assert.equal((await fetch(`${base}/api/files/workout-video/${asset.id}?token=garbage`)).status, 404);
    // A token minted for one user's asset can't be replayed against another id.
    assert.equal((await fetch(`${base}${url.replace(asset.id, crypto.randomUUID())}`)).status, 404);

    // Landmarks for the overlay, then local-copy bookkeeping.
    const seg = await fetch(`${W}/${id}/pose-segments`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ fps: 5, frames: [{ t: 0, lm: { LEFT_KNEE: [0.5, 0.6] } }] }) });
    assert.equal(seg.status, 200);
    const got = await (await fetch(`${W}/${id}/pose-segments`, { headers: A(tokenA) })).json();
    assert.equal(got.frames.length, 1);
    const local = await (await fetch(`${W}/${id}/video/local-deleted`, { method: 'POST', headers: J(tokenA) })).json();
    assert.ok(local.localCopyDeletedAt);

    // Hard delete: file gone, playback dead, landmarks gone, tombstone kept.
    const del = await fetch(`${W}/${id}/video`, { method: 'DELETE', headers: J(tokenA) });
    assert.equal(del.status, 200);
    assert.equal(fs.readdirSync(tempDir).filter((f) => !f.includes('.tmp-')).length, 0);
    assert.equal((await fetch(`${base}${url}`)).status, 404);
    const status = await (await fetch(`${W}/${id}/video`, { headers: A(tokenA) })).json();
    assert.equal(status.exists, false);
    assert.equal(status.retentionStatus, 'deleted');
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM workout_pose_segment WHERE workout_session_id = $1', [id])).rows[0].n, 0);
    const audits = await pool.query(`SELECT event_type FROM security_audit_events WHERE user_id = $1 AND event_type LIKE 'WORKOUT_VIDEO_%'`, [a]);
    assert.deepEqual(audits.rows.map((r) => r.event_type).sort(), ['WORKOUT_VIDEO_DELETED', 'WORKOUT_VIDEO_UPLOADED', 'WORKOUT_VIDEO_VIEWED']);
  } finally {
    server.close();
  }
});

test('deleting a workout also hard-deletes its retained recording from the vault', async () => {
  const { server, base } = await listen();
  const W = `${base}/api/activity/workouts`;
  try {
    const session = await (await fetch(W, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ exerciseId: 'squat', targetSets: 1, targetReps: 1 }) })).json();
    await fetch(`${W}/${session.id}/start`, { method: 'POST', headers: J(tokenA) });
    await fetch(`${W}/${session.id}/complete`, { method: 'POST', headers: J(tokenA), body: JSON.stringify({ activeSeconds: 10 }) });
    const before = fs.readdirSync(tempDir).filter((f) => !f.includes('.tmp-')).length;
    assert.equal((await fetch(`${W}/${session.id}/video/upload`, { method: 'POST', headers: A(tokenA), body: form(fakeMp4()) })).status, 201);
    assert.equal(fs.readdirSync(tempDir).filter((f) => !f.includes('.tmp-')).length, before + 1);

    const del = await (await fetch(`${W}/${session.id}`, { method: 'DELETE', headers: J(tokenA) })).json();
    assert.equal(del.deleted, 1);
    assert.equal(fs.readdirSync(tempDir).filter((f) => !f.includes('.tmp-')).length, before);
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM workout_video_asset WHERE workout_session_id = $1', [session.id]);
    assert.equal(rows.rows[0].n, 0);
    const audits = await pool.query(`SELECT event_type FROM security_audit_events WHERE user_id = $1 AND event_type = 'WORKOUT_DELETED'`, [a]);
    assert.ok(audits.rows.length >= 1);
  } finally {
    server.close();
  }
});
