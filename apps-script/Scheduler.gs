/**
 * Scheduler.gs
 * The trigger entry point (installed by Setup.gs to run every
 * SCHEDULER_INTERVAL_MINUTES). Orchestration only — all actual logic lives
 * in Senders.gs / Campaigns.gs / Prospects.gs / EmailSender.gs.
 */

function runScheduler() {
  if (getSetting('SYSTEM_STATUS') !== 'Active') {
    logSystemEvent('Scheduler skipped: SYSTEM_STATUS is not Active', 'Info');
    return;
  }

  // Defensive, cheap, idempotent -- self-heals LastResetDate cells on any
  // Sender/Campaign row appended since the last heal (appendRow doesn't
  // inherit the Plain Text formatting applied to earlier rows).
  fixLastResetDateColumnFormat_();
  ensureSenderGapColumn_();

  var maxPerRun = parseInt(getSetting('MAX_EMAILS_PER_RUN'), 10) || 50;
  var sentThisRun = 0;

  var campaigns = getActiveCampaigns();
  if (campaigns.length === 0) {
    logSystemEvent('Scheduler ran: no Active campaigns found', 'Info');
    return;
  }

  var anyProcessed = false;

  for (var c = 0; c < campaigns.length; c++) {
    if (sentThisRun >= maxPerRun) break;

    var campaign = campaigns[c];
    var sender = getSenderById(campaign.SenderID);

    if (!sender) {
      logSystemEvent('Campaign "' + campaign.Name + '" skipped: SenderID ' + campaign.SenderID + ' not found in Senders tab', 'Warn');
      continue;
    }
    if (sender.Status !== 'Active') {
      logSystemEvent('Campaign "' + campaign.Name + '" skipped: sender "' + sender.Name + '" is not Active', 'Warn');
      continue;
    }
    if (sender.NextAllowedSendAt && new Date(sender.NextAllowedSendAt).getTime() > Date.now()) {
      logSystemEvent('Campaign "' + campaign.Name + '" skipped: sender "' + sender.Name + '" is spacing sends, next allowed ' + new Date(sender.NextAllowedSendAt).toISOString(), 'Info');
      continue;
    }

    sender = resetSenderDailyCounterIfNeeded(sender);
    campaign = resetCampaignDailyCounterIfNeeded(campaign);

    if (!isCampaignWithinSendWindow(campaign)) {
      logSystemEvent(
        'Campaign "' + campaign.Name + '" skipped: outside send window (' +
        normalizeTimeOfDay_(campaign.SendWindowStart) + '-' + normalizeTimeOfDay_(campaign.SendWindowEnd) +
        ', timezone ' + getSetting('TIMEZONE') + ')',
        'Warn'
      );
      continue;
    }

    var remaining = Math.min(
      campaignRemainingCapacity(campaign),
      senderRemainingCapacity(sender),
      maxPerRun - sentThisRun
    );
    if (remaining <= 0) {
      logSystemEvent('Campaign "' + campaign.Name + '" skipped: no remaining daily capacity', 'Warn');
      continue;
    }

    var due = getDueProspects(campaign.CampaignID, remaining, MAX_INITIAL_SENDS_PER_CAMPAIGN_PER_RUN);
    if (due.length === 0) {
      logSystemEvent('Campaign "' + campaign.Name + '": no due prospects right now', 'Info');
      continue;
    }

    anyProcessed = true;
    for (var i = 0; i < due.length; i++) {
      try {
        var sent = processProspect_(due[i], campaign, sender);
        if (sent) {
          sentThisRun += 1;
          // One send opens this sender's spacing gate for a random 5-20min
          // window -- stop here for this run so the rest of `due` (and any
          // other Active campaign sharing this sender later in the `campaigns`
          // loop) waits for a future run instead of firing back-to-back.
          var nextAllowed = randomFutureTime_(SENDER_MIN_GAP_MINUTES, SENDER_MAX_GAP_MINUTES);
          updateRowByKey(SHEET_NAMES.SENDERS, 'SenderID', sender.SenderID, { NextAllowedSendAt: nextAllowed });
          sender.NextAllowedSendAt = nextAllowed;
          break;
        }
      } catch (err) {
        logSystemEvent('Unhandled error processing prospect ' + due[i].ProspectID + ': ' + err.message, 'Error');
      }
    }
  }

  if (!anyProcessed && sentThisRun === 0) {
    logSystemEvent('Scheduler ran: no sends this cycle (see per-campaign skip reasons above, if any)', 'Info');
  }
}

/**
 * Sends one prospect's next due email and updates all state. Wrapped by the
 * caller in try/catch so one bad prospect never aborts the batch. Returns
 * true if a send actually counted against daily quotas.
 */
function processProspect_(prospect, campaign, sender) {
  var stageToSend = Number(prospect.CurrentStage) || 0;
  var template = getTemplateForStage(prospect.ProspectID, stageToSend);

  if (!template) {
    // No (more) template rows for this specific prospect at this stage --
    // either their sequence is genuinely exhausted, or a template row was
    // never filled in / got edited out from under an in-flight prospect.
    updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospect.ProspectID, {
      Status: PROSPECT_STATUS.COMPLETED
    });
    logEmailAttempt({
      campaignId: campaign.CampaignID, senderId: sender.SenderID,
      prospectId: prospect.ProspectID, prospectEmail: prospect.Email,
      stage: stageToSend, subject: '', status: 'Info',
      errorMessage: 'No template for this prospect at stage ' + stageToSend + '; marked Completed'
    });
    return false;
  }

  var payload = buildEmailPayload(sender, prospect, template);
  var result = sendEmailViaRelay(payload);

  if (result.success) {
    updateProspectAfterSend(prospect.ProspectID, stageToSend, result.messageId);
    incrementSenderSentCount(sender.SenderID, parseInt(sender.SentToday, 10) || 0);
    incrementCampaignSentCount(campaign.CampaignID, parseInt(campaign.SentToday, 10) || 0);
    sender.SentToday = (parseInt(sender.SentToday, 10) || 0) + 1;
    campaign.SentToday = (parseInt(campaign.SentToday, 10) || 0) + 1;

    logEmailAttempt({
      campaignId: campaign.CampaignID, senderId: sender.SenderID,
      prospectId: prospect.ProspectID, prospectEmail: prospect.Email,
      stage: stageToSend, subject: payload.subject, status: 'Success',
      errorMessage: payload._testMode ? ('TEST MODE - real recipient: ' + payload._realRecipient) : '',
      messageId: result.messageId
    });
    return true;
  }

  logEmailAttempt({
    campaignId: campaign.CampaignID, senderId: sender.SenderID,
    prospectId: prospect.ProspectID, prospectEmail: prospect.Email,
    stage: stageToSend, subject: payload.subject, status: 'Failed',
    errorMessage: result.error
  });

  if (result.permanent) {
    markBounced(prospect.ProspectID, result.error);
  } else {
    // Transient failure: Status/NextSendDate are left untouched so the next
    // scheduler run retries it, but LastError is recorded so a prospect
    // stuck retrying the same failure is visible on the dashboard
    // drill-down, not just in the Logs tab. Cleared automatically on the
    // next successful send by updateProspectAfterSend.
    updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospect.ProspectID, {
      LastError: result.error || ''
    });
  }
  return false;
}
