# chatwoot-bubbl-bridge

Relays messages between a [Chatwoot](https://www.chatwoot.com/) inbox (API channel) and a
[bubbl-business](https://business.bubbl.dev) Public API business profile, in both directions:

- **Chatwoot → bubbl**: an agent's reply in Chatwoot is sent out as a WhatsApp-style message via
  bubbl's Public API.
- **bubbl → Chatwoot**: an incoming message on the bubbl side is created as a new contact message
  in the Chatwoot conversation, and delivery/read status updates are patched back onto the
  original agent message when possible.

Both directions support text and media (image/video/audio/document/sticker).

## Why this exists

Chatwoot's API channel and bubbl-business's Public API don't speak the same wire format, and
neither product knows about the other. This bridge is a small, independent Express service that
sits between the two, translating webhook payloads and API calls. It intentionally does not touch
bubbl-business's own codebase — bubbl-business stays Chatwoot-agnostic, and any product using
bubbl's Public API could plug in the same way.

## How it works

```
Chatwoot inbox  ──Webhook URL──▶  /from-chatwoot/:token  ──▶  bubbl Public API
     ▲                                                              │
     │                                                              │
     └──Client API (contact/conversation/message)──  /from-bubbl/:token  ◀──Webhook subscription──┘
```

- **`/from-bubbl/:token`** — bubbl calls this on every subscribed event (new message, status
  update). Verifies the `X-Hub-Signature-256` HMAC if `BUBBL_WEBHOOK_SECRET` is set, then creates
  (or reuses) a Chatwoot contact + conversation and posts the message/status into it.
- **`/from-chatwoot/:token`** — Chatwoot calls this as a synchronous "did the send succeed"
  confirmation whenever an agent sends a message. The bridge acks immediately and does the actual
  relay (which can involve downloading an attachment and re-uploading it to bubbl) after
  responding, so a slow multi-hop media send never trips Chatwoot's own send-timeout.

`:token` is a random path segment (`BRIDGE_TOKEN`) shared by both webhook URLs — a lightweight
shared secret so a stray request to the wrong path doesn't reach either integration.

State (which bubbl contact maps to which Chatwoot conversation, and which bubbl message ID maps to
which Chatwoot message ID, for status updates) is kept in `data/*.json` — see [`src/store.js`](src/store.js).
Fine for a single-instance deployment; swap for a real datastore before running more than one
instance.

## Project layout

```
index.js                     entrypoint: load config, build the app, listen
src/
  app.js                     wires everything together (DI root)
  config.js                  env loading + validation
  logger.js                  namespaced console logger
  signature.js               X-Hub-Signature-256 verification
  store.js                   JSON-file-backed conversation/message mapping
  validation.js              webhook payload + media upload validation
  clients/
    bubblClient.js           bubbl Public API client
    chatwootClient.js        Chatwoot Client API + status-update client
  middleware/
    requireBridgeToken.js    checks the :token path segment
    handleJsonParseErrors.js turns a malformed JSON body into a clean 400
  routes/
    bubblWebhook.js           GET (handshake) + POST /from-bubbl/:token
    chatwootWebhook.js        POST /from-chatwoot/:token
  services/
    relayFromBubbl.js         bubbl → Chatwoot relay logic
    relayFromChatwoot.js       Chatwoot → bubbl relay logic
test/                        node:test unit tests for validation.js and signature.js
data/                        gitignored runtime state (created on first write)
```

## Setup

```bash
npm install
cp .env.example .env   # fill in the values below
npm run dev            # or: npm start
```

Expose the local port publicly (e.g. with ngrok) and configure:

- Chatwoot inbox → Settings → the API-channel inbox → **Webhook URL** →
  `https://<public-host>/from-chatwoot/<BRIDGE_TOKEN>`
- bubbl-business dashboard → business profile → Webhooks → create a subscription with callback
  `https://<public-host>/from-bubbl/<BRIDGE_TOKEN>`

### Environment variables

See [`.env.example`](.env.example) for the full list with explanations. In short:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (default `8787`) | port to listen on |
| `BRIDGE_TOKEN` | yes | shared-secret path segment for both webhook URLs |
| `CHATWOOT_BASE_URL` | no (default `https://app.chatwoot.com`) | Chatwoot instance base URL |
| `CHATWOOT_INBOX_IDENTIFIER` | yes | the API-channel inbox's identifier |
| `CHATWOOT_ACCOUNT_ID` / `CHATWOOT_API_ACCESS_TOKEN` | no | enables pushing delivered/read status onto agent messages |
| `BUBBL_API_BASE_URL` | no (default `https://api.business.bubbl.dev`) | bubbl API base URL |
| `BUBBL_BUSINESS_PROFILE_UUID` | yes | the bubbl business profile to send/receive on behalf of |
| `BUBBL_API_KEY` | yes | bubbl Public API credential |
| `BUBBL_WEBHOOK_SECRET` | no | enables `X-Hub-Signature-256` verification on inbound bubbl webhooks |

## Testing

```bash
npm test
```

Unit tests cover the two pieces with real logic to get wrong: signature verification
(`src/signature.js`) and payload/media validation (`src/validation.js`). The relay services and
HTTP clients are exercised via manual end-to-end testing against real Chatwoot/bubbl accounts
rather than mocked here, since their value is almost entirely in correctly shaping requests to
two external APIs.

## License

MIT — see [LICENSE](LICENSE).
