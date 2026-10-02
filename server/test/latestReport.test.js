const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { executeTool } = require('../src/chat/tools');

// Regression: a glucose-meter spreadsheet (no lab results, undated) was
// ranked as the "latest report" ahead of the full lab panel because the
// order fell back to its upload date.

let userId;
let labId;
let glucoseId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (email, display_name) VALUES ('latest-report-test@example.com', 'LR') RETURNING id`);
  userId = user.rows[0].id;
  const insert = (name, date, extra = '') =>
    pool.query(
      `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date, report_type, source_provider)
       VALUES ($1, $2, 'application/pdf', 'pdf', 10, '/tmp/x', 'Needs Review', $3, $4, $5) RETURNING id`,
      [userId, name, date, extra ? 'Complete Blood Count' : null, extra ? 'Apollo' : null]
    );
  labId = (await insert('c0de1.pdf', '2025-08-31', 'lab')).rows[0].id;
  glucoseId = (await insert('meter.xlsx', null)).rows[0].id; // undated, uploaded later
  await pool.query(
    `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, value_type, numeric_value) VALUES ($1, 'Hb', '13', 'numeric', 13)`,
    [labId]
  );
  await pool.query(
    `INSERT INTO glucose_readings (user_id, report_id, measured_at, value_mg_dl) VALUES ($1, $2, '2025-09-02 08:00', 110)`,
    [userId, glucoseId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('get_latest_report skips device exports by default and returns a readable title', async () => {
  const { data } = await executeTool('get_latest_report', {}, { userId });
  assert.equal(data.id, labId);
  assert.equal(data.displayTitle, 'Complete Blood Count · Apollo · 2025-08-31');
});

test('includeDeviceExports opts back in; an undated export never outranks a dated report', async () => {
  const { data } = await executeTool('get_latest_report', { includeDeviceExports: true }, { userId });
  assert.equal(data.id, labId);
  await pool.query(`UPDATE reports SET effective_date = '2025-09-02' WHERE id = $1`, [glucoseId]);
  const again = await executeTool('get_latest_report', { includeDeviceExports: true }, { userId });
  assert.equal(again.data.id, glucoseId);
});

test('a glucometer log that has extracted glucose results is still not the latest lab report', async () => {
  const user = await pool.query(`INSERT INTO users (email, display_name) VALUES ('latest-report-glucose-log@example.com', 'LG') RETURNING id`);
  const uid = user.rows[0].id;
  try {
    const mk = async (name, date) =>
      (
        await pool.query(
          `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
           VALUES ($1, $2, 'application/pdf', 'pdf', 10, '/tmp/x', 'Needs Review', $3) RETURNING id`,
          [uid, name, date]
        )
      ).rows[0].id;
    const lab = await mk('panel.pdf', '2026-08-31');
    const log = await mk('meter.xlsx', '2026-09-20');
    const param = async (code) => (await pool.query('SELECT id FROM health_parameters WHERE code = $1', [code])).rows[0].id;
    const add = (report, parameterId, name) =>
      pool.query(
        `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, value_type, numeric_value) VALUES ($1, $2, $3, '100', 'numeric', 100)`,
        [report, parameterId, name]
      );
    await add(lab, await param('hemoglobin'), 'Hb');
    await add(log, await param('glucose'), 'Glucose');
    const { data } = await executeTool('get_latest_report', {}, { userId: uid });
    assert.equal(data.id, lab);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  }
});

test('get_latest_report counts agree with the needs-attention list, and the timeline uses the same rule', async () => {
  const { listTimeline } = require('../src/services/timelineService');
  const { fetchNeedsAttentionDetailed } = require('../src/routes/dashboard');
  const user = await pool.query(`INSERT INTO users (email, display_name) VALUES ('latest-report-counts@example.com', 'LC') RETURNING id`);
  const uid = user.rows[0].id;
  try {
    const rid = (
      await pool.query(
        `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date, generated_summary)
         VALUES ($1, 'p.pdf', 'application/pdf', 'pdf', 10, '/tmp/x', 'Needs Review', '2026-08-31', 'Extracted 3 health parameters. 16 flagged outside the reference range: stale snapshot.') RETURNING id`,
        [uid]
      )
    ).rows[0].id;
    const param = async (code) => (await pool.query('SELECT id FROM health_parameters WHERE code = $1', [code])).rows[0].id;
    const add = async (code, name, value, flag, range) =>
      pool.query(
        `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, value_type, numeric_value, normalized_value, status_flag, reference_range_raw)
         VALUES ($1, $2, $3, $4, 'numeric', $5, $5, $6, $7)`,
        [rid, await param(code), name, String(value), value, flag, range]
      );
    await add('hemoglobin', 'Hb', 9, 'Low', '13-17'); // out of range
    await add('vitamin_d', 'Vit D', 20.6, null, '30-100'); // out of range, no flag printed
    await add('creatinine', 'Creatinine', 0.9, 'Normal', '0.7-1.3'); // in range

    const { data } = await executeTool('get_latest_report', {}, { userId: uid });
    assert.equal(data.counts.outOfRange, 2);
    assert.match(data.summary, /2 outside the reference range/);
    const list = await fetchNeedsAttentionDetailed(uid);
    assert.equal(list.counts.abnormal, data.counts.outOfRange);

    const [timelineRow] = await listTimeline(uid);
    assert.equal(timelineRow.abnormal_count, 2);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  }
});
