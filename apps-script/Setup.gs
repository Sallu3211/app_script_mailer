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
  createSheetIfMissing_(SHEET_NAMES.REPLIES, COLUMNS.REPLIES);
  ensureBulkImportSheet_();

  seedSettings_();
  seedSampleData_();
  migrateTemplatesToProspectScoped_();
  fixSendWindowColumnFormat_();
  fixLastResetDateColumnFormat_();
  installTriggers();

  // Remove the default "Sheet1" if it's empty and untouched.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  var message =
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
    'own address before running the scheduler, so nothing goes to real prospects yet.';

  // getUi() only works when triggered from the Sheet's own UI (its menu, or
  // a simple trigger) -- running this from the script editor's Run button
  // has no UI context and getUi() throws. Fall back to a Logs entry so
  // setup still completes cleanly either way.
  try {
    SpreadsheetApp.getUi().alert('Setup complete', message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    logSystemEvent('Setup complete (run from script editor, no UI to show alert): ' + message, 'Info');
  }
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

  // Templates belong to a specific PROSPECT, not the campaign -- each
  // prospect gets their own Initial + follow-up content. A second sample
  // prospect is included below with deliberately different wording, purely
  // to make that "each prospect owns their own sequence" pattern obvious.
  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    ProspectID: prospectId,
    Stage: 0,
    DelayDaysFromPrevious: 0,
    Subject: 'Quick question, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nI noticed {{company}} might be a good fit for what we do...\n\nWorth a quick chat?\n\nBest'
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    ProspectID: prospectId,
    Stage: 1,
    DelayDaysFromPrevious: 2,
    Subject: 'Following up, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nJust bumping this to the top of your inbox in case it got buried.\n\nBest'
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    ProspectID: prospectId,
    Stage: 2,
    DelayDaysFromPrevious: 3,
    Subject: 'One more try, {{first_name}}',
    Body: 'Hi {{first_name}},\n\nI\'ll leave you alone after this one — if it\'s not relevant, no worries at all.\n\nBest'
  });

  var prospectId2 = generateId('PRO');
  appendRow(SHEET_NAMES.PROSPECTS, {
    ProspectID: prospectId2,
    FirstName: 'Mark',
    LastName: 'Lee',
    Company: 'Northwind LLC',
    Email: 'mark@northwind.test',
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
    ProspectID: prospectId2,
    Stage: 0,
    DelayDaysFromPrevious: 0,
    Subject: 'A different angle for {{company}}',
    Body: 'Hey {{first_name}},\n\nDifferent approach here -- saw {{company}} is expanding and thought this might be timely...\n\nOpen to a quick look?\n\nBest'
  });

  appendRow(SHEET_NAMES.TEMPLATES, {
    TemplateID: generateId('TPL'),
    ProspectID: prospectId2,
    Stage: 1,
    DelayDaysFromPrevious: 3,
    Subject: 'Re: A different angle for {{company}}',
    Body: 'Hi {{first_name}},\n\nWanted to circle back in case this got lost -- happy to send more detail if useful.\n\nBest'
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

/**
 * One-time migration: earlier versions of this project keyed Templates by
 * CampaignID (shared across every prospect in a campaign). Templates are
 * now owned per-PROSPECT instead. This detects a Templates tab still using
 * the old header and rewrites it in place: every old campaign-scoped
 * template row is duplicated for each prospect currently in that campaign
 * (a reasonable starting point -- before this change they all received
 * identical merge-tag-personalized content anyway, so duplicating gives
 * every prospect their own independently-editable copy to diverge from).
 * No-ops immediately if the sheet is already on the new schema.
 */
function migrateTemplatesToProspectScoped_() {
  var sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.TEMPLATES);
  if (!sheet || sheet.getLastRow() < 1) return;

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (header.indexOf('ProspectID') !== -1) return; // already migrated
  if (header.indexOf('CampaignID') === -1) return; // unrecognized shape, don't touch it

  var oldRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues()
    : [];

  var prospects = sheetToObjects(SHEET_NAMES.PROSPECTS);
  var prospectsByCampaign = {};
  prospects.forEach(function (p) {
    if (!prospectsByCampaign[p.CampaignID]) prospectsByCampaign[p.CampaignID] = [];
    prospectsByCampaign[p.CampaignID].push(p.ProspectID);
  });

  var campaignIdCol = header.indexOf('CampaignID');
  var newRows = [];
  oldRows.forEach(function (row) {
    var campaignId = row[campaignIdCol];
    var prospectIds = prospectsByCampaign[campaignId] || [];
    prospectIds.forEach(function (prospectId) {
      var newRow = row.slice();
      newRow[campaignIdCol] = prospectId; // same column position, new meaning
      newRows.push(newRow);
    });
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, COLUMNS.TEMPLATES.length).setValues([COLUMNS.TEMPLATES]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, COLUMNS.TEMPLATES.length).setFontWeight('bold');
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, COLUMNS.TEMPLATES.length).setValues(newRows);
  }

  logSystemEvent(
    'Migrated Templates tab from CampaignID-scoped to ProspectID-scoped: ' +
    oldRows.length + ' old row(s) -> ' + newRows.length + ' new row(s)',
    'Info'
  );
}

