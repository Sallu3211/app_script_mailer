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

  var maxPerRun = parseInt(getSetting('MAX_EMAILS_PER_RUN'), 10) || 50;
  var sentThisRun = 0;

  var campaigns = getActiveCampaigns();

  for (var c = 0; c < campaigns.length; c++) {
    if (sentThisRun >= maxPerRun) break;

    var campaign = campaigns[c];
    var sender = getSenderById(campaign.SenderID);
    if (!sender || sender.Status !== 'Active') continue;

    sender = resetSenderDailyCounterIfNeeded(sender);
    campaign = resetCampaignDailyCounterIfNeeded(campaign);

    if (!isCampaignWithinSendWindow(campaign)) continue;

    var remaining = Math.min(
      campaignRemainingCapacity(campaign),
      senderRemainingCapacity(sender),
      maxPerRun - sentThisRun
    );
    if (remaining <= 0) continue;

    var due = getDueProspects(campaign.CampaignID, remaining);

    for (var i = 0; i < due.length; i++) {
      try {
        sentThisRun += processProspect_(due[i], campaign, sender) ? 1 : 0;
      } catch (err) {
        logSystemEvent('Unhandled error processing prospect ' + due[i].ProspectID + ': ' + err.message, 'Error');
      }
    }
  }
}

/**
 * Sends one prospect's next due email and updates all state. Wrapped by the
 * caller in try/catch so one bad prospect never aborts the batch. Returns
 * true if a send actually counted against daily quotas.
 */
function processProspect_(prospect, campaign, sender) {
  var stageToSend = Number(prospect.CurrentStage) || 0;
  var template = getTemplateForStage(campaign.CampaignID, stageToSend);

  if (!template) {
    // Sequence/template was edited out from under an in-flight prospect.
    updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospect.ProspectID, {
      Status: PROSPECT_STATUS.COMPLETED
    });
    logEmailAttempt({
      campaignId: campaign.CampaignID, senderId: sender.SenderID,
      prospectId: prospect.ProspectID, prospectEmail: prospect.Email,
      stage: stageToSend, subject: '', status: 'Info',
      errorMessage: 'No template for stage ' + stageToSend + '; marked Completed'
    });
    return false;
  }

  var payload = buildEmailPayload(sender, prospect, template);
  var result = sendEmailViaRelay(payload);

  if (result.success) {
    updateProspectAfterSend(prospect.ProspectID, campaign.CampaignID, stageToSend, result.messageId);
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
  }
  // Transient failure: prospect is left untouched (still Pending/Scheduled
  // with its existing NextSendDate), so the next scheduler run retries it.
  return false;
}
