const axios = require('axios');
const FormData = require('form-data');

// Wraps Chatwoot's public "Client API" for an API-type inbox:
// https://developers.chatwoot.com/api-reference/{contacts-api,conversations-api,messages-api}
class ChatwootClient {
  constructor({ baseUrl, inboxIdentifier, accountId, apiAccessToken }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.inboxIdentifier = inboxIdentifier;
    this.accountId = accountId;
    this.apiAccessToken = apiAccessToken;
  }

  async createContact(externalUserId, name) {
    const { data } = await axios.post(
      `${this.baseUrl}/public/api/v1/inboxes/${this.inboxIdentifier}/contacts`,
      { identifier: externalUserId, name: name || externalUserId }
    );
    return data.source_id;
  }

  /**
   * Updates a contact's name - called when a later inbound message carries a display name
   * that differs from what Chatwoot has on file (bubbl's own display_name is mutable). Same
   * public Client API surface as createContact, just PATCH on the single-contact URL instead
   * of POST on the collection.
   */
  async updateContact(contactIdentifier, name) {
    await axios.patch(
      `${this.baseUrl}/public/api/v1/inboxes/${this.inboxIdentifier}/contacts/${contactIdentifier}`,
      { name }
    );
  }

  async createConversation(contactIdentifier) {
    const { data } = await axios.post(
      `${this.baseUrl}/public/api/v1/inboxes/${this.inboxIdentifier}/contacts/${contactIdentifier}/conversations`,
      {}
    );
    return data.id;
  }

  /**
   * @param {string} contactIdentifier
   * @param {number} conversationId
   * @param {string|null} content
   * @param {{buffer: Buffer, filename: string, mimeType: string}|null} attachment
   */
  async createMessage(contactIdentifier, conversationId, content, attachment) {
    const url = `${this.baseUrl}/public/api/v1/inboxes/${this.inboxIdentifier}/contacts/${contactIdentifier}/conversations/${conversationId}/messages`;

    if (!attachment) {
      const { data } = await axios.post(url, { content: content || '' });
      return data;
    }

    const form = new FormData();
    if (content) form.append('content', content);
    form.append('attachments[]', attachment.buffer, {
      filename: attachment.filename,
      contentType: attachment.mimeType,
    });

    const { data } = await axios.post(url, form, { headers: form.getHeaders() });
    return data;
  }

  /**
   * Pushes a delivered/read/failed receipt onto an agent's own outgoing message - the
   * Application API's own endpoint for exactly this (API-channel inboxes only), per
   * https://developers.chatwoot.com/api-reference/messages/update-message-status.
   * Needs a personal Access Token (Profile Settings), NOT the inbox identifier used above -
   * that's the Client API's own scheme and can't call this endpoint.
   *
   * @param {'sent'|'delivered'|'read'|'failed'} status
   */
  async updateMessageStatus(conversationId, messageId, status, externalError) {
    if (!this.apiAccessToken) {
      throw new Error('CHATWOOT_API_ACCESS_TOKEN not configured - skipping status update');
    }

    const body = { status };
    if (externalError) body.external_error = externalError;

    await axios.patch(
      `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages/${messageId}`,
      body,
      { headers: { api_access_token: this.apiAccessToken } }
    );
  }
}

module.exports = ChatwootClient;
