const express = require('express');

const ChatwootClient = require('./clients/chatwootClient');
const BubblClient = require('./clients/bubblClient');
const store = require('./store');
const { createBubblRelay } = require('./services/relayFromBubbl');
const { createChatwootRelay } = require('./services/relayFromChatwoot');
const { createBubblWebhookRouter } = require('./routes/bubblWebhook');
const { createChatwootWebhookRouter } = require('./routes/chatwootWebhook');
const { handleJsonParseErrors } = require('./middleware/handleJsonParseErrors');

/**
 * Wires the whole app together from a validated config object (see config.js). Returns the
 * Express app, unstarted - see index.js for the actual app.listen().
 *
 * @param {ReturnType<import('./config').loadConfig>} config
 */
function createApp(config) {
  const chatwoot = new ChatwootClient(config.chatwoot);
  const bubbl = new BubblClient(config.bubbl);

  if (!config.chatwoot.apiAccessToken) {
    console.warn(
      '[startup] CHATWOOT_API_ACCESS_TOKEN not set - delivered/read status updates will be logged and skipped'
    );
  }
  if (!config.bubbl.webhookSecret) {
    console.warn(
      '[startup] BUBBL_WEBHOOK_SECRET not set - incoming bubbl webhooks will NOT be signature-verified'
    );
  }

  const bubblRelay = createBubblRelay({ bubbl, chatwoot, store });
  const chatwootRelay = createChatwootRelay({ bubbl, store });

  const app = express();

  // verify captures the exact raw bytes before JSON parsing - required for signature
  // verification, since re-serializing the parsed body can reorder keys and silently break
  // the HMAC comparison (bubbl's own docs call this out explicitly).
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(handleJsonParseErrors);

  app.get('/', (_req, res) => res.json({ ok: true, service: 'chatwoot-bubbl-bridge' }));

  app.use(
    '/from-bubbl',
    createBubblWebhookRouter({
      bridgeToken: config.bridgeToken,
      webhookSecret: config.bubbl.webhookSecret,
      relay: bubblRelay,
    })
  );

  app.use(
    '/from-chatwoot',
    createChatwootWebhookRouter({
      bridgeToken: config.bridgeToken,
      relay: chatwootRelay,
    })
  );

  return app;
}

module.exports = { createApp };
