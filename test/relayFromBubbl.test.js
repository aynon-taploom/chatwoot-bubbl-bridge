const test = require('node:test');
const assert = require('node:assert/strict');

const { createBubblRelay } = require('../src/services/relayFromBubbl');

// A minimal fake of store.js's module shape, backed by a plain object instead of a JSON file -
// exercises the exact same contract (byExternalUserId/put/updateDisplayName) the real module
// exposes, per relayFromBubbl.js's own "easy to test with fakes" design.
function createFakeStore() {
  const conversations = {};
  return {
    byExternalUserId: (externalUserId) => conversations[externalUserId] || null,
    put: (externalUserId, chatwootContactIdentifier, chatwootConversationId, displayName) => {
      conversations[externalUserId] = { chatwootContactIdentifier, chatwootConversationId, displayName };
    },
    updateDisplayName: (externalUserId, displayName) => {
      conversations[externalUserId] = { ...conversations[externalUserId], displayName };
    },
  };
}

function createFakeChatwoot() {
  const calls = { createContact: [], updateContact: [], createMessage: [] };
  let nextContactId = 1;
  let nextConversationId = 1;
  return {
    calls,
    createContact: async (externalUserId, name) => {
      calls.createContact.push({ externalUserId, name });
      return `contact-${nextContactId++}`;
    },
    createConversation: async (contactIdentifier) => {
      return nextConversationId++;
    },
    updateContact: async (contactIdentifier, name) => {
      calls.updateContact.push({ contactIdentifier, name });
    },
    createMessage: async (contactIdentifier, conversationId, content) => {
      calls.createMessage.push({ contactIdentifier, conversationId, content });
      return { id: 1 };
    },
  };
}

function receivedMessagePayload({ waId, name, text }) {
  return {
    object: 'bubbl_business_account',
    entry: [
      {
        id: 'business-profile-uuid',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'bubbl',
              contacts: [{ profile: { name }, wa_id: waId }],
              messages: [{ from: waId, id: 'msg-1', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

test('a new contact is created with the webhook\'s profile.name, not the raw wa_id', async () => {
  const chatwoot = createFakeChatwoot();
  const relay = createBubblRelay({ bubbl: {}, chatwoot, store: createFakeStore() });

  await relay.handlePayload(receivedMessagePayload({ waId: 'aynon', name: 'Rakib Hasan', text: 'hi' }));

  assert.deepEqual(chatwoot.calls.createContact, [{ externalUserId: 'aynon', name: 'Rakib Hasan' }]);
  assert.equal(chatwoot.calls.updateContact.length, 0);
});

test('an unchanged display name on a later message does not re-patch the contact', async () => {
  const chatwoot = createFakeChatwoot();
  const relay = createBubblRelay({ bubbl: {}, chatwoot, store: createFakeStore() });

  await relay.handlePayload(receivedMessagePayload({ waId: 'aynon', name: 'Rakib Hasan', text: 'first' }));
  await relay.handlePayload(receivedMessagePayload({ waId: 'aynon', name: 'Rakib Hasan', text: 'second' }));

  assert.equal(chatwoot.calls.createContact.length, 1);
  assert.equal(chatwoot.calls.updateContact.length, 0);
  assert.equal(chatwoot.calls.createMessage.length, 2);
});

test('a display name that changed since the contact was created updates it in Chatwoot', async () => {
  const chatwoot = createFakeChatwoot();
  const relay = createBubblRelay({ bubbl: {}, chatwoot, store: createFakeStore() });

  await relay.handlePayload(receivedMessagePayload({ waId: 'aynon', name: 'Rakib', text: 'first' }));
  await relay.handlePayload(receivedMessagePayload({ waId: 'aynon', name: 'Rakib Hasan', text: 'second' }));

  assert.equal(chatwoot.calls.createContact.length, 1);
  assert.deepEqual(chatwoot.calls.updateContact, [{ contactIdentifier: 'contact-1', name: 'Rakib Hasan' }]);
});

test('a payload predating profile.name still relays using the raw wa_id, via the client\'s own fallback', async () => {
  const chatwoot = createFakeChatwoot();
  const relay = createBubblRelay({ bubbl: {}, chatwoot, store: createFakeStore() });

  const payload = receivedMessagePayload({ waId: 'aynon', text: 'hi' });
  delete payload.entry[0].changes[0].value.contacts[0].profile;

  await relay.handlePayload(payload);

  assert.deepEqual(chatwoot.calls.createContact, [{ externalUserId: 'aynon', name: undefined }]);
});
