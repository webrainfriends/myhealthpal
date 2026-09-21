const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');

const SYSTEM_PROMPT = [
  'You are a precise medication data-extraction engine reading a photo or scan of either a doctor\'s prescription or a',
  'medicine\'s own packaging/label/blister pack.',
  'Extract only what is explicitly printed or legible in the image.',
  'Never invent, infer, or guess a drug name, dose, frequency, date, or quantity that is not printed in the source.',
  'If a field is not present or not legible, omit it or use null rather than fabricating one.',
  'If something is unclear or you are not confident you read it correctly, still report your best reading but lower its confidence score.',
  'This is a data-capture task, not a prescribing or diagnostic one: never add clinical advice beyond what is printed.',
].join(' ');

function instructionFor(scanType) {
  if (scanType === 'tablet_photo') {
    return (
      'This is a photo of a medicine\'s packaging, strip/blister pack, bottle label, or the tablet/capsule itself. Extract ' +
      'every distinct medicine shown by calling record_medications once. Read the drug name, strength (dosage_amount + ' +
      'dosage_unit), form, manufacturer batch/expiry date if printed, and quantity if printed (e.g. "10 tablets"). Frequency, ' +
      'route, instructions, prescribed_for, and prescribing_doctor are usually not printed on packaging - omit them rather ' +
      'than guessing. If nothing legible is found, still call it with an empty medications array.'
    );
  }
  return (
    'This is a doctor\'s prescription. Extract every distinct medicine listed by calling record_medications once. Put ' +
    'everything about one medicine (dose, form, frequency, route, instructions, duration/quantity, what it was prescribed ' +
    'for) in its own entry in "medications", and the prescription-level details (prescribing doctor, prescription date, ' +
    'pharmacy/clinic name) in "document". If the document is unreadable or lists no medicines, still call it with an ' +
    'empty medications array.'
  );
}

const EXTRACTION_TOOL = {
  name: 'record_medications',
  description:
    'Record every medicine found in a prescription or medication packaging photo, plus any document-level details ' +
    '(prescribing doctor, prescription date, pharmacy). Never invent values, dates, or text not present in the source.',
  input_schema: {
    type: 'object',
    properties: {
      document: {
        type: 'object',
        description: 'Details about the prescription/packaging as a whole, as opposed to any single medicine.',
        properties: {
          prescribing_doctor: { type: ['string', 'null'], description: 'Prescribing doctor\'s name exactly as printed, or null.' },
          prescription_date: { type: ['string', 'null'], description: 'Prescription date in YYYY-MM-DD form, or null.' },
          pharmacy_or_clinic: { type: ['string', 'null'], description: 'Issuing pharmacy, clinic, or hospital name, or null.' },
        },
      },
      medications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Medicine name exactly as printed (brand or generic).' },
            generic_name: { type: ['string', 'null'], description: 'Generic/active-ingredient name if printed separately, else null.' },
            dosage_amount: { type: ['number', 'null'], description: 'Numeric strength per unit, e.g. 500 for "500mg", or null.' },
            dosage_unit: {
              type: ['string', 'null'],
              enum: ['mg', 'mcg', 'g', 'ml', 'iu', 'percent', 'other', null],
              description: 'Unit for dosage_amount, or null.',
            },
            form: {
              type: ['string', 'null'],
              enum: ['tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler', 'cream', 'other', null],
              description: 'Dosage form, or null.',
            },
            frequency_per_day: { type: ['number', 'null'], description: 'Number of doses per day, e.g. 2 for "twice daily", or null.' },
            times_of_day: {
              type: 'array',
              items: { type: 'string' },
              description: 'Times of day if stated (e.g. "morning", "night"). Omit if not stated.',
            },
            route: { type: ['string', 'null'], description: 'Route of administration if stated (e.g. "oral"), or null.' },
            instructions: { type: ['string', 'null'], description: 'Free-text instructions as printed (e.g. "after food"), or null.' },
            prescribed_for: { type: ['string', 'null'], description: 'Condition/reason it was prescribed for, if stated, or null.' },
            start_date: { type: ['string', 'null'], description: 'Start date in YYYY-MM-DD if stated, else null.' },
            duration_days: { type: ['number', 'null'], description: 'Prescribed course length in days if stated, else null.' },
            quantity_dispensed: { type: ['number', 'null'], description: 'Quantity dispensed (count of tablets/capsules/units), or null.' },
            quantity_unit: { type: ['string', 'null'], description: 'Unit for quantity_dispensed (e.g. "tablets"), or null.' },
            expiry_date: { type: ['string', 'null'], description: 'Manufacturer expiry date in YYYY-MM-DD if printed on packaging, else null.' },
            confidence: { type: 'number', description: '0-1 confidence that this was read correctly from the source.' },
          },
          required: ['name', 'confidence'],
        },
      },
    },
    required: ['medications'],
  },
};

