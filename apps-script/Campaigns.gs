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
