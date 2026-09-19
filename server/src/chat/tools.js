const pool = require('../db/pool');
const registry = require('../extraction/registry');

// Every tool's `execute(args, context)` receives `context.userId` injected
// by the orchestrator from the authenticated request — never from the
// model's tool-call arguments. No inputSchema below declares a user/account
// field, and every query below scopes by `context.userId`, so a user cannot
// retrieve another user's data through prompt manipulation: there is no
// argument path that reaches a different user's rows.

function evidenceFor(type, rows, idField = 'id', labelField = null) {
  return rows.map((row) => ({ type, id: row[idField], label: labelField ? row[labelField] : undefined }));
}

function comparableValue(m) {
  return m.normalized_value ?? m.numeric_value ?? null;
}

const getLatestReport = {
  name: 'get_latest_report',
  description: "Get the user's most recent uploaded health report, optionally filtered by report type.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { reportType: { type: 'string', description: 'Optional report type filter, e.g. "lipid panel".' } },
  },
  async execute(args, { userId }) {
    const { rows } = await pool.query(
      `SELECT id, original_filename, effective_date, ingestion_status, generated_summary, report_type
       FROM reports
       WHERE user_id = $1 AND ($2::text IS NULL OR report_type ILIKE '%' || $2 || '%')
       ORDER BY COALESCE(effective_date, created_at::date) DESC, created_at DESC
       LIMIT 1`,
      [userId, args.reportType || null]
    );
    if (rows.length === 0) return { data: { found: false }, evidence: [] };
    const report = rows[0];
    const measurementCount = await pool.query('SELECT count(*) FROM health_measurements WHERE report_id = $1', [
      report.id,
    ]);
    return {
      data: { ...report, measurementCount: Number(measurementCount.rows[0].count) },
      evidence: [{ type: 'report', id: report.id, label: report.original_filename }],
    };
  },
};

const getReportById = {
  name: 'get_report_by_id',
  description: 'Get full detail (measurements, summary, dates) for one of the user\'s reports by its ID.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { reportId: { type: 'string' } },
    required: ['reportId'],
  },
  async execute(args, { userId }) {
    const reportResult = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [
      args.reportId,
      userId,
    ]);
    if (reportResult.rows.length === 0) return { data: { found: false }, evidence: [] };
    const report = reportResult.rows[0];
    const measurements = await pool.query(
      `SELECT hm.id, hm.raw_test_name, hm.raw_value, hm.raw_unit, hm.status_flag, hp.display_name AS parameter_display_name
       FROM health_measurements hm
       LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE hm.report_id = $1`,
      [report.id]
    );
    return {
      data: { report, measurements: measurements.rows },
      evidence: [
        { type: 'report', id: report.id, label: report.original_filename },
        ...evidenceFor('measurement', measurements.rows),
      ],
    };
  },
};

const compareReports = {
  name: 'compare_reports',
  description: 'Deterministically compare shared canonical parameters between two of the user\'s reports.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { reportIdA: { type: 'string' }, reportIdB: { type: 'string' } },
    required: ['reportIdA', 'reportIdB'],
  },
  async execute(args, { userId }) {
    const reports = await pool.query('SELECT id, original_filename FROM reports WHERE id = ANY($1) AND user_id = $2', [
      [args.reportIdA, args.reportIdB],
      userId,
    ]);
    if (reports.rows.length !== 2) return { data: { found: false }, evidence: [] };

    const measurements = await pool.query(
      `SELECT hm.*, hp.display_name AS parameter_display_name
       FROM health_measurements hm
       JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE hm.report_id = ANY($1)`,
      [[args.reportIdA, args.reportIdB]]
    );
    const byParam = new Map();
    for (const m of measurements.rows) {
      if (!byParam.has(m.health_parameter_id)) byParam.set(m.health_parameter_id, {});
      byParam.get(m.health_parameter_id)[m.report_id] = m;
    }

    const comparisons = [];
    const evidenceMeasurementIds = [];
    for (const pair of byParam.values()) {
      const a = pair[args.reportIdA];
      const b = pair[args.reportIdB];
      if (!a || !b) continue;
      evidenceMeasurementIds.push(a.id, b.id);
      const valueA = comparableValue(a);
      const valueB = comparableValue(b);
      comparisons.push({
        parameter: a.parameter_display_name,
        reportAValue: a.qualitative_value ?? valueA,
        reportBValue: b.qualitative_value ?? valueB,
        unit: a.normalized_unit || a.raw_unit || '',
        pctChange: valueA && valueB ? Math.round(((valueB - valueA) / Math.abs(valueA)) * 100) : null,
      });
    }

    return {
      data: { reportA: reports.rows.find((r) => r.id === args.reportIdA), reportB: reports.rows.find((r) => r.id === args.reportIdB), comparisons },
      evidence: [
        ...evidenceFor('report', reports.rows, 'id', 'original_filename'),
        ...evidenceMeasurementIds.map((id) => ({ type: 'measurement', id })),
      ],
    };
  },
};

