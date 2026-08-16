/**
 * Wizard.gs
 * Backing functions for the guided "Add Campaign" wizard (campaignWizard.html).
 * Reuses the same sheet-write helpers as the rest of the app -- this is a
 * friendlier guided way to fill in the same Senders/Campaigns/Prospects/
 * Templates rows you could type by hand, not a separate data path.
 */

function wizardGetSenders() {
  return sheetToObjects(SHEET_NAMES.SENDERS).map(function (s) {
    return { senderId: s.SenderID, name: s.Name, email: s.Email, status: s.Status };
  });
}

/**
 * Adds a Sender row with only the fields that are safe to store in the
 * Sheet (Name/Email/DailyLimit). Status starts 'Pending' -- not 'Active' --
 * so the scheduler can never pick it up before it's actually wired up.
 * The SMTP/IMAP credentials entered here are NEVER written to the Sheet;
 * the relay's real credentials live in its own server-side env file (see
 * README), so this only echoes the entered credentials back as a
 * copy-paste block for you to relay onward.
 */
function wizardAddSender(data) {
  if (!data.email) throw new Error('Email is required');
  if (!data.name) throw new Error('Name is required');

  var senderId = generateId('SND');
  appendRow(SHEET_NAMES.SENDERS, {
    SenderID: senderId,
    Name: data.name,
    Email: normalizeEmail(data.email),
    DailyLimit: parseInt(data.dailyLimit, 10) || 50,
    SentToday: 0,
    LastResetDate: todayDateString(),
    Status: 'Pending'
  });
  fixLastResetDateColumnFormat_();

  var configSnippet = JSON.stringify({
    email: normalizeEmail(data.email),
    smtpHost: data.smtpHost || 'smtp.titan.email',
    smtpPort: parseInt(data.smtpPort, 10) || 465,
    smtpSecure: true,
    smtpUser: normalizeEmail(data.email),
    smtpPass: data.password || '',
    imapHost: data.imapHost || 'imap.titan.email',
    imapPort: parseInt(data.imapPort, 10) || 993,
    imapUser: normalizeEmail(data.email),
    imapPass: data.password || ''
  });

  logSystemEvent(
    'Wizard added sender ' + senderId + ' (' + data.email + ') as Pending -- ' +
    'needs the relay\'s SENDERS_CONFIG updated (and the sender flipped to Active) before it can send',
    'Info'
  );

  return { senderId: senderId, configSnippet: configSnippet };
}

function wizardAddCampaign(data) {
  if (!data.name) throw new Error('Campaign name is required');
  if (!data.senderId) throw new Error('Sender is required');

  var campaignId = generateId('CMP');
  appendRow(SHEET_NAMES.CAMPAIGNS, {
    CampaignID: campaignId,
    Name: data.name,
    SenderID: data.senderId,
    DailyLimit: parseInt(data.dailyLimit, 10) || 30,
    SentToday: 0,
    LastResetDate: todayDateString(),
    SendWindowStart: data.sendWindowStart || '09:00',
    SendWindowEnd: data.sendWindowEnd || '17:00',
    Status: 'Paused' // the wizard's Start step flips this explicitly
  });
  fixSendWindowColumnFormat_();
  fixLastResetDateColumnFormat_();

  return { campaignId: campaignId };
}

/**
 * Like addProspectWithFollowups, but takes full Subject/Body/delay content
 * per stage up front instead of leaving blank Template rows to fill in
 * afterward by hand.
 */
function wizardAddProspectWithTemplates(data) {
  if (!data.email) throw new Error('Email is required');
  if (!data.campaignId) throw new Error('Campaign is required');
  if (!data.sequence || data.sequence.length === 0) throw new Error('At least one email (the Initial) is required');

  var campaign = getCampaignById(data.campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + data.campaignId);

  var prospectId = generateId('PRO');
  appendRow(SHEET_NAMES.PROSPECTS, {
    ProspectID: prospectId,
    FirstName: data.firstName || '',
    LastName: data.lastName || '',
    Company: data.company || '',
    Email: normalizeEmail(data.email),
    CampaignID: campaign.CampaignID,
    SenderID: campaign.SenderID,
    Status: PROSPECT_STATUS.PENDING,
    CurrentStage: 0,
    LastSentDate: '',
    NextSendDate: '',
    LastMessageId: '',
    LastError: '',
    Custom1: data.custom1 || '',
    Custom2: data.custom2 || ''
  });

  data.sequence.slice(0, MAX_FOLLOWUPS + 1).forEach(function (stage, i) {
    appendRow(SHEET_NAMES.TEMPLATES, {
      TemplateID: generateId('TPL'),
      ProspectID: prospectId,
      Stage: i,
      DelayDaysFromPrevious: i === 0 ? 0 : (parseFloat(stage.delayDays) || 0),
      Subject: stage.subject || '',
      Body: stage.body || ''
    });
  });

  return { prospectId: prospectId, stagesCreated: data.sequence.length };
}

/**
 * Flips the campaign Active. Sends don't happen instantly -- the normal
 * time-based trigger picks it up on its next run (within
 * Settings!SCHEDULER_INTERVAL_MINUTES), same as every other campaign.
 */
function wizardStartCampaign(campaignId) {
  var campaign = getCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  var sender = getSenderById(campaign.SenderID);

  updateRowByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaignId, { Status: 'Active' });

  return {
    started: true,
    senderActive: !!(sender && sender.Status === 'Active'),
    warning: (!sender || sender.Status !== 'Active')
      ? 'This campaign\'s sender isn\'t Active yet -- nothing will send until the sender\'s credentials are confirmed on the relay and it\'s flipped to Active.'
      : ''
  };
}
