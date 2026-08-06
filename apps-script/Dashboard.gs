/**
 * Dashboard.gs
 */

function renderDashboard() {
  return HtmlService.createTemplateFromFile('dashboard')
    .evaluate()
    .setTitle('Cold Email Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardStats() {
  var campaigns = sheetToObjects(SHEET_NAMES.CAMPAIGNS);
  var senders = sheetToObjects(SHEET_NAMES.SENDERS);
  var prospects = sheetToObjects(SHEET_NAMES.PROSPECTS);

  var emailsSentToday = campaigns.reduce(function (sum, c) {
    return sum + (parseInt(c.SentToday, 10) || 0);
  }, 0);

  var pending = prospects.filter(function (p) {
    return PROSPECT_ACTIVE_STATUSES.indexOf(p.Status) !== -1;
  }).length;

  var replies = prospects.filter(function (p) { return p.Status === PROSPECT_STATUS.REPLIED; }).length;

  // "Stopped" = sequences that ended without a reply: manually Paused or
  // Bounced. Completed (ran the full sequence, no reply) is tracked
  // separately since it isn't really a "stop."
  var stopped = prospects.filter(function (p) {
    return p.Status === PROSPECT_STATUS.PAUSED || p.Status === PROSPECT_STATUS.BOUNCED;
  }).length;

  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter(function (c) { return c.Status === 'Active'; }).length,
    totalSenders: senders.length,
    totalProspects: prospects.length,
    emailsSentToday: emailsSentToday,
    pendingEmails: pending,
    replies: replies,
    stoppedFollowups: stopped,
    completed: prospects.filter(function (p) { return p.Status === PROSPECT_STATUS.COMPLETED; }).length,
    systemStatus: getSetting('SYSTEM_STATUS'),
    testMode: getSettingBool('TEST_MODE')
  };
}

function getSpreadsheetUrl() {
  return getSpreadsheet().getUrl();
}