const RANGE_TO_DAYS = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365, all: null };
const MAX_TREND_POINTS = 30;

const getMeasurementTrend = {
  name: 'get_measurement_trend',
  description:
    'Get the user\'s confirmed measurement history for one canonical parameter (by code, e.g. "hba1c", "hemoglobin"), with deterministic min/max/average/direction already calculated.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parameterCode: { type: 'string' },
      range: { type: 'string', enum: Object.keys(RANGE_TO_DAYS) },
    },
    required: ['parameterCode'],
  },
  async execute(args, { userId }) {
    const parameter = (await registry.searchParameters(args.parameterCode, 1))[0];
    if (!parameter) return { data: { found: false }, evidence: [] };

    const days = RANGE_TO_DAYS[args.range] ?? 365;
    const { rows } = await pool.query(
      `SELECT hm.id AS measurement_id, hm.report_id, r.original_filename,
              COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS date,
              hm.normalized_value, hm.numeric_value, hm.normalized_unit, hm.raw_unit, hm.qualitative_value
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       WHERE r.user_id = $1 AND hm.health_parameter_id = $2 AND hm.is_confirmed = true
         AND ($3::int IS NULL OR COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) >= CURRENT_DATE - $3::int)
       ORDER BY date ASC
       LIMIT ${MAX_TREND_POINTS}`,
      [userId, parameter.id, days]
    );

    const numericPoints = rows.map((r) => r.normalized_value ?? r.numeric_value).filter((v) => v !== null);
    const stats =
      numericPoints.length > 0
        ? {
            min: Math.min(...numericPoints),
            max: Math.max(...numericPoints),
            average: Math.round((numericPoints.reduce((a, b) => a + b, 0) / numericPoints.length) * 100) / 100,
            first: numericPoints[0],
            last: numericPoints[numericPoints.length - 1],
            direction:
              numericPoints.length > 1
                ? numericPoints[numericPoints.length - 1] > numericPoints[0]
                  ? 'up'
                  : numericPoints[numericPoints.length - 1] < numericPoints[0]
                    ? 'down'
                    : 'flat'
                : 'flat',
          }
        : null;

    return {
      data: {
        parameter: { code: parameter.code, displayName: parameter.display_name, unit: parameter.canonical_unit },
        points: rows.map((r) => ({
          date: r.date,
          value: r.qualitative_value ?? r.normalized_value ?? r.numeric_value,
          unit: r.normalized_unit || r.raw_unit,
          reportFilename: r.original_filename,
        })),
        stats,
      },
      evidence: [...evidenceFor('measurement', rows, 'measurement_id'), ...evidenceFor('report', rows, 'report_id')],
    };
  },
};

const findMeasurementsInDateRange = {
  name: 'find_measurements_in_date_range',
  description: "Find the user's confirmed measurements within a date range, optionally filtered to one parameter.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parameterCode: { type: 'string' },
      dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
      dateTo: { type: 'string', description: 'YYYY-MM-DD' },
    },
    required: ['dateFrom', 'dateTo'],
  },
  async execute(args, { userId }) {
    let parameterId = null;
    if (args.parameterCode) {
      const parameter = (await registry.searchParameters(args.parameterCode, 1))[0];
      if (parameter) parameterId = parameter.id;
    }

    const { rows } = await pool.query(
      `SELECT hm.id AS measurement_id, hm.report_id, hp.display_name AS parameter_display_name,
              hm.raw_value, hm.raw_unit, hm.status_flag, r.original_filename,
              COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS date
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE r.user_id = $1 AND hm.is_confirmed = true
         AND COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) BETWEEN $2 AND $3
         AND ($4::uuid IS NULL OR hm.health_parameter_id = $4)
       ORDER BY date ASC
       LIMIT 25`,
      [userId, args.dateFrom, args.dateTo, parameterId]
    );

    return {
      data: { measurements: rows },
      evidence: [...evidenceFor('measurement', rows, 'measurement_id'), ...evidenceFor('report', rows, 'report_id')],
    };
  },
};

