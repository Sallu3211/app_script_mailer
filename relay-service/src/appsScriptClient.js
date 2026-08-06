/**
 * appsScriptClient.js
 * Reports detected replies back to the Apps Script Web App. Apps Script
 * Web Apps always return HTTP 200 regardless of application-level outcome,
 * so success is read from body.success, never the status code. This must
 * never throw into the IMAP poll loop -- a reporting failure is logged and
 * skipped, not fatal.
 */

const logger = require('./logger');

async function reportReply(config, { senderEmail, fromEmail, subject, receivedAt }) {
  const payload = {
    secret: config.relaySharedSecret,
    senderEmail,
    fromEmail,
    subject: subject || '',
    receivedAt: receivedAt || new Date().toISOString()
  };

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(config.appsScriptWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (body.success) {
        logger.info(`Reply reported: ${fromEmail} -> ${senderEmail}, matched=${body.matched}`);
        return true;
      }
      logger.warn(`Apps Script rejected reply report (attempt ${attempt}/${attempts}): ${body.error || 'unknown error'}`);
    } catch (err) {
      logger.warn(`Failed to reach Apps Script (attempt ${attempt}/${attempts}): ${err.message}`);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
  }

  logger.error(`Giving up reporting reply from ${fromEmail} to ${senderEmail} after ${attempts} attempts`);
  return false;
}

module.exports = { reportReply };
