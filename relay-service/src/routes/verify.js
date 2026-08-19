/**
 * routes/verify.js
 * POST /verify-sender  { email, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass,
 *                          imapHost, imapPort, imapUser, imapPass }
 * Tests SMTP auth (transport.verify()) and an IMAP login for a mailbox that
 * isn't necessarily in SENDERS_CONFIG yet -- lets the wizard catch a typo'd
 * password/host before a sender is wired into the relay for real. The
 * credentials in the request are used once for the check and never
 * persisted or logged.
 * -> 200 { success, smtp: {ok, error?}, imap: {ok, error?} }
 */

const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const logger = require('../logger');

async function checkSmtp(cfg) {
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure !== false,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    connectionTimeout: 10000
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    transport.close();
  }
}

async function checkImap(cfg) {
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: true,
    auth: { user: cfg.imapUser, pass: cfg.imapPass },
    logger: false,
    connectionTimeout: 10000
  });
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function buildVerifyRoute() {
  return async function (req, res) {
    const b = req.body || {};
    const requiredFields = [
      'email', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass',
      'imapHost', 'imapPort', 'imapUser', 'imapPass'
    ];
    const missing = requiredFields.filter((f) => !b[f]);
    if (missing.length) {
      return res.status(400).json({
        success: false, error: 'Missing field(s): ' + missing.join(', '), code: 'BAD_REQUEST'
      });
    }

    const [smtp, imap] = await Promise.all([checkSmtp(b), checkImap(b)]);
    logger.info(`/verify-sender: ${b.email} smtp=${smtp.ok} imap=${imap.ok}`);
    return res.status(200).json({ success: smtp.ok && imap.ok, smtp, imap });
  };
}

module.exports = { buildVerifyRoute };
