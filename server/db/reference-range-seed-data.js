// Standards-based reference ranges for the Medications tab's parameter
// scoring - general-population adult clinical reference intervals aligned
// with WHO, ICMR (Indian Council of Medical Research), or US FDA-cleared-
// assay lab norms, picked per parameter for whichever body most commonly
// publishes that particular interval. Deliberately never sourced from a
// user's own lab report: see reference_ranges in
// migrations/008_medications.sql for why this has to stay a separate table
// from health_measurements.reference_range_raw.
//
// These are general reference values for informational tracking only - not
// a diagnosis, and never a substitute for a clinician's judgement or the
// specific range a lab prints (which reflects that lab's own assay/
// population). Extend by adding entries here and re-running `npm run seed`
// (idempotent, keyed on parameterCode + source + conditionLabel).
module.exports = [
  {
    // A meal-agnostic/home-glucometer reading (see registry-seed-data.js's
    // note on why this is a separate parameter from glucose_fasting) - no
    // single "normal" band is as universally standardized as fasting
    // glucose's, so this uses the WHO/ADA upper bound below which a random
    // reading isn't itself diagnostic of diabetes.
    parameterCode: 'glucose',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 70,
        high: 139,
        citation:
          'WHO/ADA: a random (non-fasting) plasma glucose below 140 mg/dL is not suggestive of diabetes; 140-199 mg/dL is the pre-diabetes range and 200 mg/dL or above (with symptoms) is diagnostic of diabetes.',
      },
    ],
  },
  {
    parameterCode: 'glucose_fasting',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 70,
        high: 99,
        citation: 'WHO/ADA normal fasting plasma glucose range for a non-pregnant adult without diabetes.',
      },
    ],
  },
  {
    parameterCode: 'glucose_post_prandial',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 70,
        high: 140,
        citation: 'WHO/ADA normal 2-hour post-prandial plasma glucose range for an adult without diabetes.',
      },
    ],
  },
  {
    parameterCode: 'hba1c',
    unit: '%',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 4.0,
        high: 5.6,
        citation: 'WHO/ADA diabetes diagnostic criteria: HbA1c below 5.7% is considered normal (non-diabetic).',
      },
    ],
  },
  {
    parameterCode: 'insulin_fasting',
    unit: 'uIU/mL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 2.6,
        high: 24.9,
        citation: 'Standard US clinical laboratory (Mayo Clinic Laboratories) adult reference interval for fasting insulin.',
      },
    ],
  },
  {
    parameterCode: 'total_cholesterol',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 125,
        high: 200,
        citation: 'US NCEP ATP III "desirable" total cholesterol range for an adult.',
      },
    ],
  },
  {
    parameterCode: 'ldl_cholesterol',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0,
        high: 99,
        citation: 'US NCEP ATP III "optimal" LDL cholesterol range for an adult without known cardiovascular risk.',
      },
    ],
  },
  {
    parameterCode: 'hdl_cholesterol',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 40,
        high: 100,
        citation: 'US NCEP ATP III desirable HDL cholesterol range; below 40 mg/dL is a cardiovascular risk factor.',
      },
    ],
  },
  {
    parameterCode: 'triglycerides',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0,
        high: 149,
        citation: 'US NCEP ATP III "normal" triglycerides range for an adult.',
      },
    ],
  },
  {
    parameterCode: 'creatinine',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0.6,
        high: 1.3,
        citation: 'Standard US clinical laboratory adult reference interval for serum creatinine.',
      },
    ],
  },
  {
    parameterCode: 'egfr',
    unit: 'mL/min/1.73',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 90,
        high: 130,
        citation: 'KDIGO (WHO-aligned international guideline) normal/high eGFR stage (G1) for kidney function.',
      },
    ],
  },
  {
    parameterCode: 'tsh',
    unit: 'uIU/mL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0.4,
        high: 4.0,
        citation: 'Typical FDA-cleared TSH immunoassay adult reference range.',
      },
    ],
  },
  {
    parameterCode: 't4',
    unit: 'ug/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 5.0,
        high: 12.0,
        citation: 'Typical FDA-cleared total T4 immunoassay adult reference range.',
      },
    ],
  },
  {
    parameterCode: 'ft4',
    unit: 'ng/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0.8,
        high: 1.8,
        citation: 'Typical FDA-cleared free T4 immunoassay adult reference range.',
      },
    ],
  },
  {
    parameterCode: 'uric_acid',
    unit: 'mg/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 3.5,
        high: 7.2,
        citation: 'Standard US clinical laboratory adult reference interval for serum uric acid.',
      },
    ],
  },
  {
    parameterCode: 'vitamin_d',
    unit: 'ng/mL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 30,
        high: 100,
        citation: 'US NIH Office of Dietary Supplements sufficiency range for 25-hydroxy vitamin D.',
      },
    ],
  },
  {
    parameterCode: 'vitamin_b12',
    unit: 'pg/mL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 200,
        high: 900,
        citation: 'Standard US clinical laboratory adult reference interval for serum vitamin B12.',
      },
    ],
  },
  {
    parameterCode: 'iron',
    unit: 'ug/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 60,
        high: 170,
        citation: 'Standard US clinical laboratory adult reference interval for serum iron.',
      },
    ],
  },
  {
    parameterCode: 'tibc',
    unit: 'ug/dL',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 240,
        high: 450,
        citation: 'Standard US clinical laboratory adult reference interval for total iron binding capacity.',
      },
    ],
  },
  {
    parameterCode: 'transferrin_saturation',
    unit: '%',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 20,
        high: 50,
        citation: 'Standard US clinical laboratory adult reference interval for transferrin saturation.',
      },
    ],
  },
  {
    parameterCode: 'potassium',
    unit: 'mmol/L',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 3.5,
        high: 5.0,
        citation: 'WHO-aligned adult electrolyte reference range for serum potassium.',
      },
    ],
  },
  {
    parameterCode: 'sodium',
    unit: 'mmol/L',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 135,
        high: 145,
        citation: 'WHO-aligned adult electrolyte reference range for serum sodium.',
      },
    ],
  },
  {
    parameterCode: 'alt',
    unit: 'U/L',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 7,
        high: 56,
        citation: 'Standard US clinical laboratory adult reference interval for ALT (SGPT).',
      },
    ],
  },
  {
    parameterCode: 'ast',
    unit: 'U/L',
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 8,
        high: 48,
        citation: 'Standard US clinical laboratory adult reference interval for AST (SGOT).',
      },
    ],
  },
  {
    parameterCode: 'hemoglobin',
    unit: 'g/dL',
    ranges: [
      {
        source: 'icmr',
        conditionLabel: 'general',
        low: 12,
        high: 17,
        citation:
          'ICMR (Indian Council of Medical Research) anemia diagnostic threshold - hemoglobin below this range indicates anemia under Indian national guidelines.',
      },
    ],
  },
  {
    parameterCode: 'urine_ph',
    unit: 'pH',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 4.6,
        high: 8.0,
        citation: 'Standard adult reference interval for urine pH on a routine urinalysis.',
      },
    ],
  },
  {
    parameterCode: 'urine_specific_gravity',
    unit: 'SG',
    ranges: [
      {
        source: 'who',
        conditionLabel: 'general',
        low: 1.005,
        high: 1.03,
        citation: 'Standard adult reference interval for urine specific gravity on a routine urinalysis.',
      },
    ],
  },
  {
    parameterCode: 'insulin_resistance_homa_ir',
    unit: '', // a dimensionless index - the report itself prints no unit for it
    ranges: [
      {
        source: 'fda',
        conditionLabel: 'general',
        low: 0.7,
        high: 2.0,
        citation:
          'Commonly used adult reference range for the HOMA-IR (Homeostatic Model Assessment of Insulin Resistance) index; values above this range suggest insulin resistance.',
      },
    ],
  },
];
