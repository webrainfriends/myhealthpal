const { getAiClient } = require('../../ai/privacyGateway');
const config = require('../../config');
const { recordAiUsage, FEATURES } = require('../../services/aiUsageService');
const { ORGAN_KEYS, COVERAGE_STATUSES, PREMIUM_FREQUENCIES, normalizeOrganKey } = require('../../insurance/insuranceRules');

// Reads a health-insurance policy document (schedule, wording, brochure or
// a photo of the policy card) into structured data: the insurer and policy
// particulars, contacts (insurer, agent, claims, support, TPA), premium and
// cover period, and organ-wise clauses - what each organ/illness covers,
// what it excludes, and the ceiling / co-pay for each. The insurance analog
// of dietScheduleExtractionProvider.js, with the same text / table / image
// branching (kept as its own copy for the same reason that file gives).

// Policy wordings run to dozens of pages; past this the tail is left out and
// the person is told, rather than sending an unbounded prompt.
const MAX_TEXT_CHARS = 350000;

const SYSTEM_PROMPT = [
  'You are a precise data-extraction engine for health-insurance policy documents.',
  'Extract only what is explicitly written in the document.',
  'Never invent, infer or assume a coverage, exclusion, limit, co-pay, date, phone number or name that is not present in the source.',
  'Amounts must be copied as numbers exactly as printed (no currency symbols or thousands separators); if a limit is stated as a percentage of the sum insured, put the percentage in the clause text and leave ceiling_amount null unless the rupee/dollar figure is also printed.',
  'Quote clause_text verbatim (or as a very close excerpt, at most 400 characters) so the person can see the actual wording; never paraphrase it into something the document does not say.',
  'If you are not confident you read a value correctly, still report it but lower its confidence score.',
  'This is data capture, not advice: never judge whether the policy is good or adequate.',
].join(' ');

const INSTRUCTION =
  'Extract this health-insurance policy document by calling record_insurance_policy once. ' +
  'Capture the insurer and plan, policy number, policyholder and insured members, sum insured, cover start and end dates, ' +
  'premium amount, frequency and next due date, and every contact present (insurer customer care, claims, the agent or advisor, ' +
  'any support / helpline / TPA). Then list coverage_items: one entry per illness, procedure, benefit or exclusion clause, ' +
  'assigned to the closest organ_key. For each, give the coverage_status (covered; partial when covered only with restrictions such as a ' +
  'sub-limit, co-pay or condition; excluded), the ceiling_amount and ceiling_basis if a limit is stated, the co-pay percent or amount, ' +
  'any waiting period in months, the clause reference (section / clause number) and the verbatim clause_text. ' +
  'Put policy-wide clauses (general exclusions, pre-existing disease rules, cosmetic or dental exclusions that name no organ) under organ_key "general". ' +
  'If a limit or co-pay applies to the whole policy rather than one illness, add it to the relevant organ items or to a "general" item. ' +
  'If the document is unreadable or is not an insurance policy, still call the tool with empty coverage_items and null fields.';

const nullableString = (description) => ({ type: ['string', 'null'], description });
const nullableNumber = (description) => ({ type: ['number', 'null'], description });

