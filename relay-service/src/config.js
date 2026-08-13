/**
 * config.js
 * Loads and validates all environment configuration. Fails fast on boot if
 * anything required is missing or malformed -- better to crash at deploy
 * time than silently no-op in production.
 */

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function loadConfig() {
  const relaySharedSecret = required('RELAY_SHARED_SECRET');
  const appsScriptWebAppUrl = required('APPS_SCRIPT_WEB_APP_URL');
  const sendersConfigRaw = required('SENDERS_CONFIG');

  let senders;
  try {
    senders = JSON.parse(sendersConfigRaw);
  } catch (e) {
    throw new Error('SENDERS_CONFIG is not valid JSON: ' + e.message);
  }
  if (!Array.isArray(senders) || senders.length === 0) {
    throw new Error('SENDERS_CONFIG must be a non-empty JSON array');
  }

  const requiredSenderFields = [
    'email', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass',
    'imapHost', 'imapPort', 'imapUser', 'imapPass'
  ];
  senders.forEach((s, i) => {
    requiredSenderFields.forEach((field) => {
      if (s[field] === undefined || s[field] === null || s[field] === '') {
        throw new Error(`SENDERS_CONFIG[${i}] is missing field "${field}"`);
      }
    });
  });

  const bySenderEmail = new Map();
  senders.forEach((s) => bySenderEmail.set(s.email.toLowerCase(), s));

  return {
    port: parseInt(process.env.PORT, 10) || 3000,
    // Default stays 0.0.0.0 for platform-managed hosts (e.g. Railway) whose
    // edge proxy needs to reach the container directly. When running behind
    // a reverse proxy on the same box (Caddy on a VPS), set HOST=127.0.0.1
    // so the raw HTTP port is only reachable from localhost -- otherwise
    // it's directly internet-reachable in plaintext, bypassing TLS entirely.
    host: process.env.HOST || '0.0.0.0',
    relaySharedSecret,
    appsScriptWebAppUrl,
    senders,
    bySenderEmail,
    pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 5,
    pollSafetyMarginMinutes: parseInt(process.env.POLL_SAFETY_MARGIN_MINUTES, 10) || 2,
    nodeEnv: process.env.NODE_ENV || 'development'
  };
}

module.exports = { loadConfig };
