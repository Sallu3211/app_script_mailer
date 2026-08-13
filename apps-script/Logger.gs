/**
 * Logger.gs
 */

function logEmailAttempt(entry) {
  appendRow(SHEET_NAMES.LOGS, {
    LogID: generateId('LOG'),
    Timestamp: new Date(),
    CampaignID: entry.campaignId || '',
    SenderID: entry.senderId || '',
    ProspectID: entry.prospectId || '',
    ProspectEmail: entry.prospectEmail || '',
    Stage: (entry.stage === undefined || entry.stage === null) ? '' : entry.stage,
    Subject: entry.subject || '',
    Status: entry.status || '',
    ErrorMessage: entry.errorMessage || '',
    MessageId: entry.messageId || ''
  });
}

function logSystemEvent(message, level) {
  appendRow(SHEET_NAMES.LOGS, {
    LogID: generateId('LOG'),
    Timestamp: new Date(),
    CampaignID: '', SenderID: '', ProspectID: '', ProspectEmail: '', Stage: '', Subject: '',
    Status: level || 'Info',
    ErrorMessage: message,
    MessageId: ''
  });
}

/**
 * Logs every inbound reply the relay reports, whether or not it matched a
 * known prospect -- unmatched ones stay visible so you can see mailbox
 * traffic that isn't a tracked prospect (useful for noticing typos in
 * Prospects.Email, or just general inbox noise).
 */
function logReply(entry) {
  appendRow(SHEET_NAMES.REPLIES, {
    ReplyID: generateId('RPL'),
    Timestamp: new Date(),
    SenderEmail: entry.senderEmail || '',
    ProspectID: entry.prospectId || '',
    ProspectName: entry.prospectName || '',
    ProspectEmail: entry.fromEmail || '',
    CampaignID: entry.campaignId || '',
    Subject: entry.subject || '',
    BodyPreview: entry.bodyPreview || '',
    Matched: entry.matched ? 'Yes' : 'No'
  });
}
