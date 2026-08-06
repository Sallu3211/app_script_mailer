/**
 * routes/send.js
 * POST /send  { senderEmail, to, subject, body, inReplyToMessageId?, references?, prospectId? }
 * -> 200 { success: true, messageId }
 * -> 4xx/5xx { success: false, error, code, permanent }
 */

const { sendMail } = require('../smtp/sender');
const logger = require('../logger');

function buildSendRoute(config) {
  return async function (req, res) {
    const { senderEmail, to, subject, body, inReplyToMessageId, references, prospectId } = req.body || {};

    if (!senderEmail || !to || !subject || body === undefined) {
      return res.status(400).json({
        success: false, error: 'Missing required field(s): senderEmail, to, subject, body',
        code: 'BAD_REQUEST', permanent: true
      });
    }

    const senderConfig = config.bySenderEmail.get(String(senderEmail).toLowerCase());
    if (!senderConfig) {
      logger.error(`/send: unknown sender ${senderEmail}`);
      return res.status(400).json({
        success: false, error: `Unknown sender: ${senderEmail}`,
        code: 'UNKNOWN_SENDER', permanent: false
      });
    }

    try {
      const result = await sendMail(senderConfig, {
        to, subject, body,
        inReplyTo: inReplyToMessageId,
        references
      });
      logger.info(`/send: sent to ${to} via ${senderEmail} (prospect ${prospectId || 'n/a'}) messageId=${result.messageId}`);
      return res.status(200).json({ success: true, messageId: result.messageId });
    } catch (err) {
      logger.error(`/send: failed to ${to} via ${senderEmail}: ${err.message} (code=${err.code})`);
      return res.status(502).json({
        success: false,
        error: err.message,
        code: err.code || 'SMTP_ERROR',
        permanent: !!err.permanent
      });
    }
  };
}

module.exports = { buildSendRoute };
