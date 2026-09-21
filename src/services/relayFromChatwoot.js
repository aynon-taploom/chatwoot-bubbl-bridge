const axios = require('axios');
const { createLogger } = require('../logger');
const { validateOutgoingText, validateMediaForUpload } = require('../validation');

const logger = createLogger('from-chatwoot');

/**
 * Field paths here are a best-effort guess at Chatwoot's message_created webhook shape,
 * confirmed against real payloads on 2026-09-20.
 */
function extractOutgoingMessage(payload) {
  return {
    messageType: payload.message_type,
    isPrivate: payload.private === true,
    content: payload.content || null,
    attachments: payload.attachments || [],
    conversationId: payload.conversation?.id ?? payload.conversation_id ?? null,
    contactIdentifier:
      payload.conversation?.contact_inbox?.contact?.identifier ??
      payload.conversation?.meta?.sender?.identifier ??
      payload.sender?.identifier ??
      null,
  };
}

function mapChatwootFileType(fileType, contentType) {
  if (fileType === 'image' || fileType === 'video' || fileType === 'audio') return fileType;
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  if (contentType?.startsWith('audio/')) return 'audio';
  return 'document';
}

async function downloadUrl(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || 'application/octet-stream',
  };
}

/**
 * Builds the Chatwoot -> bubbl relay against one set of clients/store (dependency injection -
 * keeps this module free of module-level singletons, so it's easy to test with fakes).
 */
function createChatwootRelay({ bubbl, store }) {
  /**
   * Records which Chatwoot message a bubbl send corresponds to, so a later delivered/read
   * status webhook from bubbl (referencing its own message id) knows which Chatwoot message
   * to update. One Chatwoot message with several attachments produces several bubbl message
   * ids (each attachment is its own WhatsApp-level message) - all mapped to the same
   * Chatwoot message id, which is fine: whichever one reports a status updates that record.
   */
  function recordMessageMapping(bubblSendResult, conversationId, chatwootMessageId) {
    const bubblMessageId = bubblSendResult?.messages?.[0]?.id;
    if (!bubblMessageId || !conversationId || !chatwootMessageId) return;

    store.putMessageMapping(bubblMessageId, conversationId, chatwootMessageId);
  }

  async function sendTextReply(externalUserId, content, conversationId, chatwootMessageId) {
    const check = validateOutgoingText(content);
    if (!check.ok) {
      logger.error('not sending -', check.reason);
      return;
    }

    const result = await bubbl.sendText(externalUserId, content);
    recordMessageMapping(result, conversationId, chatwootMessageId);
  }

  async function sendAttachments(externalUserId, attachments, caption, conversationId, chatwootMessageId) {
    for (const [index, attachment] of attachments.entries()) {
      const dataUrl = attachment.data_url;
      if (!dataUrl) continue;

      const { buffer, contentType } = await downloadUrl(dataUrl);
      const type = mapChatwootFileType(attachment.file_type, contentType);
      const filename = dataUrl.split('/').pop()?.split('?')[0] || `attachment-${index}`;

      const check = validateMediaForUpload(type, buffer, contentType);
      if (!check.ok) {
        logger.error(`skipping attachment ${index} - ${check.reason}`);
        continue;
      }

      const mediaId = await bubbl.uploadMedia(buffer, filename, contentType);
      // Only the first attachment carries the message's own caption text - the rest, if any,
      // go out captionless.
      const result = await bubbl.sendMedia(externalUserId, type, mediaId, index === 0 ? caption : null);
      recordMessageMapping(result, conversationId, chatwootMessageId);
    }
  }

  async function handlePayload(payload) {
    if (payload.event && payload.event !== 'message_created') {
      logger.info('ignoring event:', payload.event);
      return;
    }

    const { messageType, isPrivate, content, attachments, conversationId, contactIdentifier } =
      extractOutgoingMessage(payload);

    if (messageType !== 'outgoing' || isPrivate) {
      logger.info('ignoring non-outgoing/private message', { messageType, isPrivate });
      return;
    }

    const externalUserId =
      contactIdentifier || (conversationId && store.byChatwootConversationId(conversationId));

    if (!externalUserId) {
      logger.error('could not resolve which bubbl consumer this reply is for - see raw payload above');
      return;
    }

    const chatwootMessageId = payload.id;

    if (attachments.length === 0) {
      if (content) await sendTextReply(externalUserId, content, conversationId, chatwootMessageId);
      return;
    }

    await sendAttachments(externalUserId, attachments, content, conversationId, chatwootMessageId);
  }

  return { handlePayload };
}

module.exports = { createChatwootRelay };
