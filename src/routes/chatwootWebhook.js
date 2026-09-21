const express = require('express');
const { requireBridgeToken } = require('../middleware/requireBridgeToken');
const { validateChatwootWebhookPayload } = require('../validation');
const { createLogger } = require('../logger');

const logger = createLogger('from-chatwoot');

/**
 * @param {{ bridgeToken: string, relay: { handlePayload: Function } }} deps
 */
function createChatwootWebhookRouter({ bridgeToken, relay }) {
  const router = express.Router();
  router.use('/:token', requireBridgeToken(bridgeToken));

  // Chatwoot's API-channel treats this webhook call as a SYNCHRONOUS send confirmation - it
  // waits on this response to decide sent vs. failed, on a tight timeout. A media reply needs
  // 3 sequential hops (download from Chatwoot -> upload to bubbl -> send via bubbl) which can
  // blow past that timeout even though the send itself succeeds a moment later, so Chatwoot
  // would otherwise show a false "Failed to send". Ack immediately and do the real work
  // after responding, so Chatwoot never waits on the slow part.
  router.post('/:token', (req, res) => {
    const validation = validateChatwootWebhookPayload(req.body);
    if (!validation.ok) {
      logger.error('rejecting malformed payload:', validation.reason);
      return res.sendStatus(400);
    }

    logger.info('raw payload:', JSON.stringify(req.body));
    res.sendStatus(200);

    relay.handlePayload(req.body).catch((err) => {
      logger.error('failed (after ack):', err.response?.data || err.message);
    });
  });

  return router;
}

module.exports = { createChatwootWebhookRouter };