/**
 * Forces Campaigns!SendWindowStart/End to Plain Text formatting, so typing
 * "09:00" can never again get silently auto-converted by Sheets into an
 * internal time-serial value (the root cause of send windows mysteriously
 * never matching). Also self-heals any row that's already corrupted this
 * way by rewriting it back to clean "HH:mm" text. Safe to re-run.
 */
function fixSendWindowColumnFormat_() {
  var sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.CAMPAIGNS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var startCol = COLUMNS.CAMPAIGNS.indexOf('SendWindowStart') + 1;
  var endCol = COLUMNS.CAMPAIGNS.indexOf('SendWindowEnd') + 1;
  var numRows = sheet.getLastRow() - 1;

  sheet.getRange(2, startCol, numRows, 1).setNumberFormat('@');
  sheet.getRange(2, endCol, numRows, 1).setNumberFormat('@');

  var data = sheet.getRange(2, 1, numRows, sheet.getLastColumn()).getValues();
  data.forEach(function (row, i) {
    var rowNum = i + 2;
    var startVal = row[startCol - 1];
    var endVal = row[endCol - 1];
    if (startVal instanceof Date) {
      sheet.getRange(rowNum, startCol).setValue(normalizeTimeOfDay_(startVal));
    }
    if (endVal instanceof Date) {
      sheet.getRange(rowNum, endCol).setValue(normalizeTimeOfDay_(endVal));
    }
  });
}

/**
 * Forces Senders!LastResetDate and Campaigns!LastResetDate to Plain Text
 * formatting and self-heals any row already corrupted into a Date value --
 * same failure class as fixSendWindowColumnFormat_ above: Sheets silently
 * reinterprets a "yyyy-MM-dd" string as an internal date-serial using the
 * SPREADSHEET's own locale timezone, not Settings!TIMEZONE. Left uncaught,
 * isNewDay() reformats that Date using Settings!TIMEZONE and can land on
 * the wrong calendar day permanently, making the scheduler think every run
 * is a new day -- resetting SentToday to 0 before every single cycle
 * instead of once per real day. Safe to re-run any time.
 */
function fixLastResetDateColumnFormat_() {
  fixOneLastResetDateColumn_(SHEET_NAMES.SENDERS, COLUMNS.SENDERS);
  fixOneLastResetDateColumn_(SHEET_NAMES.CAMPAIGNS, COLUMNS.CAMPAIGNS);
}

function fixOneLastResetDateColumn_(sheetName, columns) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;

  var col = columns.indexOf('LastResetDate') + 1;
  var numRows = sheet.getLastRow() - 1;
  sheet.getRange(2, col, numRows, 1).setNumberFormat('@');

  var values = sheet.getRange(2, col, numRows, 1).getValues();
  values.forEach(function (row, i) {
    if (row[0] instanceof Date) {
      sheet.getRange(i + 2, col).setValue(Utilities.formatDate(row[0], getSetting('TIMEZONE'), 'yyyy-MM-dd'));
    }
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
