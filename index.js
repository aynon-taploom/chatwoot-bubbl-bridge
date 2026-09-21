const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = createApp(config);

app.listen(config.port, () => {
  console.log(`chatwoot-bubbl-bridge listening on :${config.port}`);
});
