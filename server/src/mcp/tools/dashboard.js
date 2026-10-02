const dashboardRoutes = require('../../routes/dashboard');
const { listTimeline } = require('../../services/timelineService');
const { readTool, evidence } = require('./helpers');

const getDashboardSnapshot = readTool({
  name: 'get_dashboard_snapshot',
  description:
    "The person's dashboard: pinned metrics with latest and previous values, results that need attention (latest out-of-range or awaiting review), and active insights.",
  async execute(args, { userId }) {
    const data = await dashboardRoutes.buildSnapshot(userId);
    return { data, evidence: evidence('report', data.needsAttention, 'report_id', 'displayTitle') };
  },
});

const getOrganHealth = readTool({
  name: 'get_organ_health',
  description:
    'One card per body organ group (liver, kidney, heart, blood, thyroid, diabetes ...): how many of its latest results are in range and which are high or low, judged by the lab\'s own range or a standard reference range.',
  async execute(args, { userId, language }) {
    return { data: await dashboardRoutes.buildOrgans(userId, language), evidence: [] };
  },
});

const getNeedsAttention = readTool({
  name: 'get_needs_attention',
  description: 'Only the latest results per test that are out of range (with direction, severity and unit) or are unmapped/unreadable and still need review, with the report each came from. Normal results are never listed. `counts` gives the totals (abnormal vs review-only; older review-only leftovers are hidden) and `truncated` says whether the list was cut.',
  async execute(args, { userId }) {
    const { items, counts, truncated } = await dashboardRoutes.fetchNeedsAttentionDetailed(userId);
    return { data: { items, counts, truncated }, evidence: evidence('report', items, 'report_id', 'displayTitle') };
  },
});

const listTimeline_ = readTool({
  name: 'list_timeline',
  description:
    'Chronological list of reports, newest first, with abnormal-result counts and summaries. Filter by date range, report type, source, parameter category or free-text search.',
  properties: {
    dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
    dateTo: { type: 'string', description: 'YYYY-MM-DD' },
    reportType: { type: 'string' },
    source: { type: 'string' },
    category: { type: 'string' },
    search: { type: 'string' },
  },
  async execute(args, { userId }) {
    const rows = await listTimeline(userId, args);
    const trimmed = rows.slice(0, 100);
    return { data: { timeline: trimmed, truncated: rows.length > trimmed.length }, evidence: evidence('report', trimmed, 'id', 'displayTitle') };
  },
});

module.exports = [getDashboardSnapshot, getOrganHealth, getNeedsAttention, listTimeline_];
