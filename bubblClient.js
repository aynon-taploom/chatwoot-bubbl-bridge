const axios = require('axios');
const FormData = require('form-data');

// Wraps bubbl-business's Public API exactly as any external integrator would use it -
// nothing here is special-cased for Chatwoot. Two-step media flow only: upload first to
// get an id, then reference that id. Sending {type}.link is rejected by bubbl outright
// (SendPublicMessageRequest::mediaRules()) - never attempt it.
class BubblClient {
  constructor({ baseUrl, businessProfileUuid, apiKey }) {
    // Routes live under Route::publicApi() -> prefix `api/v1` (config('api.public_prefix')
    // + config('api.public_version')) - easy to forget since business-api.php's own route
    // definitions never show it.
    this.baseUrl = baseUrl.replace(/\/+$/, '') + '/api/v1';
    this.businessProfileUuid = businessProfileUuid;
    this.apiKey = apiKey;
  }

  get headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async sendText(to, body) {
    return this._send({ messaging_product: 'whatsapp', to, type: 'text', text: { body } });
  }

  /** @param {'image'|'video'|'audio'|'document'|'sticker'} type */
  async sendMedia(to, type, mediaId, caption) {
    const payload = { id: mediaId };
    if (caption && type !== 'audio' && type !== 'sticker') payload.caption = caption;

    return this._send({ messaging_product: 'whatsapp', to, type, [type]: payload });
  }

  async _send(body) {
    const { data } = await axios.post(
      `${this.baseUrl}/${this.businessProfileUuid}/messages`,
      body,
      { headers: this.headers }
    );
    return data;
  }

  /** Uploads raw bytes, returns bubbl's media id. */
  async uploadMedia(buffer, filename, mimeType) {
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });

    const { data } = await axios.post(
      `${this.baseUrl}/${this.businessProfileUuid}/media`,
      form,
      { headers: { ...this.headers, ...form.getHeaders() } }
    );
    return data.id;
  }

  /** Downloads an inbound media's bytes by bubbl media id, for relaying into Chatwoot. */
  async fetchMediaContent(mediaId) {
    const response = await axios.get(`${this.baseUrl}/media/${mediaId}/content`, {
      headers: this.headers,
      responseType: 'arraybuffer',
    });
    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers['content-type'] || 'application/octet-stream',
    };
  }
}

module.exports = BubblClient;
