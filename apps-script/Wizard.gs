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

/**
 * Campaigns belonging to one sender, for the wizard's "use an existing
 * campaign" mode -- lets you add another batch of prospects to a campaign
 * you already created without recreating it.
 */
function wizardGetCampaignsForSender(senderId) {
  return sheetToObjects(SHEET_NAMES.CAMPAIGNS)
    .filter(function (c) { return c.SenderID === senderId; })
    .map(function (c) { return { campaignId: c.CampaignID, name: c.Name, status: c.Status }; });
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

  var schedule = computeInitialSchedule_(data.sequencePosition);
  var prospectId = generateId('PRO');
  appendRow(SHEET_NAMES.PROSPECTS, {
    ProspectID: prospectId,
    FirstName: data.firstName || '',
    LastName: data.lastName || '',
    Company: data.company || '',
    Email: normalizeEmail(data.email),
    CampaignID: campaign.CampaignID,
    SenderID: campaign.SenderID,
    Status: schedule.status,
    CurrentStage: 0,
    LastSentDate: '',
    NextSendDate: schedule.nextSendDate,
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

/* ------------------------------------------------------------------ *
 * Bulk import: one row per prospect in a "Bulk Import" sheet tab, each
 * row carrying its own sender + full template sequence. Rows sharing the
 * same SenderEmail/CampaignName are deduped against each other AND
 * against existing Senders/Campaigns rows, so importing 50 prospects for
 * the same sender+campaign creates that sender/campaign once, not 50
 * times. Stage columns (Stage0Subject/Stage0Body/Stage1Subject/...) are
 * detected dynamically from the header row, not hardcoded, so the sheet
 * can be trimmed or extended (up to Stage10, MAX_FOLLOWUPS) without a
 * code change.
 * ------------------------------------------------------------------ */

var BULK_IMPORT_SHEET_ = 'Bulk Import';

var BULK_IMPORT_FIXED_COLUMNS_ = [
  'SenderEmail', 'SenderName', 'SenderPassword', 'SenderSmtpHost', 'SenderSmtpPort',
  'SenderImapHost', 'SenderImapPort', 'SenderDailyLimit',
  'CampaignName', 'CampaignDailyLimit', 'SendWindowStart', 'SendWindowEnd',
  'FirstName', 'LastName', 'Company', 'ProspectEmail', 'Custom1', 'Custom2'
];

var BULK_IMPORT_STATUS_COLUMN_ = 'ImportStatus';

function ensureBulkImportSheet_() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BULK_IMPORT_SHEET_);
  if (sheet) return sheet;

  var stageHeaders = [];
  for (var s = 0; s <= MAX_FOLLOWUPS; s++) {
    stageHeaders.push('Stage' + s + 'Subject', 'Stage' + s + 'Body');
    if (s > 0) stageHeaders.push('Stage' + s + 'DelayDays');
  }
  var headers = BULK_IMPORT_FIXED_COLUMNS_.concat(stageHeaders, [BULK_IMPORT_STATUS_COLUMN_]);

  sheet = ss.insertSheet(BULK_IMPORT_SHEET_);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  var example = {
    SenderEmail: 'name@yourdomain.com', SenderName: 'Your Name', SenderPassword: 'mailbox-password',
    SenderSmtpHost: 'smtp.titan.email', SenderSmtpPort: 465,
    SenderImapHost: 'imap.titan.email', SenderImapPort: 993, SenderDailyLimit: 50,
    CampaignName: 'Example Bulk Campaign', CampaignDailyLimit: 30, SendWindowStart: '09:00', SendWindowEnd: '17:00',
    FirstName: 'Jane', LastName: 'Doe', Company: 'Acme Co', ProspectEmail: 'jane@example.com',
    Custom1: 'their homepage messaging', Custom2: 'landing page conversion',
    Stage0Subject: 'Quick idea for {{company}}',
    Stage0Body: 'Hi {{first_name}}, I noticed {{custom1}}...',
    Stage1Subject: 'Following up', Stage1Body: 'Hi {{first_name}}, just checking in...', Stage1DelayDays: 2,
    ImportStatus: 'Example row -- edit or delete before importing'
  };
  sheet.getRange(2, 1, 1, headers.length).setValues([headers.map(function (h) { return example.hasOwnProperty(h) ? example[h] : ''; })]);

  sheet.getRange(2, 1, 1, headers.length).setFontColor('#999999');
  return sheet;
}

/**
 * Creates the Bulk Import tab if it doesn't exist yet and returns a direct
 * link to it (spreadsheet URL + gid) so the wizard can open it in one
 * click.
 */
function wizardGetBulkImportTemplate() {
  var sheet = ensureBulkImportSheet_();
  return { url: getSpreadsheet().getUrl() + '#gid=' + sheet.getSheetId() };
}

function bulkImportStageNumbers_(headers) {
  var stages = {};
  headers.forEach(function (h) {
    var m = /^Stage(\d+)Subject$/.exec(h);
    if (m) stages[Number(m[1])] = true;
  });
  return Object.keys(stages).map(Number).sort(function (a, b) { return a - b; });
}

/**
 * Reads every not-yet-imported row from the Bulk Import tab and creates
 * the Sender/Campaign/Prospect/Template rows for each. Idempotent: rows
 * already marked 'Imported' are skipped, so re-running after fixing a
 * typo in one bad row doesn't duplicate everyone else. Newly-created
 * senders stay 'Pending' (same rule as the single-add flow); newly
 * created campaigns are started immediately (that's the point of a bulk
 * "get this running" import) -- campaigns that already existed and were
 * reused are left exactly as they were, so this never silently
 * reactivates something you deliberately paused.
 */
function wizardBulkImport() {
  var sheet = ensureBulkImportSheet_();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { sendersCreated: [], campaignsCreated: [], prospectsCreated: [], skipped: [], errors: [] };

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var statusCol = headers.indexOf(BULK_IMPORT_STATUS_COLUMN_) + 1;
  var stages = bulkImportStageNumbers_(headers);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var results = { sendersCreated: [], campaignsCreated: [], prospectsCreated: [], skipped: [], errors: [] };
  var senderCache = {}; // normalized email -> senderId
  var campaignCache = {}; // senderId + '|' + campaignName -> campaignId

  data.forEach(function (row, i) {
    var rowNum = i + 2;
    var obj = {};
    headers.forEach(function (h, c) { obj[h] = row[c]; });

    var status = obj[BULK_IMPORT_STATUS_COLUMN_];
    if (status === 'Imported' || (status && String(status).indexOf('Example row') === 0)) {
      results.skipped.push(rowNum);
      return;
    }
    if (!obj.SenderEmail && !obj.ProspectEmail) return; // blank row

    try {
      if (!obj.SenderEmail) throw new Error('SenderEmail is required');
      if (!obj.ProspectEmail) throw new Error('ProspectEmail is required');
      if (!obj.CampaignName) throw new Error('CampaignName is required');

      var senderEmail = normalizeEmail(obj.SenderEmail);
      var senderId = senderCache[senderEmail];
      if (!senderId) {
        var existingSender = getSenderByEmail(senderEmail);
        if (existingSender) {
          senderId = existingSender.SenderID;
        } else {
          var s = wizardAddSender({
            name: obj.SenderName || senderEmail,
            email: senderEmail,
            dailyLimit: obj.SenderDailyLimit,
            smtpHost: obj.SenderSmtpHost,
            smtpPort: obj.SenderSmtpPort,
            imapHost: obj.SenderImapHost,
            imapPort: obj.SenderImapPort,
            password: obj.SenderPassword
          });
          senderId = s.senderId;
          results.sendersCreated.push({ senderId: senderId, email: senderEmail, configSnippet: s.configSnippet });
        }
        senderCache[senderEmail] = senderId;
      }

      var campKey = senderId + '|' + obj.CampaignName;
      var campaignId = campaignCache[campKey];
      var campaignIsNew = false;
      if (!campaignId) {
        var existingCampaigns = sheetToObjects(SHEET_NAMES.CAMPAIGNS).filter(function (c) {
          return c.SenderID === senderId && c.Name === obj.CampaignName;
        });
        if (existingCampaigns.length > 0) {
          campaignId = existingCampaigns[0].CampaignID;
        } else {
          var c = wizardAddCampaign({
            name: obj.CampaignName, senderId: senderId, dailyLimit: obj.CampaignDailyLimit,
            sendWindowStart: obj.SendWindowStart, sendWindowEnd: obj.SendWindowEnd
          });
          campaignId = c.campaignId;
          campaignIsNew = true;
          results.campaignsCreated.push({ campaignId: campaignId, name: obj.CampaignName });
        }
        campaignCache[campKey] = campaignId;
      }

      var sequence = [];
      stages.forEach(function (stageNum) {
        var subject = obj['Stage' + stageNum + 'Subject'];
        var body = obj['Stage' + stageNum + 'Body'];
        if (!subject && !body) return; // gap in the sequence -- stop, don't create empty stages
        sequence.push({
          subject: subject,
          body: body,
          delayDays: stageNum === 0 ? 0 : obj['Stage' + stageNum + 'DelayDays']
        });
      });
      if (sequence.length === 0) throw new Error('Stage0Subject/Stage0Body (the Initial email) is required');

      var p = wizardAddProspectWithTemplates({
        campaignId: campaignId, firstName: obj.FirstName, lastName: obj.LastName, company: obj.Company,
        email: obj.ProspectEmail, custom1: obj.Custom1, custom2: obj.Custom2, sequence: sequence
      });
      results.prospectsCreated.push({ prospectId: p.prospectId, email: obj.ProspectEmail, campaignId: campaignId });

      if (campaignIsNew) wizardStartCampaign(campaignId);

      sheet.getRange(rowNum, statusCol).setValue('Imported');
    } catch (err) {
      sheet.getRange(rowNum, statusCol).setValue('Error: ' + err.message);
      results.errors.push('Row ' + rowNum + ' (' + (obj.ProspectEmail || '?') + '): ' + err.message);
    }
  });

  return results;
}
