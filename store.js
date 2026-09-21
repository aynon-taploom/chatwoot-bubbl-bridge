// Tiny JSON-file-backed map between a bubbl consumer (external_user_id) and the
// Chatwoot contact/conversation created for them. Good enough for this bridge's scale;
// swap for a real DB if this ever needs to survive being rewritten.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'conversations.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function byExternalUserId(externalUserId) {
  const data = load();
  return data[externalUserId] || null;
}

function byChatwootConversationId(conversationId) {
  const data = load();
  return Object.entries(data).find(
    ([, v]) => String(v.chatwootConversationId) === String(conversationId)
  )?.[0] || null;
}

function put(externalUserId, chatwootContactIdentifier, chatwootConversationId) {
  const data = load();
  data[externalUserId] = { chatwootContactIdentifier, chatwootConversationId };
  save(data);
}

// Separate file: maps a bubbl message id (what bubbl's delivered/read status webhooks
// reference) to the Chatwoot message it corresponds to, so a later status event knows which
// Chatwoot message to update. Recorded at send time (see recordMessageMapping in server.js).
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) return {};
  return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
}

function saveMessages(data) {
  fs.mkdirSync(path.dirname(MESSAGES_FILE), { recursive: true });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(data, null, 2));
}

function putMessageMapping(bubblMessageId, chatwootConversationId, chatwootMessageId) {
  const data = loadMessages();
  data[bubblMessageId] = { chatwootConversationId, chatwootMessageId };
  saveMessages(data);
}

function messageMappingByBubblId(bubblMessageId) {
  const data = loadMessages();
  return data[bubblMessageId] || null;
}

module.exports = {
  byExternalUserId,
  byChatwootConversationId,
  put,
  putMessageMapping,
  messageMappingByBubblId,
};
