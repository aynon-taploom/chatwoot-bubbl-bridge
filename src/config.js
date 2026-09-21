require('dotenv').config();

const REQUIRED_VARS = [
  'BRIDGE_TOKEN',
  'CHATWOOT_INBOX_IDENTIFIER',
  'BUBBL_BUSINESS_PROFILE_UUID',
  'BUBBL_API_KEY',
];

/**
 * Loads and validates the bridge's configuration from environment variables. Throws (rather
 * than calling process.exit itself) so the caller decides how to report the error and exit -
 * that also makes this testable without a real process teardown.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')} (copy .env.example to .env and fill it in)`
    );
  }

  return {
    port: Number(env.PORT) || 8787,
    bridgeToken: env.BRIDGE_TOKEN,
    chatwoot: {
      baseUrl: env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com',
      inboxIdentifier: env.CHATWOOT_INBOX_IDENTIFIER,
      accountId: env.CHATWOOT_ACCOUNT_ID,
      apiAccessToken: env.CHATWOOT_API_ACCESS_TOKEN || null,
    },
    bubbl: {
      baseUrl: env.BUBBL_API_BASE_URL || 'https://api.business.bubbl.dev',
      businessProfileUuid: env.BUBBL_BUSINESS_PROFILE_UUID,
      apiKey: env.BUBBL_API_KEY,
      webhookSecret: env.BUBBL_WEBHOOK_SECRET || null,
    },
  };
}

module.exports = { loadConfig };
