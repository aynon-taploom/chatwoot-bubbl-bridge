const express = require('express');
const { requireBridgeToken } = require('../middleware/requireBridgeToken');
const { verifyBubblSignature } = require('../signature');
const { validateBubblWebhookPayload } = require('../validation');
const { createLogger } = require('../logger');

const logger = createLogger('from-bubbl');

/**
 * @param {{ bridgeToken: string, webhookSecret: string|null, relay: { handlePayload: Function } }} deps
 */
function createBubblWebhookRouter({ bridgeToken, webhookSecret, relay }) {
  const router = express.Router();
  router.use('/:token', requireBridgeToken(bridgeToken));

  // bubbl's webhook subscription handshake (Meta-style hub.challenge) - see
  // VerifyWebhookSubscriptionHandshakeAction in bubbl-business.
  router.get('/:token', (req, res) => {
    const mode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && challenge) {
      logger.info('handshake ok');
      return res.send(String(challenge));
    }

    res.sendStatus(400);
  });

  router.post('/:token', async (req, res) => {
    if (!verifyBubblSignature(webhookSecret, req.header('X-Hub-Signature-256'), req.rawBody)) {
      logger.error('signature verification failed, rejecting');
      return res.sendStatus(401);
    }

    const validation = validateBubblWebhookPayload(req.body);
    if (!validation.ok) {
      logger.error('rejecting malformed payload:', validation.reason);
      return res.sendStatus(400);
    }

    logger.info('payload:', JSON.stringify(req.body));
    res.sendStatus(200);

    try {
      await relay.handlePayload(req.body);
    } catch (err) {
      logger.error('failed:', err.response?.data || err.message);
    }
  });

  return router;
}

module.exports = { createBubblWebhookRouter };
