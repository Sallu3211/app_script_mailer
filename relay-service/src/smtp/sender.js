/**
 * smtp/sender.js
 * One nodemailer transport per Titan mailbox. Emails are sent as plain text
 * only (no HTML) -- deliberate for cold outreach: plain text reads as a
 * real person, not a template, and avoids HTML-related spam triggers.
 */

const nodemailer = require('nodemailer');

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
    return { messageId: info.messageId };
  } catch (err) {
    throw classifySmtpError(err);
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
