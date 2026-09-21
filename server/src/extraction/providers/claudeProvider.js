const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');

const SYSTEM_PROMPT = [
  'You are a precise medical document data-extraction engine.',
  'Extract only what is explicitly present in the document.',
  'Never invent, infer, or guess a value, unit, reference range, date, or diagnosis that is not printed in the source.',
  'If a field is not present, omit it or use null rather than fabricating one.',
  'If a value is unclear or you are not confident you read it correctly, still report it but lower its confidence score.',
  'This is a data-capture task, not a diagnostic one: never add clinical interpretation beyond what the report itself states.',
].join(' ');

const DOCUMENT_INSTRUCTION =
  'Extract every lab/health test result from this health report, plus the report-level details below, by calling ' +
  'record_health_parameters once. Put every result in "parameters" (one entry per result) and everything about the ' +
  'report as a whole - the issuing lab/facility name, the overall panel/report type, its date, any free-text notes ' +
  '(e.g. fasting status, specimen condition, physician remarks), and any critical/panic-value or other alert text - in ' +
  '"document". If the document is unreadable or contains no test results, still call it, with an empty parameters array.';

const EXTRACTION_TOOL = {
  name: 'record_health_parameters',
  description:
    'Record every clinically relevant test/result found in the document, plus report-level details (lab name, report ' +
    'type, date, notes, alerts). Never invent values, units, dates, or text that are not present in the source.',
  input_schema: {
    type: 'object',
    properties: {
      document: {
        type: 'object',
        description: 'Details about the report as a whole, as opposed to any single test result.',
        properties: {
          lab_name: {
            type: ['string', 'null'],
            description: 'The issuing lab, hospital, or clinic name exactly as printed, or null if not present.',
          },
          report_type: {
            type: ['string', 'null'],
            description:
              'The overall panel/report name as printed (e.g. "Complete Blood Count", "Comprehensive Metabolic Panel", ' +
              '"Lipid Profile"), or null if not present.',
          },
          report_date: {
            type: ['string', 'null'],
            description:
              'The single most prominent date printed on the report (collection, test, or result date) in YYYY-MM-DD ' +
              'form, or null if none is legible.',
          },
          notes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Free-text remarks printed on the report that are not a specific test result (e.g. fasting status, ' +
              'specimen condition, physician comments, methodology notes). Omit if none.',
          },
          alerts: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Any critical/panic-value flags or other explicit alert/warning text printed on the report, exactly as ' +
              'stated. Omit if none - do not infer an alert merely from an out-of-range value.',
          },
        },
      },
      parameters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            test_name: { type: 'string', description: 'Test/parameter name exactly as printed in the source.' },
            value: {
              type: 'string',
              description:
                'Result value exactly as printed, including any comparator (e.g. "<5") or qualitative wording (e.g. "Not Detected").',
            },
            unit: { type: ['string', 'null'], description: 'Unit exactly as printed, or null if none.' },
            reference_range: { type: ['string', 'null'], description: 'Reference/normal range exactly as printed, or null.' },
            status_flag: {
              type: ['string', 'null'],
              description: 'Abnormal flag as printed (e.g. High/Low/Normal/H/L), or null.',
            },
            date: { type: ['string', 'null'], description: 'Sample or result date in YYYY-MM-DD if present, else null.' },
            confidence: { type: 'number', description: '0-1 confidence that this was read correctly from the source.' },
          },
          required: ['test_name', 'value', 'confidence'],
        },
      },
    },
    required: ['parameters'],
  },
};

function serializeTables(tables) {
  return tables.map((rows) => rows.map((row) => row.join(', ')).join('\n')).join('\n\n---\n\n');
}

function buildContent(document, context) {
  if (document.contentKind === 'text_native' && document.text) {
    return [{ type: 'text', text: `${DOCUMENT_INSTRUCTION}\n\n${document.text}` }];
  }
  if (document.contentKind === 'structured_table' && document.tables) {
    return [{ type: 'text', text: `${DOCUMENT_INSTRUCTION}\n\n${serializeTables(document.tables)}` }];
  }
  // A scanned/photographed multi-page PDF, pre-rendered to one image per
  // page by pdfAdapter - hand every page to the model in one call so it can
  // still relate a result on one page to a name/section printed on another.
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    const imageBlocks = document.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return [...imageBlocks, { type: 'text', text: DOCUMENT_INSTRUCTION }];
  }
  if (document.contentKind === 'image_scanned' && context.filePath && /^image\//.test(context.mimeType || '')) {
    const base64 = fs.readFileSync(context.filePath).toString('base64');
    return [
      { type: 'image', source: { type: 'base64', media_type: context.mimeType, data: base64 } },
      { type: 'text', text: DOCUMENT_INSTRUCTION },
    ];
  }
  // No text, no table, and no image to read (e.g. a scanned PDF that
  // rendered zero pages) - reported as a warning rather than attempted blindly.
  return null;
}

// Provider-agnostic contract: extract(document, context) -> { candidates,
// warnings, rawModelOutput }, where `candidates` matches the same shape the
// heuristic provider produces. Swapping providers never changes downstream
// normalization/business logic.
async function extract(document, context = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('EXTRACTION_PROVIDER=claude requires ANTHROPIC_API_KEY to be set.');
  }

  const content = buildContent(document, context);
  if (!content) {
    return {
      candidates: [],
      warnings: ['Claude provider has no supported content to extract from this document (e.g. a scanned PDF page render).'],
      rawModelOutput: null,
      ocrAttempted: false,
    };
  }
  const isVisionRequest = document.contentKind === 'image_scanned';

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    // A long multi-page report can legitimately have 60-100+ result rows;
    // 4096 output tokens was enough to silently truncate the tool call
    // (and Anthropic's tool-use JSON, unlike plain text, can't be
    // salvaged once cut off mid-argument) on reports with a lot of detail.
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content }],
  });

  const warnings = [];
  if (response.stop_reason === 'max_tokens') {
    warnings.push('Claude output was truncated (hit the token limit) - some results near the end of this document may be missing.');
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return {
      candidates: [],
      warnings: [...warnings, 'Claude did not return a structured extraction result.'],
      rawModelOutput: response,
      ocrAttempted: isVisionRequest,
    };
  }

  const parameters = Array.isArray(toolUse.input?.parameters) ? toolUse.input.parameters : [];
  const candidates = parameters
    .filter((p) => p && p.test_name && p.value !== undefined && p.value !== null)
    .map((p) => ({
      test_name: String(p.test_name),
      value: String(p.value),
      unit: p.unit || null,
      reference_range: p.reference_range || null,
      status_flag: p.status_flag || null,
      param_date: p.date || null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.7,
      needs_review: typeof p.confidence !== 'number' || p.confidence < 0.75,
      raw_source_text: null,
    }));

  const doc = toolUse.input?.document || {};
  const documentInfo = {
    labName: doc.lab_name || null,
    reportType: doc.report_type || null,
    reportDate: doc.report_date || null,
    notes: Array.isArray(doc.notes) ? doc.notes.filter((n) => typeof n === 'string' && n.trim()) : [],
    alerts: Array.isArray(doc.alerts) ? doc.alerts.filter((a) => typeof a === 'string' && a.trim()) : [],
  };

  return { candidates, warnings, rawModelOutput: toolUse.input, document: documentInfo, ocrAttempted: isVisionRequest };
}

module.exports = { name: 'claude', extract, buildContent };
