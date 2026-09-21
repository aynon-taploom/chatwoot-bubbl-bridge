// Structural checks on the two webhook payloads, and pre-flight checks against bubbl's own
// documented media limits (api-docs/public-api-integration-guide.md#upload-media) - catching
// bad input locally with a clear reason instead of a wasted round trip that fails at bubbl's
// end (or, for a malformed webhook body, an uncaught property-access exception).

const TEXT_MAX_CHARS = 4096; // SendPublicMessageRequest: 'text.body' => ['max:4096']

const MEDIA_LIMITS = {
  image: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
  },
  video: {
    mimeTypes: ['video/mp4', 'video/3gpp'],
    maxBytes: 100 * 1024 * 1024,
  },
  audio: {
    mimeTypes: ['audio/aac', 'audio/amr', 'audio/mp4', 'audio/mpeg', 'audio/ogg'],
    maxBytes: 100 * 1024 * 1024,
  },
  document: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
    maxBytes: 100 * 1024 * 1024,
  },
  sticker: {
    mimeTypes: ['image/webp'],
    maxBytes: 500 * 1024, // animated
    staticMaxBytes: 100 * 1024,
  },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * bubbl's own envelope: {object: "bubbl_business_account", entry: [{id, changes: [{field,
 * value}]}]}. Anything failing this isn't a payload handleBubblPayload's loop can safely walk.
 */
function validateBubblWebhookPayload(body) {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body is missing or not a JSON object' };
  }
  if (body.object !== 'bubbl_business_account') {
    return { ok: false, reason: `unexpected "object" value: ${JSON.stringify(body.object)}` };
  }
  if (!Array.isArray(body.entry)) {
    return { ok: false, reason: '"entry" is not an array' };
  }
  return { ok: true };
}

/** Chatwoot's payload shape varies a lot by event type - just enough to walk it safely. */
function validateChatwootWebhookPayload(body) {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'body is missing or not a JSON object' };
  }
  return { ok: true };
}

/** @param {string|null} content */
function validateOutgoingText(content) {
  if (content == null) return { ok: true };
  if (typeof content !== 'string') {
    return { ok: false, reason: 'content is not a string' };
  }
  if (content.length > TEXT_MAX_CHARS) {
    return {
      ok: false,
      reason: `content is ${content.length} chars, over bubbl's ${TEXT_MAX_CHARS}-char limit for a text message`,
    };
  }
  return { ok: true };
}

/**
 * A cheap heuristic for animated vs. static WebP: an animated file's RIFF container always
 * has an ANIM chunk (alongside VP8X); a static one (plain VP8/VP8L, or VP8X without ANIM)
 * never does. Good enough to pick the right size ceiling without a real WebP parser.
 */
function isAnimatedWebp(buffer) {
  return buffer.includes('ANIM');
}

/**
 * @param {'image'|'video'|'audio'|'document'|'sticker'} type
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
function validateMediaForUpload(type, buffer, mimeType) {
  const limit = MEDIA_LIMITS[type];
  if (!limit) {
    return { ok: false, reason: `no known bubbl limit for media type "${type}"` };
  }

  if (mimeType && !limit.mimeTypes.includes(mimeType)) {
    return {
      ok: false,
      reason: `${mimeType} isn't one of bubbl's allowed mime types for ${type} (${limit.mimeTypes.join(', ')})`,
    };
  }

  const maxBytes = type === 'sticker' && !isAnimatedWebp(buffer) ? limit.staticMaxBytes : limit.maxBytes;

  if (buffer.length > maxBytes) {
    return {
      ok: false,
      reason: `${buffer.length} bytes exceeds bubbl's ${maxBytes}-byte limit for ${type}`,
    };
  }

  return { ok: true };
}

module.exports = {
  validateBubblWebhookPayload,
  validateChatwootWebhookPayload,
  validateOutgoingText,
  validateMediaForUpload,
};
