/**
 * index.js
 * Express bootstrap: mounts /send and /health, starts the IMAP poller.
 */

require('dotenv').config();

const express = require('express');
const { loadConfig } = require('./config');
const { requireRelaySecret } = require('./middleware/auth');
const { buildSendRoute } = require('./routes/send');
const { buildHealthRoute } = require('./routes/health');
const poller = require('./imap/poller');
const logger = require('./logger');

let config;
try {
  config = loadConfig();
} catch (err) {
  logger.error('Failed to load config, exiting:', err.message);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', buildHealthRoute());
app.post('/send', requireRelaySecret(config), buildSendRoute(config));

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal error', code: 'INTERNAL', permanent: false });
});

app.listen(config.port, config.host, () => {
  logger.info(`Relay service listening on ${config.host}:${config.port} (${config.nodeEnv})`);
  logger.info(`Configured mailboxes: ${config.senders.map((s) => s.email).join(', ')}`);
  poller.start(config);
});
