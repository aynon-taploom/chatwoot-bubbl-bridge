const crypto = require('crypto');

/**
 * Verifies bubbl's X-Hub-Signature-256 header against the raw request body, per
 * api-docs/public-api-integration-guide.md#verifying-signatures.
 *
 * @param {string|null} secret - the subscription's signing secret. When null (no secret
 *   configured), this always returns true - the bridge should still run, falling back to
 *   URL-obscurity only, rather than refuse to start.
 * @param {string|undefined} header - the request's X-Hub-Signature-256 header value.
 * @param {Buffer|undefined} rawBody - the exact bytes received, before JSON parsing (re-
 *   serializing the parsed body can reorder keys and silently break the comparison).
 */
function verifyBubblSignature(secret, header, rawBody) {
  if (!secret) return true;

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || Buffer.alloc(0)).digest('hex');

  const headerBuffer = Buffer.from(header || '');
  const expectedBuffer = Buffer.from(expected);

  // timingSafeEqual throws on mismatched lengths rather than returning false, so check that
  // first - an attacker-controlled header must never make length alone leak info, but a
  // length mismatch is already a definitive "no match" without needing a constant-time compare.
  return (
    headerBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(headerBuffer, expectedBuffer)
  );
}

module.exports = { verifyBubblSignature };
