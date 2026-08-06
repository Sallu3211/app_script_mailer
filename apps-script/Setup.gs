/**
 * Setup.gs
 * One-time (and safely re-runnable) provisioning. Run setupSystem() once
 * from the script editor or the "Cold Email" menu after pasting all files in.
 */

function setupSystem() {
  var ss = getSpreadsheet();

  createSheetIfMissing_(SHEET_NAMES.SETTINGS, COLUMNS.SETTINGS);
  createSheetIfMissing_(SHEET_NAMES.SENDERS, COLUMNS.SENDERS);
  createSheetIfMissing_(SHEET_NAMES.CAMPAIGNS, COLUMNS.CAMPAIGNS);
  createSheetIfMissing_(SHEET_NAMES.PROSPECTS, COLUMNS.PROSPECTS);
  createSheetIfMissing_(SHEET_NAMES.TEMPLATES, COLUMNS.TEMPLATES);
  createSheetIfMissing_(SHEET_NAMES.LOGS, COLUMNS.LOGS);

  seedSettings_();
  seedSampleData_();
  installTriggers();

  // Remove the default "Sheet1" if it's empty and untouched.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  SpreadsheetApp.getUi().alert(
    'Setup complete',
    'All tabs created with sample data.\n\n' +
    'Next steps:\n' +
    '1. Deploy this project as a Web App (Deploy > New deployment > Web app) ' +
    'and paste the /exec URL into Settings!APPS_SCRIPT_WEB_APP_URL.\n' +
    '2. Deploy relay-service to Railway and paste its public URL into ' +
    'Settings!RELAY_BASE_URL.\n' +
    '3. The Settings!RELAY_SHARED_SECRET value has been generated for you — ' +
    'copy it into the relay service\'s RELAY_SHARED_SECRET env var, exactly.\n' +
    '4. Replace the sample Sender/Campaign/Prospect/Template rows with your real data.\n' +
    '5. TEST_MODE is ON by default — set Settings!TEST_MODE_EMAIL_OVERRIDE to your ' +
    'own address before running the scheduler, so nothing goes to real prospects yet.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function createSheetIfMissing_(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function seedSettings_() {
  var sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.SETTINGS);
  var existing = sheetToObjects(SHEET_NAMES.SETTINGS);
  var existingKeys = existing.map(function (r) { return r.Key; });

  DEFAULT_SETTINGS.forEach(function (pair) {
    if (existingKeys.indexOf(pair[0]) === -1) {
      var value = pair[1];
      if (pair[0] === 'RELAY_SHARED_SECRET') value = generateSharedSecret_();
      sheet.appendRow([pair[0], value]);
    }
  });
}

function generateSharedSecret_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/**
 * Inserts one example row per data tab so the sheet is immediately usable
 * as a template. Idempotent: skipped if Senders already has rows (i.e. this
 * isn't a first run).
 */
function seedSampleData_() {
  var senders = sheetToObjects(SHEET_NAMES.SENDERS);
  if (senders.length > 0) return; // already seeded / real data present

  var senderId = generateId('SND');
  var campaignId = generateId('CMP');
  var prospectId = generateId('PRO');

  appendRow(SHEET_NAMES.SENDERS, {
    SenderID: senderId,
    Name: 'Example Sender',
    Email: 'sales1@example.com',
    DailyLimit: 50,
    SentToday: 0,
    LastResetDate: todayDateString(),
    Status: 'Inactive' // left Inactive on purpose so a fresh setup can't send for real
  });

  appendRow(SHEET_NAMES.CAMPAIGNS, {
    CampaignID: campaignId,
    Name: 'Example Campaign',
    SenderID: senderId,
    DailyLimit: 30,
    SentToday: 0,
    LastResetDate: todayDateString(),
    SendWindowStart: '09:00',
    SendWindowEnd: '17:00',
    Status: 'Paused' // left Paused on purpose, same reason
  });

  appendRow(SHEET_NAMES.PROSPECTS, {
    ProspectID: prospectId,
    FirstName: 'Jane',
    LastName: 'Doe',
    Company: 'Acme Co',
    Email: 'jane@acme.test',
    CampaignID: campaignId,
    SenderID: senderId,
    Status: PROSPECT_STATUS.PENDING,
    CurrentStage: 0,
    LastSentDate: '',
    NextSendDate: '',
    LastMessageId: '',
    LastError: '',
    Custom1: '',
    Custom2: ''
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    CampaignID: campaignId,
    Stage: 0,
    DelayDaysFromPrevious: 0,
    Subject: 'Quick question, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nI noticed {{company}} might be a good fit for what we do...\n\nWorth a quick chat?\n\nBest'
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    CampaignID: campaignId,
    Stage: 1,
    DelayDaysFromPrevious: 2,
    Subject: 'Following up, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nJust bumping this to the top of your inbox in case it got buried.\n\nBest'
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    CampaignID: campaignId,
    Stage: 2,
    DelayDaysFromPrevious: 3,
    Subject: 'One more try, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nI\'ll leave you alone after this one — if it\'s not relevant, no worries at all.\n\nBest'
  });

  appendRow(SHEET_NAMES.LOGS, {
    LogID: generateId('LOG'),
    Timestamp: new Date(),
    CampaignID: '',
    SenderID: '',
    ProspectID: '',
    ProspectEmail: '',
    Stage: '',
    Subject: '',
    Status: 'Info',
    ErrorMessage: 'setupSystem() completed',
    MessageId: ''
  });
}

function installTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduler') {
      ScriptApp.deleteTrigger(t);
    }
  });

  var minutes = parseInt(getSetting('SCHEDULER_INTERVAL_MINUTES'), 10) || 10;
  // clamped to Apps Script's allowed minute values for newTrigger().everyMinutes()
  var allowed = [1, 5, 10, 15, 30];
  var closest = allowed.reduce(function (prev, curr) {
    return Math.abs(curr - minutes) < Math.abs(prev - minutes) ? curr : prev;
  });

  ScriptApp.newTrigger('runScheduler')
    .timeBased()
    .everyMinutes(closest)
    .create();
}
