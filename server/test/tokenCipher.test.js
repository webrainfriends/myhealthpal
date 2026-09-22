const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecret, decryptSecret } = require('../src/lib/tokenCipher');

test('decryptSecret recovers exactly what encryptSecret was given', () => {
  const secret = '1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ-refresh-token';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted), secret);
});

test('encrypting the same secret twice produces different ciphertext (random IV)', () => {
  const secret = 'same-refresh-token';
  assert.notEqual(encryptSecret(secret), encryptSecret(secret));
});

test('decryptSecret throws on a tampered payload rather than returning garbage', () => {
  const encrypted = encryptSecret('a-refresh-token');
  const buffer = Buffer.from(encrypted, 'base64');
  buffer[buffer.length - 1] ^= 0xff; // flip a byte inside the ciphertext
  assert.throws(() => decryptSecret(buffer.toString('base64')));
});