const EXTRACTION_TOOL = {
  name: 'record_insurance_policy',
  description: 'Record the particulars, contacts, premium schedule and organ-wise coverage clauses of a health-insurance policy document.',
  input_schema: {
    type: 'object',
    properties: {
      provider_name: nullableString('The insurance company, e.g. "Star Health and Allied Insurance".'),
      plan_name: nullableString('The product / plan name.'),
      policy_number: nullableString('The policy number exactly as printed.'),
      policy_type: nullableString('e.g. Individual, Family floater, Senior citizen, Critical illness, Top-up.'),
      policyholder_name: nullableString('The proposer / policyholder.'),
      insured_members: nullableString('The insured persons, comma-separated.'),
      sum_insured: nullableNumber('The base sum insured as a plain number.'),
      currency: nullableString('ISO code or symbol, e.g. INR, USD.'),
      policy_start_date: nullableString('Cover start date, YYYY-MM-DD.'),
      policy_end_date: nullableString('Cover end / renewal date, YYYY-MM-DD.'),
      initial_waiting_days: nullableNumber('The initial waiting period in days (commonly 30), if stated.'),
      preexisting_waiting_months: nullableNumber('The pre-existing disease waiting period in months, if stated.'),
      premium_amount: nullableNumber('The premium per instalment, including taxes if that is what is printed.'),
      premium_frequency: { type: ['string', 'null'], enum: [...PREMIUM_FREQUENCIES, null], description: 'How often the premium is paid.' },
      next_premium_due_date: nullableString('The next premium due date, YYYY-MM-DD.'),
      grace_period_days: nullableNumber('Grace period for late premium, in days.'),
      contacts: {
        type: 'object',
        description: 'Contact details, each null if not present in the document.',
        properties: {
          provider_phone: nullableString('Insurer customer-care / toll-free number.'),
          provider_email: nullableString('Insurer customer-care email.'),
          provider_website: nullableString('Insurer website.'),
          claims_phone: nullableString('Claims / cashless helpline.'),
          claims_email: nullableString('Claims email.'),
          agent_name: nullableString('Agent / advisor / broker name.'),
          agent_phone: nullableString('Agent phone.'),
          agent_email: nullableString('Agent email.'),
          support_phone: nullableString('Any other support / helpline / emergency assistance number.'),
          support_email: nullableString('Support email.'),
          tpa_name: nullableString('Third-party administrator, if any.'),
          tpa_phone: nullableString('TPA phone.'),
          other: {
            type: 'array',
            description: 'Any further named contacts (grievance officer, ombudsman, ...).',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                name: nullableString('Name, if any.'),
                phone: nullableString('Phone, if any.'),
                email: nullableString('Email, if any.'),
              },
              required: ['role'],
            },
          },
        },
      },
      summary: nullableString('One or two neutral sentences describing what the document is (plan, insurer, period). No advice.'),
      coverage_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            organ_key: { type: 'string', enum: ORGAN_KEYS, description: 'The organ / body system this clause concerns, or "general" for policy-wide clauses.' },
            condition_name: { type: 'string', description: 'The illness, procedure, benefit or exclusion, e.g. "Cardiac bypass surgery", "Cataract", "Congenital heart disease".' },
            coverage_status: { type: 'string', enum: COVERAGE_STATUSES },
            ceiling_amount: nullableNumber('The maximum payable for this item as a plain number, if a figure is printed.'),
            ceiling_basis: { type: ['string', 'null'], description: 'What the ceiling is measured over: per_illness, per_year, per_claim, lifetime, sum_insured, or a short phrase such as "room rent per day".' },
            copay_percent: nullableNumber('Co-payment as a percentage the insured pays, if stated.'),
            copay_amount: nullableNumber('Fixed co-payment amount, if stated.'),
            deductible_amount: nullableNumber('Deductible, if stated.'),
            waiting_period_months: nullableNumber('Waiting period before this item is payable, in months.'),
            sub_limit_note: nullableString('Any limit or condition on this item not captured above, in a few words.'),
            clause_reference: nullableString('Section / clause / page reference, e.g. "Section 4.2".'),
            clause_text: nullableString('The clause wording, verbatim, at most 400 characters.'),
            confidence: { type: 'number', description: '0-1 confidence that this item was read correctly.' },
          },
          required: ['organ_key', 'condition_name', 'coverage_status', 'confidence'],
        },
      },
    },
    required: ['coverage_items'],
  },
};

function serializeTables(tables) {
  return tables.map((rows) => rows.map((row) => row.join(', ')).join('\n')).join('\n\n---\n\n');
}

function buildContent(document, context, instruction) {
  const warnings = [];
  const limit = (text) => {
    if (text.length <= MAX_TEXT_CHARS) return text;
    warnings.push('This document is very long - clauses near the end may be missing. Review the extracted items against your policy wording.');
    return text.slice(0, MAX_TEXT_CHARS);
  };
  if (document.contentKind === 'text_native' && document.text) {
    return { content: [{ type: 'text', text: `${instruction}\n\n${limit(document.text)}` }], warnings };
  }
  if (document.contentKind === 'structured_table' && document.tables) {
    return { content: [{ type: 'text', text: `${instruction}\n\n${limit(serializeTables(document.tables))}` }], warnings };
  }
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    const imageBlocks = document.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return { content: [...imageBlocks, { type: 'text', text: instruction }], warnings };
  }
  if (document.contentKind === 'image_scanned' && context.fileBuffer && /^image\//.test(context.mimeType || '')) {
    return {
      content: [
        { type: 'image', source: { type: 'base64', media_type: context.mimeType, data: context.fileBuffer.toString('base64') } },
        { type: 'text', text: instruction },
      ],
      warnings,
    };
  }
  return null;
}

