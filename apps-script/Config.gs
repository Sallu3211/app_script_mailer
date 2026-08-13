/**
 * Config.gs
 * Single source of truth for sheet names, column layouts, and Settings access.
 * No business logic here — just constants and getSetting/setSetting.
 */

var SHEET_NAMES = {
  SETTINGS: 'Settings',
  SENDERS: 'Senders',
  CAMPAIGNS: 'Campaigns',
  PROSPECTS: 'Prospects',
  TEMPLATES: 'Templates',
  LOGS: 'Logs',
  REPLIES: 'Replies'
};

var COLUMNS = {
  SETTINGS: ['Key', 'Value'],
  SENDERS: ['SenderID', 'Name', 'Email', 'DailyLimit', 'SentToday', 'LastResetDate', 'Status'],
  CAMPAIGNS: ['CampaignID', 'Name', 'SenderID', 'DailyLimit', 'SentToday', 'LastResetDate', 'SendWindowStart', 'SendWindowEnd', 'Status'],
  PROSPECTS: ['ProspectID', 'FirstName', 'LastName', 'Company', 'Email', 'CampaignID', 'SenderID', 'Status', 'CurrentStage', 'LastSentDate', 'NextSendDate', 'LastMessageId', 'LastError', 'Custom1', 'Custom2'],
  TEMPLATES: ['TemplateID', 'ProspectID', 'Stage', 'DelayDaysFromPrevious', 'Subject', 'Body'],
  LOGS: ['LogID', 'Timestamp', 'CampaignID', 'SenderID', 'ProspectID', 'ProspectEmail', 'Stage', 'Subject', 'Status', 'ErrorMessage', 'MessageId'],
  REPLIES: ['ReplyID', 'Timestamp', 'SenderEmail', 'ProspectID', 'ProspectName', 'ProspectEmail', 'CampaignID', 'Subject', 'BodyPreview', 'Matched']
};

var PROSPECT_STATUS = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  PAUSED: 'Paused',
  REPLIED: 'Replied',
  BOUNCED: 'Bounced',
  COMPLETED: 'Completed'
};

// Statuses the scheduler is allowed to pick up. Everything else is a permanent
// or manual stop and must never be touched by getDueProspects().
var PROSPECT_ACTIVE_STATUSES = [PROSPECT_STATUS.PENDING, PROSPECT_STATUS.SCHEDULED];

var MAX_FOLLOWUPS = 10;

var DEFAULT_SETTINGS = [
  ['RELAY_BASE_URL', ''],
  ['RELAY_SHARED_SECRET', ''],
  ['APPS_SCRIPT_WEB_APP_URL', ''],
  ['TIMEZONE', Session.getScriptTimeZone()],
  ['SCHEDULER_INTERVAL_MINUTES', '10'],
  ['DAILY_RESET_HOUR', '0'],
  ['SYSTEM_STATUS', 'Active'],
  ['MAX_EMAILS_PER_RUN', '50'],
  ['TEST_MODE', 'TRUE'],
  ['TEST_MODE_EMAIL_OVERRIDE', '']
];

var _settingsCache = null;

/**
 * Reads a value from the Settings sheet. Cached per script execution
 * (Apps Script executions are short-lived, so a module-level cache is safe
 * and avoids re-reading the sheet for every prospect in a scheduler run).
 */
function getSetting(key) {
  if (!_settingsCache) {
    _settingsCache = {};
    var rows = sheetToObjects(SHEET_NAMES.SETTINGS);
    for (var i = 0; i < rows.length; i++) {
      _settingsCache[rows[i].Key] = rows[i].Value;
    }
  }
  return _settingsCache.hasOwnProperty(key) ? _settingsCache[key] : '';
}

function setSetting(key, value) {
  var sheet = getSpreadsheet().getSheetByName(SHEET_NAMES.SETTINGS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      if (_settingsCache) _settingsCache[key] = value;
      return;
    }
  }
  sheet.appendRow([key, value]);
  if (_settingsCache) _settingsCache[key] = value;
}

function getSettingBool(key) {
  var v = String(getSetting(key)).trim().toUpperCase();
  return v === 'TRUE' || v === '1' || v === 'YES';
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}
