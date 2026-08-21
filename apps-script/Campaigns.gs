/**
 * Campaigns.gs
 */

function getActiveCampaigns() {
  return sheetToObjects(SHEET_NAMES.CAMPAIGNS).filter(function (c) {
    return c.Status === 'Active';
  });
}

function getCampaignById(id) {
  var rows = sheetToObjects(SHEET_NAMES.CAMPAIGNS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].CampaignID === id) return rows[i];
  }
  return null;
}

function resetCampaignDailyCounterIfNeeded(campaign) {
  if (isNewDay(campaign.LastResetDate)) {
    updateRowByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaign.CampaignID, {
      SentToday: 0,
      LastResetDate: todayDateString()
    });
    campaign.SentToday = 0;
    campaign.LastResetDate = todayDateString();
  }
  return campaign;
}

function incrementCampaignSentCount(campaignId, currentSentToday) {
  updateRowByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaignId, {
    SentToday: currentSentToday + 1
  });
}

function campaignRemainingCapacity(campaign) {
  var limit = parseInt(campaign.DailyLimit, 10) || 0;
  var sent = parseInt(campaign.SentToday, 10) || 0;
  return Math.max(0, limit - sent);
}

function isCampaignWithinSendWindow(campaign) {
  return isWithinSendWindow(campaign.SendWindowStart, campaign.SendWindowEnd);
}

var CAMPAIGN_TOGGLABLE_STATUSES_ = ['Active', 'Paused'];

/**
 * Flips a campaign between Active/Paused from the dashboard UI, so Pause/
 * Play never requires opening the Sheet. Only Active/Paused are valid
 * targets here -- there's no third state a dashboard button should ever
 * set.
 */
function setCampaignStatus(campaignId, status) {
  if (CAMPAIGN_TOGGLABLE_STATUSES_.indexOf(status) === -1) {
    throw new Error('Invalid status: ' + status);
  }
  var campaign = getCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + campaignId);

  updateRowByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaignId, { Status: status });
  logSystemEvent('Campaign ' + campaignId + ' (' + campaign.Name + ') set to ' + status + ' from dashboard', 'Info');
  return { campaignId: campaignId, status: status };
}

/**
 * Deletes a campaign and cascades to its Prospects and their Templates
 * rows -- a campaign made through the dashboard/wizard by mistake (or a
 * finished test campaign) shouldn't need manual cleanup across three
 * sheets. Logs/Replies history is left intact for audit even though it now
 * references a deleted CampaignID, same as how unmatched replies are kept.
 */
function deleteCampaign(campaignId) {
  var campaign = getCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + campaignId);

  var prospectIds = sheetToObjects(SHEET_NAMES.PROSPECTS)
    .filter(function (p) { return p.CampaignID === campaignId; })
    .map(function (p) { return p.ProspectID; });

  if (prospectIds.length > 0) {
    deleteRowsByKey(SHEET_NAMES.TEMPLATES, 'ProspectID', prospectIds);
    deleteRowsByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospectIds);
  }
  deleteRowsByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaignId);

  logSystemEvent('Campaign ' + campaignId + ' (' + campaign.Name + ') deleted from dashboard, along with ' + prospectIds.length + ' prospect(s)', 'Info');
  return { deleted: true, prospectsDeleted: prospectIds.length };
}

/**
 * Points a campaign at a different sender -- the fix for a campaign stuck
 * because its SenderID was deleted, or points at a sender that's still
 * Pending. Doesn't touch the campaign's Status or any prospect rows; a
 * Paused campaign stays Paused until explicitly started.
 */
function reassignCampaignSender(campaignId, newSenderId) {
  var campaign = getCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + campaignId);
  var sender = getSenderById(newSenderId);
  if (!sender) throw new Error('Sender not found: ' + newSenderId);

  updateRowByKey(SHEET_NAMES.CAMPAIGNS, 'CampaignID', campaignId, { SenderID: newSenderId });
  logSystemEvent('Campaign ' + campaignId + ' (' + campaign.Name + ') reassigned from sender ' +
    campaign.SenderID + ' to ' + newSenderId + ' (' + sender.Name + ') from dashboard', 'Info');
  return { campaignId: campaignId, senderId: newSenderId, senderStatus: sender.Status };
}

/**
 * All campaigns (not just Active ones -- you may want to add a prospect to
 * a Paused campaign before flipping it live), with the sender's name
 * resolved for display. Used to populate the Add Prospect form's dropdown.
 */
function getCampaignsForDropdown() {
  var senders = sheetToObjects(SHEET_NAMES.SENDERS);
  var senderNameById = {};
  senders.forEach(function (s) { senderNameById[s.SenderID] = s.Name; });

  return sheetToObjects(SHEET_NAMES.CAMPAIGNS).map(function (c) {
    return {
      campaignId: c.CampaignID,
      name: c.Name,
      senderName: senderNameById[c.SenderID] || '(unknown sender)'
    };
  });
}
