// Tiny JSON-file-backed persistence for the bridge's two lookup tables. Good enough at this
// scale; swap for a real database if this ever needs to survive concurrent writers.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- external_user_id -> Chatwoot contact/conversation ----------------------------------
// Lets a second inbound message from the same bubbl consumer reuse their existing Chatwoot
// conversation instead of creating a new one every time.

function byExternalUserId(externalUserId) {
  const conversations = readJsonFile(CONVERSATIONS_FILE);
  return conversations[externalUserId] || null;
}

function byChatwootConversationId(conversationId) {
  const conversations = readJsonFile(CONVERSATIONS_FILE);
  const entry = Object.entries(conversations).find(
    ([, value]) => String(value.chatwootConversationId) === String(conversationId)
  );
  return entry?.[0] || null;
}

function put(externalUserId, chatwootContactIdentifier, chatwootConversationId) {
  const conversations = readJsonFile(CONVERSATIONS_FILE);
  conversations[externalUserId] = { chatwootContactIdentifier, chatwootConversationId };
  writeJsonFile(CONVERSATIONS_FILE, conversations);
}

// --- bubbl message id -> Chatwoot message ------------------------------------------------
// Recorded whenever the bridge sends a message via bubbl's API, so a later delivered/read
// status webhook (which references bubbl's own message id) knows which Chatwoot message to
// update.

function putMessageMapping(bubblMessageId, chatwootConversationId, chatwootMessageId) {
  const messages = readJsonFile(MESSAGES_FILE);
  messages[bubblMessageId] = { chatwootConversationId, chatwootMessageId };
  writeJsonFile(MESSAGES_FILE, messages);
}

function messageMappingByBubblId(bubblMessageId) {
  const messages = readJsonFile(MESSAGES_FILE);
  return messages[bubblMessageId] || null;
}

module.exports = {
  byExternalUserId,
  byChatwootConversationId,
  put,
  putMessageMapping,
  messageMappingByBubblId,
};
