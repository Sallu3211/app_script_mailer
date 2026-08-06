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
