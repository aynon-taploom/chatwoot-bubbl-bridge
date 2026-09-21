const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateBubblWebhookPayload,
  validateChatwootWebhookPayload,
  validateOutgoingText,
  validateMediaForUpload,
} = require('../src/validation');

test('validateBubblWebhookPayload accepts bubbl\'s documented envelope', () => {
  const result = validateBubblWebhookPayload({
    object: 'bubbl_business_account',
    entry: [{ id: 'x', changes: [] }],
  });
  assert.deepEqual(result, { ok: true });
});

test('validateBubblWebhookPayload rejects a non-object body', () => {
  assert.equal(validateBubblWebhookPayload(null).ok, false);
  assert.equal(validateBubblWebhookPayload('nope').ok, false);
  assert.equal(validateBubblWebhookPayload([1, 2]).ok, false);
});

test('validateBubblWebhookPayload rejects the wrong "object" value', () => {
  const result = validateBubblWebhookPayload({ object: 'something_else', entry: [] });
  assert.equal(result.ok, false);
});

test('validateBubblWebhookPayload rejects a missing/non-array "entry"', () => {
  const result = validateBubblWebhookPayload({ object: 'bubbl_business_account' });
  assert.equal(result.ok, false);
});

test('validateChatwootWebhookPayload accepts any JSON object', () => {
  assert.deepEqual(validateChatwootWebhookPayload({ event: 'message_created' }), { ok: true });
});

test('validateChatwootWebhookPayload rejects a non-object body', () => {
  assert.equal(validateChatwootWebhookPayload(null).ok, false);
  assert.equal(validateChatwootWebhookPayload('nope').ok, false);
});

test('validateOutgoingText allows null/undefined (no text to send)', () => {
  assert.deepEqual(validateOutgoingText(null), { ok: true });
  assert.deepEqual(validateOutgoingText(undefined), { ok: true });
});

test('validateOutgoingText rejects a non-string body', () => {
  assert.equal(validateOutgoingText(42).ok, false);
});

test('validateOutgoingText enforces bubbl\'s 4096-char limit', () => {
  assert.equal(validateOutgoingText('a'.repeat(4096)).ok, true);
  assert.equal(validateOutgoingText('a'.repeat(4097)).ok, false);
});

test('validateMediaForUpload rejects an unknown media type', () => {
  const result = validateMediaForUpload('carrier-pigeon', Buffer.from('x'), 'image/jpeg');
  assert.equal(result.ok, false);
});

test('validateMediaForUpload rejects a disallowed mime type for the given type', () => {
  const result = validateMediaForUpload('image', Buffer.from('x'), 'image/gif');
  assert.equal(result.ok, false);
});

test('validateMediaForUpload accepts an in-limit image', () => {
  const result = validateMediaForUpload('image', Buffer.alloc(1024), 'image/jpeg');
  assert.deepEqual(result, { ok: true });
});

test('validateMediaForUpload rejects an image over the 5MB limit', () => {
  const result = validateMediaForUpload('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg');
  assert.equal(result.ok, false);
});

test('validateMediaForUpload applies the smaller static-webp ceiling to a non-animated sticker', () => {
  const staticWebp = Buffer.alloc(150 * 1024); // over the 100KB static ceiling, under the 500KB animated one
  const result = validateMediaForUpload('sticker', staticWebp, 'image/webp');
  assert.equal(result.ok, false);
});

test('validateMediaForUpload applies the larger animated-webp ceiling when an ANIM chunk is present', () => {
  const animatedWebp = Buffer.concat([Buffer.from('ANIM'), Buffer.alloc(150 * 1024)]);
  const result = validateMediaForUpload('sticker', animatedWebp, 'image/webp');
  assert.deepEqual(result, { ok: true });
});
