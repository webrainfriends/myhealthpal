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
  'Extract every lab/health test result from this health report by calling record_health_parameters with one entry per result. ' +
  'If the document is unreadable or contains no test results, call it with an empty parameters array.';

const EXTRACTION_TOOL = {
  name: 'record_health_parameters',
  description:
    'Record every clinically relevant test/result found in the document. Never invent values, units, or dates that are not present in the source.',
  input_schema: {
    type: 'object',
    properties: {
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
  if (document.contentKind === 'image_scanned' && context.filePath && /^image\//.test(context.mimeType || '')) {
    const base64 = fs.readFileSync(context.filePath).toString('base64');
    return [
      { type: 'image', source: { type: 'base64', media_type: context.mimeType, data: base64 } },
      { type: 'text', text: DOCUMENT_INSTRUCTION },
    ];
  }
  // Scanned PDFs (image_scanned content from a .pdf) aren't rasterized by
  // this pipeline, so there's no image to hand the model — no page-render
  // step exists yet. Reported as a warning rather than attempted blindly.
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
    };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { candidates: [], warnings: ['Claude did not return a structured extraction result.'], rawModelOutput: response };
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

  return { candidates, warnings: [], rawModelOutput: toolUse.input };
}

module.exports = { name: 'claude', extract };