function trimmed(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Only a real calendar date is kept; anything else the model wrote (a
// range, "annually", ...) would just fail the DATE column.
function isoDate(value) {
  const s = trimmed(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function nonNegativeInt(value) {
  const n = num(value);
  return n === null || n < 0 ? null : Math.round(n);
}

function positive(value) {
  const n = num(value);
  return n === null || n < 0 ? null : n;
}

// Turns the tool's raw input into the exact shapes the database takes
// (validated enums, real dates, plain numbers). Exported for tests.
function normalizeExtraction(input) {
  const contacts = input?.contacts || {};
  const frequency = PREMIUM_FREQUENCIES.includes(input?.premium_frequency) ? input.premium_frequency : null;

  const policy = {
    providerName: trimmed(input?.provider_name),
    planName: trimmed(input?.plan_name),
    policyNumber: trimmed(input?.policy_number),
    policyType: trimmed(input?.policy_type),
    policyholderName: trimmed(input?.policyholder_name),
    insuredMembers: trimmed(input?.insured_members),
    sumInsured: positive(input?.sum_insured),
    currency: trimmed(input?.currency),
    policyStartDate: isoDate(input?.policy_start_date),
    policyEndDate: isoDate(input?.policy_end_date),
    initialWaitingDays: nonNegativeInt(input?.initial_waiting_days),
    preexistingWaitingMonths: nonNegativeInt(input?.preexisting_waiting_months),
    premiumAmount: positive(input?.premium_amount),
    premiumFrequency: frequency,
    nextPremiumDueDate: isoDate(input?.next_premium_due_date),
    gracePeriodDays: nonNegativeInt(input?.grace_period_days),
    providerPhone: trimmed(contacts.provider_phone),
    providerEmail: trimmed(contacts.provider_email),
    providerWebsite: trimmed(contacts.provider_website),
    claimsPhone: trimmed(contacts.claims_phone),
    claimsEmail: trimmed(contacts.claims_email),
    agentName: trimmed(contacts.agent_name),
    agentPhone: trimmed(contacts.agent_phone),
    agentEmail: trimmed(contacts.agent_email),
    supportPhone: trimmed(contacts.support_phone),
    supportEmail: trimmed(contacts.support_email),
    tpaName: trimmed(contacts.tpa_name),
    tpaPhone: trimmed(contacts.tpa_phone),
    otherContacts: (Array.isArray(contacts.other) ? contacts.other : [])
      .filter((c) => c && trimmed(c.role))
      .map((c) => ({ role: trimmed(c.role), name: trimmed(c.name), phone: trimmed(c.phone), email: trimmed(c.email) })),
    summary: trimmed(input?.summary),
  };

  const items = (Array.isArray(input?.coverage_items) ? input.coverage_items : [])
    .filter((item) => item && trimmed(item.condition_name) && COVERAGE_STATUSES.includes(item.coverage_status))
    .map((item) => {
      const confidence = typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.7;
      return {
        organKey: normalizeOrganKey(item.organ_key),
        conditionName: trimmed(item.condition_name),
        coverageStatus: item.coverage_status,
        ceilingAmount: positive(item.ceiling_amount),
        ceilingBasis: trimmed(item.ceiling_basis),
        copayPercent: positive(item.copay_percent),
        copayAmount: positive(item.copay_amount),
        deductibleAmount: positive(item.deductible_amount),
        waitingPeriodMonths: nonNegativeInt(item.waiting_period_months),
        subLimitNote: trimmed(item.sub_limit_note),
        clauseReference: trimmed(item.clause_reference),
        clauseText: trimmed(item.clause_text) ? trimmed(item.clause_text).slice(0, 1200) : null,
        confidence,
        needsReview: confidence < 0.75,
      };
    });

  return { policy, items };
}

// Provider contract: extract(document, context) -> { policy, items, warnings,
// rawModelOutput }. context carries userId, fileBuffer and mimeType.
async function extract(document, context = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('Insurance document reading requires ANTHROPIC_API_KEY to be set.');
  }

  const built = buildContent(document, context, INSTRUCTION);
  if (!built) {
    return {
      policy: normalizeExtraction({}).policy,
      items: [],
      warnings: ['No supported content to read in this document (e.g. a scanned PDF page that rendered no images).'],
      rawModelOutput: null,
    };
  }

  const client = await getAiClient({ subjectUserId: context.userId, purpose: 'insurance_extraction' });
  const response = await client.messages.streamFinal({
    model: config.anthropicModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content: built.content }],
  });
  recordAiUsage(FEATURES.INSURANCE_EXTRACTION, response);

  const warnings = [...built.warnings];
  if (response.stop_reason === 'max_tokens') {
    warnings.push('The AI output was truncated (hit the token limit) - some clauses near the end of this document may be missing.');
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { ...normalizeExtraction({}), items: [], warnings: [...warnings, 'The AI did not return a structured result.'], rawModelOutput: response };
  }

  const { policy, items } = normalizeExtraction(toolUse.input);
  return { policy, items, warnings, rawModelOutput: toolUse.input };
}

module.exports = { name: 'insurance', extract, normalizeExtraction, buildContent, EXTRACTION_TOOL };
