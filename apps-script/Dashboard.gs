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

  // SentToday only actually resets when the scheduler processes that
  // campaign (see resetCampaignDailyCounterIfNeeded) -- a Paused campaign
  // is never processed, so its counter can sit frozen on a prior day's
  // total. Treat a stale (not-actually-today) count as 0 for display so
  // this tile never shows yesterday's number as if it were today's.
  var emailsSentToday = campaigns.reduce(function (sum, c) {
    return sum + (isNewDay(c.LastResetDate) ? 0 : (parseInt(c.SentToday, 10) || 0));
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

/**
 * Most recent replies from actual known prospects, newest first. Used by
 * the dashboard's "Recent Replies" panel so you can see who replied and
 * what they said without opening the Sheet or any individual Titan mailbox.
 *
 * Unmatched inbound mail (not from any tracked prospect -- inbox noise,
 * mailbox-warmup pings, wrong-address typos, etc.) is intentionally
 * excluded here even though it's still recorded in the Replies tab itself
 * for audit purposes -- this view is specifically "who from my campaigns
 * replied," not a general inbox viewer.
 */
function getRecentReplies(limit) {
  var replies = sheetToObjects(SHEET_NAMES.REPLIES).filter(function (r) {
    return r.Matched === 'Yes';
  });
  var campaigns = sheetToObjects(SHEET_NAMES.CAMPAIGNS);
  var campaignNameById = {};
  campaigns.forEach(function (c) { campaignNameById[c.CampaignID] = c.Name; });

  replies.sort(function (a, b) {
    return new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime();
  });

  return replies.slice(0, limit || 25).map(function (r) {
    return {
      timestamp: r.Timestamp ? new Date(r.Timestamp).toISOString() : '',
      senderEmail: r.SenderEmail || '',
      prospectName: (r.ProspectName || '').trim(),
      prospectEmail: r.ProspectEmail || '',
      campaignName: campaignNameById[r.CampaignID] || '',
      subject: r.Subject || '',
      bodyPreview: r.BodyPreview || '',
      matched: r.Matched === 'Yes'
    };
  });
}