function buildContent(document, scanType) {
  const instruction = instructionFor(scanType);
  if (document.contentKind === 'text_native' && document.text) {
    return [{ type: 'text', text: `${instruction}\n\n${document.text}` }];
  }
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    const imageBlocks = document.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return [...imageBlocks, { type: 'text', text: instruction }];
  }
  return null;
}

function readImageAsContent(filePath, mimeType, scanType) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  return [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
    { type: 'text', text: instructionFor(scanType) },
  ];
}

// Provider-agnostic contract: extract(document, context) -> { medications,
// documentInfo, warnings, rawModelOutput }, where context carries
// { filePath, mimeType, scanType }.
async function extract(document, context = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('Medication scanning requires ANTHROPIC_API_KEY to be set.');
  }

  let content = buildContent(document, context.scanType);
  if (!content && context.filePath && /^image\//.test(context.mimeType || '')) {
    content = readImageAsContent(context.filePath, context.mimeType, context.scanType);
  }
  if (!content) {
    return {
      medications: [],
      documentInfo: null,
      warnings: ['No readable text or image content was found in this scan.'],
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

  const warnings = [];
  if (response.stop_reason === 'max_tokens') {
    warnings.push('The model\'s response was truncated - some medicines may be missing.');
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { medications: [], documentInfo: null, warnings: [...warnings, 'No structured extraction result was returned.'], rawModelOutput: response };
  }

  const medications = Array.isArray(toolUse.input?.medications) ? toolUse.input.medications : [];
  const candidates = medications
    .filter((m) => m && m.name)
    .map((m) => ({
      name: String(m.name),
      generic_name: m.generic_name || null,
      dosage_amount: typeof m.dosage_amount === 'number' ? m.dosage_amount : null,
      dosage_unit: m.dosage_unit || null,
      form: m.form || null,
      frequency_per_day: typeof m.frequency_per_day === 'number' ? m.frequency_per_day : null,
      times_of_day: Array.isArray(m.times_of_day) ? m.times_of_day.filter((t) => typeof t === 'string' && t.trim()) : [],
      route: m.route || null,
      instructions: m.instructions || null,
      prescribed_for: m.prescribed_for || null,
      start_date: m.start_date || null,
      duration_days: typeof m.duration_days === 'number' ? m.duration_days : null,
      quantity_dispensed: typeof m.quantity_dispensed === 'number' ? m.quantity_dispensed : null,
      quantity_unit: m.quantity_unit || null,
      expiry_date: m.expiry_date || null,
      confidence: typeof m.confidence === 'number' ? m.confidence : 0.7,
      needs_review: typeof m.confidence !== 'number' || m.confidence < 0.75,
    }));

  const doc = toolUse.input?.document || {};
  const documentInfo = {
    prescribingDoctor: doc.prescribing_doctor || null,
    prescriptionDate: doc.prescription_date || null,
    pharmacyOrClinic: doc.pharmacy_or_clinic || null,
  };

  return { medications: candidates, documentInfo, warnings, rawModelOutput: toolUse.input };
}

module.exports = { name: 'claude', extract };
