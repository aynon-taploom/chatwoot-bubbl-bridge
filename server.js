require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');

const ChatwootClient = require('./chatwootClient');
const BubblClient = require('./bubblClient');
const store = require('./store');

const {
  PORT = 8787,
  BRIDGE_TOKEN,
  CHATWOOT_BASE_URL,
  CHATWOOT_INBOX_IDENTIFIER,
  CHATWOOT_ACCOUNT_ID,
  CHATWOOT_API_ACCESS_TOKEN,
  BUBBL_API_BASE_URL,
  BUBBL_BUSINESS_PROFILE_UUID,
  BUBBL_API_KEY,
  BUBBL_WEBHOOK_SECRET,
} = process.env;

for (const [name, value] of Object.entries({
  BRIDGE_TOKEN, CHATWOOT_INBOX_IDENTIFIER, BUBBL_BUSINESS_PROFILE_UUID, BUBBL_API_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name} (copy .env.example to .env and fill it in)`);
    process.exit(1);
  }
}

const chatwoot = new ChatwootClient({
  baseUrl: CHATWOOT_BASE_URL,
  inboxIdentifier: CHATWOOT_INBOX_IDENTIFIER,
  accountId: CHATWOOT_ACCOUNT_ID,
  apiAccessToken: CHATWOOT_API_ACCESS_TOKEN,
});

if (!CHATWOOT_API_ACCESS_TOKEN) {
  console.warn(
    '[startup] CHATWOOT_API_ACCESS_TOKEN not set - delivered/read status updates will be logged and skipped'
  );
}

if (!BUBBL_WEBHOOK_SECRET) {
  console.warn(
    '[startup] BUBBL_WEBHOOK_SECRET not set - incoming bubbl webhooks will NOT be signature-verified'
  );
}

const bubbl = new BubblClient({
  baseUrl: BUBBL_API_BASE_URL,
  businessProfileUuid: BUBBL_BUSINESS_PROFILE_UUID,
  apiKey: BUBBL_API_KEY,
});

const app = express();
// verify captures the exact raw bytes before JSON parsing - required for signature
// verification, since re-serializing the parsed body can reorder keys and silently break the
// HMAC comparison (bubbl's own docs call this out explicitly).
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.get('/', (_req, res) => res.json({ ok: true, service: 'chatwoot-bubbl-bridge' }));

function checkToken(req, res) {
  if (req.params.token !== BRIDGE_TOKEN) {
    res.sendStatus(403);
    return false;
  }
  return true;
}

/**
 * Verifies bubbl's X-Hub-Signature-256 header against the raw request body, per
 * api-docs/public-api-integration-guide.md#verifying-signatures. Returns true (and logs a
 * warning) when BUBBL_WEBHOOK_SECRET isn't configured, so the bridge degrades to
 * URL-obscurity-only rather than refusing to run - but every such request is logged loudly,
 * unlike a silent skip.
 */
function verifyBubblSignature(req) {
  if (!BUBBL_WEBHOOK_SECRET) {
    console.warn('[from-bubbl] no BUBBL_WEBHOOK_SECRET configured - accepting unverified');
    return true;
  }

  const header = req.header('X-Hub-Signature-256') || '';
  const expected = 'sha256=' + crypto
    .createHmac('sha256', BUBBL_WEBHOOK_SECRET)
    .update(req.rawBody || Buffer.alloc(0))
    .digest('hex');

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual throws on mismatched lengths rather than returning false, so check that
  // first - an attacker-controlled header must never make length alone leak info, but a
  // length mismatch is already a definitive "no match" without needing a constant-time compare.
  return headerBuf.length === expectedBuf.length && crypto.timingSafeEqual(headerBuf, expectedBuf);
}

// --- bubbl -> Chatwoot -----------------------------------------------------------------

// bubbl's webhook subscription handshake (Meta-style hub.challenge) - see
// VerifyWebhookSubscriptionHandshakeAction in bubbl-business.
app.get('/from-bubbl/:token', (req, res) => {
  if (!checkToken(req, res)) return;
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.challenge']) {
    console.log('[from-bubbl] handshake ok');
    return res.send(String(req.query['hub.challenge']));
  }
  res.sendStatus(400);
});

app.post('/from-bubbl/:token', async (req, res) => {
  if (!checkToken(req, res)) return;

  if (!verifyBubblSignature(req)) {
    console.error('[from-bubbl] signature verification failed, rejecting');
    return res.sendStatus(401);
  }

  console.log('[from-bubbl] payload:', JSON.stringify(req.body));
  res.sendStatus(200);

  try {
    await handleBubblPayload(req.body);
  } catch (err) {
    console.error('[from-bubbl] failed:', err.response?.data || err.message);
  }
});

// bubbl wraps deliveries in a Meta-style envelope: {object, entry:[{id, changes:[{value, field}]}]}
// - value is the {messaging_product, contacts, messages} shape MessagePayloadBuilder builds.
async function handleBubblPayload(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      await handleBubblChange(change.value || {});
    }
  }
}

async function handleBubblChange(value) {
  if (value.statuses) {
    for (const status of value.statuses) {
      await relayBubblStatusToChatwoot(status);
    }
    return;
  }

  const externalUserId = value?.contacts?.[0]?.wa_id;
  if (!externalUserId) {
    console.log('[from-bubbl] unrecognized payload shape, skipping');
    return;
  }

  for (const msg of value.messages || []) {
    await relayBubblMessageToChatwoot(externalUserId, msg);
  }
}

// bubbl's own statuses mirror WhatsApp's: sent, delivered, read, failed - same set Chatwoot's
// status-update endpoint accepts, so no translation needed beyond looking up which Chatwoot
// message this bubbl message id corresponds to.
async function relayBubblStatusToChatwoot(status) {
  const mapping = store.messageMappingByBubblId(status.id);
  if (!mapping) {
    console.log('[from-bubbl] status update for an untracked bubbl message id, skipping:', status.id);
    return;
  }

  try {
    await chatwoot.updateMessageStatus(
      mapping.chatwootConversationId,
      mapping.chatwootMessageId,
      status.status,
      status.errors?.[0]?.message
    );
    console.log(
      `[from-bubbl] updated Chatwoot message ${mapping.chatwootMessageId} -> ${status.status}`
    );
  } catch (err) {
    console.error('[from-bubbl] failed to push status to Chatwoot:', err.response?.data || err.message);
  }
}

async function relayBubblMessageToChatwoot(externalUserId, msg) {
  const mapping = await ensureChatwootConversation(externalUserId);

  if (msg.type === 'text') {
    await chatwoot.createMessage(
      mapping.chatwootContactIdentifier,
      mapping.chatwootConversationId,
      msg.text?.body || '',
      null
    );
    return;
  }

  const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];
  if (mediaTypes.includes(msg.type)) {
    const media = msg[msg.type];
    if (!media?.id) {
      console.log('[from-bubbl] media message with no media id, skipping');
      return;
    }

    const { buffer, contentType } = await bubbl.fetchMediaContent(media.id);
    const mimeType = media.mime_type || contentType;
    const filename = media.filename || `${media.id}.${extensionForMime(mimeType)}`;

    await chatwoot.createMessage(
      mapping.chatwootContactIdentifier,
      mapping.chatwootConversationId,
      media.caption || null,
      { buffer, filename, mimeType }
    );
    return;
  }

  console.log('[from-bubbl] unsupported message type, skipping:', msg.type);
}

async function ensureChatwootConversation(externalUserId) {
  const existing = store.byExternalUserId(externalUserId);
  if (existing) return existing;

  const contactIdentifier = await chatwoot.createContact(externalUserId, externalUserId);
  const conversationId = await chatwoot.createConversation(contactIdentifier);
  store.put(externalUserId, contactIdentifier, conversationId);

  return { chatwootContactIdentifier: contactIdentifier, chatwootConversationId: conversationId };
}

// --- Chatwoot -> bubbl -----------------------------------------------------------------

// Chatwoot's API-channel treats this webhook call as a SYNCHRONOUS send confirmation - it
// waits on this response to decide sent vs. failed, on a tight timeout. A media reply needs
// 3 sequential hops (download from Chatwoot -> upload to bubbl -> send via bubbl) which can
// blow past that timeout even though the send itself succeeds a moment later, so Chatwoot
// shows a false "Failed to send". Ack immediately and do the real work after responding -
// like from-bubbl already does - so Chatwoot never waits on the slow part.
app.post('/from-chatwoot/:token', (req, res) => {
  if (!checkToken(req, res)) return;

  console.log('[from-chatwoot] raw payload:', JSON.stringify(req.body));
  res.sendStatus(200);

  handleChatwootPayload(req.body).catch((err) => {
    console.error('[from-chatwoot] failed (after ack):', err.response?.data || err.message);
  });
});

/**
 * Field paths here are a best-effort guess at Chatwoot's message_created webhook shape,
 * confirmed against real payloads on 2026-09-20.
 */
function extractOutgoingMessage(payload) {
  const messageType = payload.message_type;
  const isPrivate = payload.private === true;
  const content = payload.content || null;
  const attachments = payload.attachments || [];
  const conversationId = payload.conversation?.id ?? payload.conversation_id ?? null;
  const contactIdentifier =
    payload.conversation?.contact_inbox?.contact?.identifier ??
    payload.conversation?.meta?.sender?.identifier ??
    payload.sender?.identifier ??
    null;

  return { messageType, isPrivate, content, attachments, conversationId, contactIdentifier };
}

async function handleChatwootPayload(payload) {
  if (payload.event && payload.event !== 'message_created') {
    console.log('[from-chatwoot] ignoring event:', payload.event);
    return;
  }

  const { messageType, isPrivate, content, attachments, conversationId, contactIdentifier } =
    extractOutgoingMessage(payload);

  if (messageType !== 'outgoing' || isPrivate) {
    console.log('[from-chatwoot] ignoring non-outgoing/private message', { messageType, isPrivate });
    return;
  }

  let externalUserId = contactIdentifier;
  if (!externalUserId && conversationId) {
    externalUserId = store.byChatwootConversationId(conversationId);
  }

  if (!externalUserId) {
    console.error(
      '[from-chatwoot] could not resolve which bubbl consumer this reply is for - see raw payload above'
    );
    return;
  }

  const chatwootMessageId = payload.id;

  if (!attachments.length) {
    if (content) {
      const result = await bubbl.sendText(externalUserId, content);
      recordMessageMapping(result, conversationId, chatwootMessageId);
    }
    return;
  }

  for (const [index, attachment] of attachments.entries()) {
    const dataUrl = attachment.data_url;
    if (!dataUrl) continue;

    const { buffer, contentType } = await downloadUrl(dataUrl);
    const type = mapChatwootFileType(attachment.file_type, contentType);
    const filename = dataUrl.split('/').pop()?.split('?')[0] || `attachment-${index}`;

    const mediaId = await bubbl.uploadMedia(buffer, filename, contentType);
    const result = await bubbl.sendMedia(externalUserId, type, mediaId, index === 0 ? content : null);
    recordMessageMapping(result, conversationId, chatwootMessageId);
  }
}

/**
 * Records which Chatwoot message a bubbl send corresponds to, so a later delivered/read
 * status webhook from bubbl (referencing its own message id) knows which Chatwoot message
 * to update. One Chatwoot message with several attachments produces several bubbl message
 * ids (each attachment is its own WhatsApp-level message) - all mapped to the same Chatwoot
 * message id, which is fine: whichever one reports a status updates that one Chatwoot record.
 */
function recordMessageMapping(bubblSendResult, conversationId, chatwootMessageId) {
  const bubblMessageId = bubblSendResult?.messages?.[0]?.id;
  if (!bubblMessageId || !conversationId || !chatwootMessageId) return;

  store.putMessageMapping(bubblMessageId, conversationId, chatwootMessageId);
}

async function downloadUrl(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || 'application/octet-stream',
  };
}

function mapChatwootFileType(fileType, contentType) {
  if (fileType === 'image' || fileType === 'video' || fileType === 'audio') return fileType;
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  if (contentType?.startsWith('audio/')) return 'audio';
  return 'document';
}

function extensionForMime(mimeType) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
    'application/pdf': 'pdf',
  };
  return map[mimeType] || 'bin';
}

app.listen(PORT, () => console.log(`chatwoot-bubbl-bridge listening on :${PORT}`));
