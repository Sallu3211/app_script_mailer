/**
 * smtp/sender.js
 * One nodemailer transport per Titan mailbox. Emails are sent as plain text
 * only (no HTML) -- deliberate for cold outreach: plain text reads as a
 * real person, not a template, and avoids HTML-related spam triggers.
 */

const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const logger = require('../logger');

const transportCache = new Map();

function getTransport(senderConfig) {
  const key = senderConfig.email.toLowerCase();
  if (transportCache.has(key)) return transportCache.get(key);

  const transport = nodemailer.createTransport({
    host: senderConfig.smtpHost,
    port: senderConfig.smtpPort,
    secure: !!senderConfig.smtpSecure, // true for 465, false for 587/STARTTLS
    auth: {
      user: senderConfig.smtpUser,
      pass: senderConfig.smtpPass
    }
  });

  transportCache.set(key, transport);
  return transport;
}

/**
 * Sends one email. Throws a classified error (with .code and .permanent)
 * on failure so the /send route can build the right response.
 */
async function sendMail(senderConfig, { to, subject, body, inReplyTo, references }) {
  const transport = getTransport(senderConfig);

  const mailOptions = {
    from: senderConfig.email,
    to,
    subject,
    text: body
  };
  if (inReplyTo) {
    mailOptions.inReplyTo = inReplyTo;
    mailOptions.references = references || inReplyTo;
  }

  try {
    const info = await transport.sendMail(mailOptions);
    // Best-effort only: the send already succeeded and must not be retried
    // or reported as failed just because saving a Sent-folder copy didn't
    // work, so this is deliberately swallowed rather than re-thrown.
    saveSentCopy(senderConfig, mailOptions, info.messageId).catch((err) => {
      logger.warn(`Failed to save Sent-folder copy for ${senderConfig.email}: ${err.message}`);
    });
    return { messageId: info.messageId };
  } catch (err) {
    throw classifySmtpError(err);
  }
}

/**
 * Raw SMTP submission (what sendMail above does) never appears in the
 * mailbox's own Sent folder -- that's a webmail-client behavior, not
 * something the mail server does automatically for third-party SMTP
 * clients. Appends a copy via IMAP so Titan's webmail shows sent mail,
 * same as it would if it had been composed there.
 */
async function saveSentCopy(senderConfig, mailOptions, messageId) {
  const composed = await new MailComposer({ ...mailOptions, messageId }).compile().build();

  const client = new ImapFlow({
    host: senderConfig.imapHost,
    port: senderConfig.imapPort,
    secure: true,
    auth: { user: senderConfig.imapUser, pass: senderConfig.imapPass },
    logger: false
  });

  await client.connect();
  try {
    const folders = await client.list();
    const sentFolder = folders.find((f) => f.specialUse === '\\Sent') || folders.find((f) => f.name === 'Sent');
    if (!sentFolder) throw new Error('No Sent folder found via IMAP LIST');
    await client.append(sentFolder.path, composed, ['\\Seen']);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function classifySmtpError(err) {
  const classified = new Error(err.message);
  classified.original = err;

  const code = (err.responseCode || 0);
  const msg = (err.message || '').toLowerCase();

  if (code === 535 || msg.includes('auth')) {
    classified.code = 'AUTH_FAILED';
    classified.permanent = false; // config issue, not this recipient's fault -- don't bounce the prospect
  } else if (code >= 550 && code < 560) {
    classified.code = 'INVALID_RECIPIENT';
    classified.permanent = true;
  } else if (code >= 500) {
    classified.code = 'SMTP_ERROR';
    classified.permanent = true;
  } else {
    classified.code = 'SMTP_ERROR';
    classified.permanent = false; // transient (4xx, timeout, connection) -- worth retrying
  }
  return classified;
}

module.exports = { sendMail };
