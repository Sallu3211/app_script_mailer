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
  SENDERS: ['SenderID', 'Name', 'Email', 'DailyLimit', 'SentToday', 'LastResetDate', 'Status', 'NextAllowedSendAt'],
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

// How far a scheduled send time can randomly drift from its exact computed
// delay, in either direction. Keeps follow-up timing from landing on the
// exact same second every cycle, which reads as robotic/automated.
var SEND_TIME_JITTER_MINUTES = 7;

// When several prospects are added to the same campaign in one batch (the
// wizard's prospect loop, or a bulk/CSV import), their FIRST send is spread
// out instead of all going out in the same scheduler run -- a human sending
// 20 initial emails doesn't hit send on all of them in the same second.
// Prospect N in a batch (0-indexed) gets an initial NextSendDate around
// N * BATCH_STAGGER_AVG_MINUTES from the moment it's added, wobbled by
// +/- BATCH_STAGGER_JITTER_MINUTES so consecutive prospects don't land on a
// perfectly even interval either. Prospect 0 always sends immediately
// (Status Pending) -- staggering only applies from the 2nd prospect in a
// batch onward.
var BATCH_STAGGER_AVG_MINUTES = 9;
var BATCH_STAGGER_JITTER_MINUTES = 4;

// Backstop against bursts regardless of how NextSendDate ended up staggered
// (e.g. a campaign paused for days then resumed, or "Run Scheduler Now"
// clicked repeatedly) -- caps how many brand-new (stage 0) sends a single
// campaign can fire in one scheduler run. Follow-ups (stage > 0) aren't
// capped by this -- they're already spread out via each prospect's own
// send history and shouldn't be made to wait behind a new-prospect queue.
var MAX_INITIAL_SENDS_PER_CAMPAIGN_PER_RUN = 5;

// Per-SENDER spacing gate (not per-campaign, not per-prospect): after any
// successful send, that mailbox is randomly cooled down for somewhere in
// this range before it's allowed to send again, regardless of which
// campaign or which prospect/stage the next due send belongs to. This is
// what actually stops the burst-of-5-in-20-seconds pattern -- capping how
// many fire per scheduler run isn't enough on its own, since a backlog of
// overdue prospects (e.g. after an outage) still lets every allowed one
// through back-to-back with no gap between them. Two campaigns sharing one
// sender are gated together, since the whole point is "this mailbox doesn't
// look like a bot" -- it doesn't matter which campaign the next email is for.
var SENDER_MIN_GAP_MINUTES = 5;
var SENDER_MAX_GAP_MINUTES = 20;

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
