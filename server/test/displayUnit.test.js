const test = require('node:test');
const assert = require('node:assert/strict');
const { displayUnit } = require('../src/lib/displayUnit');
const { isAbnormalFlag } = require('../src/insights/insightRules');

test('a unitless parameter never shows a unit; others keep the printed one', () => {
  assert.equal(displayUnit({ health_parameter_id: 'p', canonical_unit: null, raw_unit: '%' }), null);
  assert.equal(displayUnit({ health_parameter_id: 'p', canonical_unit: 'U/L', raw_unit: 'IU/L' }), 'IU/L');
  assert.equal(displayUnit({ health_parameter_id: null, canonical_unit: null, raw_unit: 'U/L' }), 'U/L');
  assert.equal(displayUnit({ health_parameter_id: 'p', canonical_unit: 'U/L', raw_unit: null }), null);
});

test('a unit-corrected result is shown in the parameter\'s own unit', () => {
  const row = { health_parameter_id: 'p', canonical_unit: 'U/L', raw_unit: '%', normalized_unit: 'U/L', normalization_confidence: '0.600' };
  assert.equal(displayUnit(row), 'U/L');
  assert.equal(displayUnit({ ...row, normalization_confidence: 1 }), '%');
});

test('"Abnormal" is an abnormal flag, "Within normal limits" is not', () => {
  assert.equal(isAbnormalFlag('Abnormal'), true);
  assert.equal(isAbnormalFlag('ABNORMAL'), true);
  assert.equal(isAbnormalFlag('High'), true);
  assert.equal(isAbnormalFlag('Within normal limits'), false);
  assert.equal(isAbnormalFlag('Normal'), false);
  assert.equal(isAbnormalFlag('Negative'), false);
});
