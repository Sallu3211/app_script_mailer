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
 * Optional campaignId narrows this to one campaign (dashboard filter
 * dropdown); omit/'' for all campaigns.
 *
 * Unmatched inbound mail (not from any tracked prospect -- inbox noise,
 * mailbox-warmup pings, wrong-address typos, etc.) is intentionally
 * excluded here even though it's still recorded in the Replies tab itself
 * for audit purposes -- this view is specifically "who from my campaigns
 * replied," not a general inbox viewer.
 */
function getRecentReplies(limit, campaignId) {
  var replies = sheetToObjects(SHEET_NAMES.REPLIES).filter(function (r) {
    return r.Matched === 'Yes' && (!campaignId || r.CampaignID === campaignId);
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
      campaignId: r.CampaignID || '',
      campaignName: campaignNameById[r.CampaignID] || '',
      subject: r.Subject || '',
      bodyPreview: r.BodyPreview || '',
      matched: r.Matched === 'Yes'
    };
  });
}

/**
 * Campaign table for the dashboard -- backs the Pause/Play control and the
 * click-to-drill-down-into-prospects row, so day-to-day campaign control
 * never needs the Sheet.
 */
function getCampaignsList() {
  var campaigns = sheetToObjects(SHEET_NAMES.CAMPAIGNS);
  var senders = sheetToObjects(SHEET_NAMES.SENDERS);
  var prospects = sheetToObjects(SHEET_NAMES.PROSPECTS);

  var senderById = {};
  senders.forEach(function (s) { senderById[s.SenderID] = s; });

  var countByCampaign = {};
  prospects.forEach(function (p) {
    countByCampaign[p.CampaignID] = (countByCampaign[p.CampaignID] || 0) + 1;
  });

  return campaigns.map(function (c) {
    var sender = senderById[c.SenderID];
    return {
      campaignId: c.CampaignID,
      name: c.Name,
      senderId: c.SenderID,
      senderName: sender ? sender.Name : '(unknown sender)',
      senderEmail: sender ? sender.Email : '',
      senderStatus: sender ? sender.Status : 'Missing',
      status: c.Status,
      sentToday: isNewDay(c.LastResetDate) ? 0 : (parseInt(c.SentToday, 10) || 0),
      dailyLimit: parseInt(c.DailyLimit, 10) || 0,
      prospectCount: countByCampaign[c.CampaignID] || 0
    };
  });
}

/**
 * Sender list for the "Total Senders" tile's drill-down -- name, email,
 * status, and today's send count, without opening the Sheet.
 */
function getSendersList() {
  return sheetToObjects(SHEET_NAMES.SENDERS).map(function (s) {
    return {
      senderId: s.SenderID,
      name: s.Name,
      email: s.Email,
      status: s.Status,
      dailyLimit: parseInt(s.DailyLimit, 10) || 0,
      sentToday: isNewDay(s.LastResetDate) ? 0 : (parseInt(s.SentToday, 10) || 0)
    };
  });
}

/**
 * Successful sends from today (any campaign/sender), for the "Sent Today"
 * tile's drill-down. Newest first.
 */
function getTodaysSentLog() {
  var today = todayDateString();
  var campaigns = sheetToObjects(SHEET_NAMES.CAMPAIGNS);
  var campaignNameById = {};
  campaigns.forEach(function (c) { campaignNameById[c.CampaignID] = c.Name; });

  var rows = sheetToObjects(SHEET_NAMES.LOGS).filter(function (r) {
    if (r.Status !== 'Success') return false;
    var ts = r.Timestamp instanceof Date ? r.Timestamp : new Date(r.Timestamp);
    return Utilities.formatDate(ts, getSetting('TIMEZONE'), 'yyyy-MM-dd') === today;
  });

  rows.sort(function (a, b) { return new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime(); });

  return rows.map(function (r) {
    return {
      timestamp: r.Timestamp ? new Date(r.Timestamp).toISOString() : '',
      prospectEmail: r.ProspectEmail || '',
      campaignName: campaignNameById[r.CampaignID] || '',
      subject: r.Subject || '',
      stage: r.Stage
    };
  });
}

function prospectSummary_(p) {
  return {
    prospectId: p.ProspectID,
    name: ((p.FirstName || '') + ' ' + (p.LastName || '')).trim(),
    email: p.Email,
    company: p.Company || '',
    status: p.Status,
    stage: p.CurrentStage,
    nextSendDate: p.NextSendDate ? new Date(p.NextSendDate).toISOString() : '',
    lastError: p.LastError || ''
  };
}

/**
 * Prospect drill-down for one campaign -- click a campaign row on the
 * dashboard to see who's in it (status, stage, next send) without opening
 * the Sheet.
 */
function getProspectsForCampaign(campaignId) {
  return sheetToObjects(SHEET_NAMES.PROSPECTS)
    .filter(function (p) { return p.CampaignID === campaignId; })
    .map(prospectSummary_);
}

/**
 * Prospect drill-down by status -- backs clicking a stat tile (e.g.
 * "Replies" or "Completed") to see the actual list instead of just a
 * count. 'Pending' means the scheduler-active statuses (Pending +
 * Scheduled), matching the "Pending / Scheduled" tile; 'StoppedFollowups'
 * matches the "Paused / Bounced" tile. Optional campaignId narrows further.
 */
function getProspectsByStatus(statusGroup, campaignId) {
  return sheetToObjects(SHEET_NAMES.PROSPECTS)
    .filter(function (p) {
      if (campaignId && p.CampaignID !== campaignId) return false;
      if (statusGroup === 'All') return true;
      if (statusGroup === 'Pending') return PROSPECT_ACTIVE_STATUSES.indexOf(p.Status) !== -1;
      if (statusGroup === 'StoppedFollowups') return p.Status === PROSPECT_STATUS.PAUSED || p.Status === PROSPECT_STATUS.BOUNCED;
      return p.Status === statusGroup;
    })
    .map(prospectSummary_);
}