const getHighestOrLowestInRange = {
  name: 'get_highest_or_lowest_in_range',
  description: "Get the user's highest or lowest confirmed value for a parameter within a date range, with its source.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parameterCode: { type: 'string' },
      dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
      dateTo: { type: 'string', description: 'YYYY-MM-DD' },
      direction: { type: 'string', enum: ['max', 'min'] },
    },
    required: ['parameterCode', 'dateFrom', 'dateTo', 'direction'],
  },
  async execute(args, { userId }) {
    const parameter = (await registry.searchParameters(args.parameterCode, 1))[0];
    if (!parameter) return { data: { found: false }, evidence: [] };

    const order = args.direction === 'min' ? 'ASC' : 'DESC';
    const { rows } = await pool.query(
      `SELECT hm.id AS measurement_id, hm.report_id, hm.raw_value, hm.raw_unit, hm.normalized_value, hm.numeric_value,
              r.original_filename, COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS date
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       WHERE r.user_id = $1 AND hm.health_parameter_id = $2 AND hm.is_confirmed = true
         AND COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) BETWEEN $3 AND $4
         AND COALESCE(hm.normalized_value, hm.numeric_value) IS NOT NULL
       ORDER BY COALESCE(hm.normalized_value, hm.numeric_value) ${order}
       LIMIT 1`,
      [userId, parameter.id, args.dateFrom, args.dateTo]
    );
    if (rows.length === 0) return { data: { found: false }, evidence: [] };
    const row = rows[0];
    return {
      data: { value: row.raw_value, unit: row.raw_unit, date: row.date, reportFilename: row.original_filename },
      evidence: [
        { type: 'measurement', id: row.measurement_id },
        { type: 'report', id: row.report_id, label: row.original_filename },
      ],
    };
  },
};

const searchReports = {
  name: 'search_reports',
  description: "Search the user's reports by filename or measurement/test name keyword.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
  },
  async execute(args, { userId }) {
    const { rows } = await pool.query(
      `SELECT DISTINCT r.id, r.original_filename, r.effective_date
       FROM reports r
       LEFT JOIN health_measurements hm ON hm.report_id = r.id
       WHERE r.user_id = $1 AND (r.original_filename ILIKE '%' || $2 || '%' OR hm.raw_test_name ILIKE '%' || $2 || '%')
       ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC
       LIMIT 10`,
      [userId, args.keyword]
    );
    return { data: { reports: rows }, evidence: evidenceFor('report', rows, 'id', 'original_filename') };
  },
};

const explainInsight = {
  name: 'explain_insight',
  description: 'Get the full evidence-backed explanation behind one of the user\'s AI insights/alerts, by its ID.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { insightId: { type: 'string' } },
    required: ['insightId'],
  },
  async execute(args, { userId }) {
    const { rows } = await pool.query('SELECT * FROM insights WHERE id = $1 AND user_id = $2', [
      args.insightId,
      userId,
    ]);
    if (rows.length === 0) return { data: { found: false }, evidence: [] };
    const insight = rows[0];
    return {
      data: { title: insight.title, explanation: insight.explanation, type: insight.insight_type, severity: insight.severity },
      evidence: [{ type: 'insight', id: insight.id, label: insight.title }, ...insight.evidence],
    };
  },
};

const listActiveInsights = {
  name: 'list_active_insights',
  description: "List the user's current active AI insights/alerts (things flagged as worth attention).",
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  async execute(args, { userId }) {
    const { rows } = await pool.query(
      `SELECT id, title, explanation, severity, insight_type FROM insights
       WHERE user_id = $1 AND lifecycle_state = 'active' ORDER BY generated_at DESC LIMIT 10`,
      [userId]
    );
    return { data: { insights: rows }, evidence: evidenceFor('insight', rows, 'id', 'title') };
  },
};

const TOOLS = [
  getLatestReport,
  getReportById,
  compareReports,
  getMeasurementTrend,
  findMeasurementsInDateRange,
  getHighestOrLowestInRange,
  searchReports,
  explainInsight,
  listActiveInsights,
];

function getToolDefinitions() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function executeTool(name, args, context) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}"`);
  return tool.execute(args || {}, context);
}

module.exports = { getToolDefinitions, executeTool };
