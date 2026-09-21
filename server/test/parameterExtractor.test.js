const test = require('node:test');
const assert = require('node:assert/strict');
const { extractParameters } = require('../src/services/parameterExtractor');

test('pairs a name printed several lines above its value (real lab report layout)', () => {
  const text = [
    'Patient : JANE DOE SID No. : 12345',
    'Age / Sex : 40 Y / Female Reg Date & Time : 01/01/2024 00:00:00',
    'Page : 1 of 1',
    '',
    'Haemoglobin (HB)',
    '',
    '( Method : WB/Automated)',
    '( Specimen: EDTA WHOLE BLOOD)',
    '',
    '13.7 gm/dL 13-17',
    'GLUCOSE FASTING (FBS)',
    '',
    '( Method : GOD-POD)',
    '',
    '97.9 mg/d L 74-100',
  ].join('\n');

  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  const byName = Object.fromEntries(parameters.map((p) => [p.test_name, p]));

  assert.equal(parameters.length, 2, `expected exactly 2 candidates, got: ${JSON.stringify(parameters)}`);
  assert.equal(byName['Haemoglobin (HB)'].value, '13.7');
  assert.equal(byName['Haemoglobin (HB)'].unit, 'gm/dL');
  assert.equal(byName['Haemoglobin (HB)'].reference_range, '13-17');
  // "mg/d L" is a real pdfjs text-run artifact for "mg/dL" - must not eat
  // the "L" as a High/Low flag and lose the range that follows it.
  assert.equal(byName['GLUCOSE FASTING (FBS)'].unit, 'mg/dL');
  assert.equal(byName['GLUCOSE FASTING (FBS)'].reference_range, '74-100');
});

test('never emits a candidate for patient/report metadata lines', () => {
  const text = [
    'Patient : JANE DOE SID No. : 12345',
    'Age / Sex : 40 Y / Female Reg Date & Time : 01/01/2024 00:00:00',
    'Referrer : Self Coll Date & Time : 01/01/2024 00:10:00',
    'Branch : SOME-BRANCH Report Date & Time : 01/01/2024 01:00:00',
    'Page : 1 of 3',
    '( Method : Something)',
    '( Specimen: SERUM)',
    'End of the Report',
    'Dr.J.Smith MD.,',
  ].join('\n');

  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  assert.deepEqual(parameters, []);
});

test('does not treat a name ending in a bare number as a name+value pair', () => {
  // "VITAMIN B 12" must not be read as name="VITAMIN B", value="12" just
  // because a number happens to be the last token - the real value is on
  // its own line further down.
  const text = ['VITAMIN B 12', '', '( Method : CLIA)', '', '157.00 pg/ml 211 - 911'].join('\n');
  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  assert.equal(parameters.length, 1);
  assert.equal(parameters[0].test_name, 'VITAMIN B 12');
  assert.equal(parameters[0].value, '157.00');
  assert.equal(parameters[0].reference_range, '211 - 911');
});

test('extracts a "wide" table (one column per metric) from a health-tracker export', () => {
  const tables = [
    [
      ['Medical Record ID', 'Name', 'Date of Birth', 'Date & Time (Local Time)', 'Glucose', 'Glucose Units', 'Meal'],
      ['abc', 'Jane Doe', 'February 01, 1978', '2026-09-21', 119, 'mg/dL', 'Fasting'],
      ['abc', 'Jane Doe', 'February 01, 1978', '2026-09-19', 131, 'mg/dL', 'Bedtime'],
    ],
  ];
  const { parameters, warnings } = extractParameters({ contentKind: 'structured_table', tables });
  assert.equal(warnings.length, 0);
  assert.equal(parameters.length, 2);
  assert.equal(parameters[0].test_name, 'Glucose');
  assert.equal(parameters[0].value, '119');
  assert.equal(parameters[0].unit, 'mg/dL');
  // Must use the reading's own timestamp column, not "Date of Birth" even
  // though that column also contains "date" and appears earlier in the row.
  assert.equal(parameters[0].param_date, '2026-09-21');
  assert.equal(parameters[1].param_date, '2026-09-19');
});

test('a parenthesized method line with no "Method:"/"Specimen:" keyword does not eat the real test name', () => {
  // A second real-world vendor's format: "(Serum,Enzymatic)" instead of
  // "( Method : ...)" - this previously replaced the preceding real test
  // name with the method description itself before the value arrived.
  const text = ['Glucose Fasting', '', '(Plasma-F,Hexokinase)', '', '97 mg/dL Normal: 70-99'].join('\n');
  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  assert.equal(parameters.length, 1);
  assert.equal(parameters[0].test_name, 'Glucose Fasting');
  assert.equal(parameters[0].value, '97');
});

test('a name that wraps across lines ending in a dangling hyphen is reassembled, not overwritten', () => {
  const text = [
    'TSH (Thyroid Stimulating Hormone) -',
    'Ultrasensitive, Serum',
    '',
    '(Serum,Electrochemiluminescence immunoassay',
    '(ECLIA))',
    '',
    '2.19 μIU/mL 0.54-5.3',
  ].join('\n');
  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  assert.equal(parameters.length, 1);
  assert.equal(parameters[0].test_name, 'TSH (Thyroid Stimulating Hormone) - Ultrasensitive, Serum');
  assert.equal(parameters[0].value, '2.19');
});

test('a bare number embedded in a compound name is not mistaken for the value', () => {
  // "25" here names the 25-hydroxy metabolite, not a separate result.
  const text = ['Vitamin D Total - 25 Hydroxy (OH)', '', '(Serum,ECLIA)', '', '20.56 ng/mL Deficiency: < 10'].join('\n');
  const { parameters } = extractParameters({ contentKind: 'text_native', text });
  assert.equal(parameters.length, 1);
  assert.equal(parameters[0].test_name, 'Vitamin D Total - 25 Hydroxy (OH)');
  assert.equal(parameters[0].value, '20.56');
});

test('a long-format table (one row per test) still works as before', () => {
  const tables = [
    [
      ['Test', 'Result', 'Unit', 'Reference Range'],
      ['Hemoglobin', '13.7', 'g/dL', '13-17'],
      ['Glucose Fasting', '97.9', 'mg/dL', '74-100'],
    ],
  ];
  const { parameters } = extractParameters({ contentKind: 'structured_table', tables });
  assert.equal(parameters.length, 2);
  assert.equal(parameters[0].test_name, 'Hemoglobin');
  assert.equal(parameters[0].needs_review, false);
});
