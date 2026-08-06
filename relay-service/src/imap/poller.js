/**
 * imap/poller.js
 * Every POLL_INTERVAL_MINUTES, checks each configured Titan mailbox's INBOX
 * for messages received since (now - interval - safety margin), and reports
 * any message not sent by the mailbox owner itself to Apps Script as a
 * potential reply. Apps Script does the actual prospect matching.
 *
 * Deliberately stateless (no persisted UID watermark) per the MVP tradeoff:
 * markReplied on the Apps Script side is idempotent, so overlapping poll
 * windows reporting the same message twice is harmless.
 *
 * Mailboxes are polled sequentially (not in parallel) to avoid connection-
 * storming Titan, and each mailbox is wrapped in its own try/catch so one
 * broken mailbox logs-and-continues instead of killing the whole cycle.
 */

const { ImapFlow } = require('imapflow');
const logger = require('./../logger');
const { reportReply } = require('../appsScriptClient');

let timer = null;

function start(config) {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  logger.info(`IMAP poller starting: every ${config.pollIntervalMinutes}min for ${config.senders.length} mailbox(es)`);

  // First poll shortly after boot (not instant, to let the process settle),
  // then on the regular interval.
  setTimeout(() => pollAllMailboxes(config), 5000);
  timer = setInterval(() => pollAllMailboxes(config), intervalMs);
}

function stop() {
  if (timer) clearInterval(timer);
}

async function pollAllMailboxes(config) {
  logger.info(`Poll cycle starting (${config.senders.length} mailbox[es])`);
  for (const sender of config.senders) {
    try {
      await pollMailbox(sender, config);
    } catch (err) {
      logger.error(`IMAP poll failed for ${sender.email}: ${err.message}`);
    }
  }
  logger.info('Poll cycle complete');
}

async function pollMailbox(sender, config) {
  const since = new Date(
    Date.now() - (config.pollIntervalMinutes + config.pollSafetyMarginMinutes) * 60 * 1000
  );

  const client = new ImapFlow({
    host: sender.imapHost,
    port: sender.imapPort,
    secure: true,
    auth: { user: sender.imapUser, pass: sender.imapPass },
    logger: false
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since });
      if (!uids || uids.length === 0) return;

      for await (const msg of client.fetch(uids, { envelope: true })) {
        const fromAddr = msg.envelope && msg.envelope.from && msg.envelope.from[0]
          ? msg.envelope.from[0].address
          : null;
        if (!fromAddr) continue;
        if (fromAddr.toLowerCase() === sender.email.toLowerCase()) continue; // ignore mailbox's own sent copies

        await reportReply(config, {
          senderEmail: sender.email,
          fromEmail: fromAddr,
          subject: msg.envelope.subject || '',
          receivedAt: (msg.envelope.date || new Date()).toISOString()
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

module.exports = { start, stop };
