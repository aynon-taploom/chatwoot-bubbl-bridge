const { createLogger } = require('../logger');

const logger = createLogger('from-bubbl');

const MEDIA_MESSAGE_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

const EXTENSION_BY_MIME_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
};

function extensionForMimeType(mimeType) {
  return EXTENSION_BY_MIME_TYPE[mimeType] || 'bin';
}

/**
 * Builds the bubbl -> Chatwoot relay against one set of clients/store (dependency injection -
 * keeps this module free of module-level singletons, so it's easy to test with fakes).
 */
function createBubblRelay({ bubbl, chatwoot, store }) {
  async function ensureChatwootConversation(externalUserId, displayName) {
    const existing = store.byExternalUserId(externalUserId);
    if (existing) {
      if (displayName && displayName !== existing.displayName) {
        await chatwoot.updateContact(existing.chatwootContactIdentifier, displayName);
        store.updateDisplayName(externalUserId, displayName);
      }
      return existing;
    }

    const contactIdentifier = await chatwoot.createContact(externalUserId, displayName);
    const conversationId = await chatwoot.createConversation(contactIdentifier);
    store.put(externalUserId, contactIdentifier, conversationId, displayName);

    return { chatwootContactIdentifier: contactIdentifier, chatwootConversationId: conversationId };
  }

  async function relayMessage(externalUserId, displayName, message) {
    const conversation = await ensureChatwootConversation(externalUserId, displayName);

    if (message.type === 'text') {
      await chatwoot.createMessage(
        conversation.chatwootContactIdentifier,
        conversation.chatwootConversationId,
        message.text?.body || '',
        null
      );
      return;
    }

    if (MEDIA_MESSAGE_TYPES.includes(message.type)) {
      await relayMediaMessage(conversation, message);
      return;
    }

    logger.info('unsupported message type, skipping:', message.type);
  }

  async function relayMediaMessage(conversation, message) {
    const media = message[message.type];
    if (!media?.id) {
      logger.info('media message with no media id, skipping');
      return;
    }

    const { buffer, contentType } = await bubbl.fetchMediaContent(media.id);
    const mimeType = media.mime_type || contentType;
    const filename = media.filename || `${media.id}.${extensionForMimeType(mimeType)}`;

    await chatwoot.createMessage(
      conversation.chatwootContactIdentifier,
      conversation.chatwootConversationId,
      media.caption || null,
      { buffer, filename, mimeType }
    );
  }

  // bubbl's own statuses mirror WhatsApp's: sent, delivered, read, failed - the same set
  // Chatwoot's status-update endpoint accepts, so no translation needed beyond looking up
  // which Chatwoot message this bubbl message id corresponds to.
  async function relayStatus(status) {
    const mapping = store.messageMappingByBubblId(status.id);
    if (!mapping) {
      logger.info('status update for an untracked bubbl message id, skipping:', status.id);
      return;
    }

    try {
      await chatwoot.updateMessageStatus(
        mapping.chatwootConversationId,
        mapping.chatwootMessageId,
        status.status,
        status.errors?.[0]?.message
      );
      logger.info(`updated Chatwoot message ${mapping.chatwootMessageId} -> ${status.status}`);
    } catch (err) {
      logger.error('failed to push status to Chatwoot:', err.response?.data || err.message);
    }
  }

  async function handleChange(value) {
    if (value.statuses) {
      for (const status of value.statuses) {
        await relayStatus(status);
      }
      return;
    }

    const externalUserId = value?.contacts?.[0]?.wa_id;
    if (!externalUserId) {
      logger.info('unrecognized payload shape, skipping');
      return;
    }

    // bubbl always sends profile.name (falling back to the raw external_user_id itself when
    // the consumer hasn't set one) - see MessagePayloadBuilder::contactObject() on the bubbl
    // side. Still guarded here in case an older subscription/payload predates that field.
    const displayName = value?.contacts?.[0]?.profile?.name;

    for (const message of value.messages || []) {
      await relayMessage(externalUserId, displayName, message);
    }
  }

  // bubbl wraps every delivery in a Meta-style envelope: {object, entry: [{id, changes:
  // [{field, value}]}]} - value is the {messaging_product, contacts, messages|statuses} shape
  // MessagePayloadBuilder builds.
  async function handlePayload(payload) {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        await handleChange(change.value || {});
      }
    }
  }

  return { handlePayload };
}

module.exports = { createBubblRelay };
