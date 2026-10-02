const test = require('node:test');
const assert = require('node:assert/strict');
const { unitKey } = require('../src/extraction/registry');

test('unitKey treats lab spellings of one unit as equal', () => {
  const same = (a, b) => assert.equal(unitKey(a), unitKey(b), `${a} vs ${b}`);
  same('10^3/uL', '10^3/µL');
  same('10^3/uL', 'x10^3/μL');
  same('10^3/uL', '10³/uL');
  same('10^3/uL', '10*3/uL');
  same('10^3/uL', 'thou/mm3'.replace('thou', '10^3'));
  same('10^3/uL', '10^3/cumm');
  same('mL/min/1.73', 'mL/min/1.73 m2');
  same('mL/min/1.73', 'mL/min/1.73 m²');
  same('g/dL', 'gm/dL');
});

test('unitKey keeps genuinely different units apart', () => {
  assert.notEqual(unitKey('U/L'), unitKey('%'));
  assert.notEqual(unitKey('10^3/uL'), unitKey('10^9/L'));
});
