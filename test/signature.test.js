const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { verifyBubblSignature } = require('../src/signature');

function signatureFor(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('verifyBubblSignature accepts a correctly-signed body', () => {
  const secret = 'shh';
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const header = signatureFor(secret, body);

  assert.equal(verifyBubblSignature(secret, header, body), true);
});

test('verifyBubblSignature rejects a body signed with the wrong secret', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const header = signatureFor('wrong-secret', body);

  assert.equal(verifyBubblSignature('shh', header, body), false);
});

test('verifyBubblSignature rejects a tampered body', () => {
  const secret = 'shh';
  const originalBody = Buffer.from(JSON.stringify({ hello: 'world' }));
  const header = signatureFor(secret, originalBody);
  const tamperedBody = Buffer.from(JSON.stringify({ hello: 'mallory' }));

  assert.equal(verifyBubblSignature(secret, header, tamperedBody), false);
});

test('verifyBubblSignature rejects a missing header', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  assert.equal(verifyBubblSignature('shh', undefined, body), false);
});

test('verifyBubblSignature skips verification when no secret is configured', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  assert.equal(verifyBubblSignature(null, undefined, body), true);
  assert.equal(verifyBubblSignature(null, 'sha256=garbage', body), true);
});
