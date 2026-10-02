const pool = require('../../db/pool');
const config = require('../../config');
const { executeTool } = require('../../chat/tools');
const { readTool } = require('./helpers');
const { ServiceError } = require('../../lib/serviceError');
const { reportDisplayTitle } = require('../../lib/reportTitle');

// ChatGPT's connectors and deep research look for two tools with these exact
// names and shapes: search(query) -> { results: [{ id, title, url }] } and
// fetch(id) -> { id, title, text, url, metadata }. They are thin views over
// the same data the richer tools return; Claude can use them too.

const base = () => config.publicBaseUrl;
const url = {
  report: (id) => `${base()}/report/${id}`,
  insight: () => `${base()}/insights`,
  medication: (id) => `${base()}/medications/${id}`,
};

const search = readTool({
  name: 'search',
  description:
    "Search the person's own EyeMyHealth records - reports (by file name, test name or summary), insights and medicines - for a keyword or phrase. " +
    'Returns matching items; pass an item id to `fetch` for its full content.',
  properties: { query: { type: 'string', description: 'Keyword or phrase, e.g. "HbA1c", "thyroid", "metformin".' } },
  required: ['query'],
  raw: true,
  async execute(args, { userId }) {
    const q = typeof args.query === 'string' ? args.query.trim().slice(0, 100) : '';
    if (!q) throw new ServiceError(400, 'query is required.');
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;

    const [reports, insights, meds] = await Promise.all([
      pool.query(
        `SELECT DISTINCT r.id, r.original_filename, r.effective_date, r.report_type, r.source_provider, r.modality, r.body_region
         FROM reports r
         LEFT JOIN health_measurements hm ON hm.report_id = r.id
         LEFT JOIN report_summaries rs ON rs.report_id = r.id
         LEFT JOIN report_summary_versions rsv ON rsv.id = rs.current_version_id
         WHERE r.user_id = $1 AND (r.original_filename ILIKE $2 OR hm.raw_test_name ILIKE $2 OR rsv.summary_text ILIKE $2)
         ORDER BY r.effective_date DESC NULLS LAST LIMIT 10`,
        [userId, like]
      ),
      pool.query(
        `SELECT id, title FROM insights WHERE user_id = $1 AND lifecycle_state = 'active' AND (title ILIKE $2 OR explanation ILIKE $2)
         ORDER BY generated_at DESC LIMIT 10`,
        [userId, like]
      ),
      pool.query(`SELECT id, name FROM medications WHERE user_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 10`, [userId, like]),
    ]);

    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      data: {
        results: [
          ...reports.rows.map((r) => ({
            id: `report:${r.id}`,
            title: reportDisplayTitle(r),
            url: url.report(r.id),
          })),
          ...insights.rows.map((i) => ({ id: `insight:${i.id}`, title: `Insight: ${i.title}`, url: url.insight() })),
          ...meds.rows.map((m) => ({ id: `medication:${m.id}`, title: `Medicine: ${m.name}`, url: url.medication(m.id) })),
        ],
      },
      evidence: [],
    };
  },
});

const fetch = readTool({
  name: 'fetch',
  description: 'Get the full content of one item returned by `search` (a report with its results, an insight with its evidence, or a medicine), by its id.',
  properties: { id: { type: 'string', description: 'An id from `search`, like "report:<uuid>".' } },
  required: ['id'],
  raw: true,
  async execute(args, ctx) {
    const [kind, id] = String(args.id || '').split(':');
    const run = { report: ['get_report_by_id', { reportId: id }], insight: ['explain_insight', { insightId: id }], medication: ['get_medication_detail', { medicationId: id }] }[kind];
    if (!run || !id) throw new ServiceError(400, 'Unknown id. Use an id returned by search.');
    const { data } = await executeTool(run[0], run[1], ctx);
    if (data?.found === false) throw new ServiceError(404, 'Item not found');
    const title =
      kind === 'report' ? data.report?.displayTitle || data.report?.original_filename : kind === 'insight' ? data.title : data.medication?.name || data.name || 'Medicine';
    return {
      data: { id: args.id, title: title || args.id, text: JSON.stringify(data), url: url[kind](id), metadata: { type: kind } },
      evidence: [],
    };
  },
});

module.exports = [search, fetch];
