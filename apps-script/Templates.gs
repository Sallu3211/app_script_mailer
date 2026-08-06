/**
 * Templates.gs
 *
 * Stage numbering convention (shared with Prospects.CurrentStage):
 *   Templates.Stage    0 = Initial email, 1..10 = Follow-up 1..10
 *   Prospects.CurrentStage = "how many stages have been sent so far"
 *     0  -> nothing sent yet; next template stage to send is 0 (Initial)
 *     1  -> Initial sent;      next template stage to send is 1 (FU1)
 *     11 -> FU10 sent (all 11 stages exhausted); no template at stage 11 -> Completed
 *
 * So "next template stage to send" is always just equal to CurrentStage.
 */

function getTemplatesForCampaign(campaignId) {
  return sheetToObjects(SHEET_NAMES.TEMPLATES)
    .filter(function (t) { return t.CampaignID === campaignId; })
    .sort(function (a, b) { return Number(a.Stage) - Number(b.Stage); });
}

function getTemplateForStage(campaignId, stage) {
  var templates = getTemplatesForCampaign(campaignId);
  for (var i = 0; i < templates.length; i++) {
    if (Number(templates[i].Stage) === Number(stage)) return templates[i];
  }
  return null;
}

/**
 * Returns the template stage number to send next for a prospect currently
 * at currentStage, or null if the sequence is exhausted (no template at
 * that stage, or MAX_FOLLOWUPS has been reached).
 */
function getNextStage(campaignId, currentStage) {
  var nextStage = Number(currentStage) || 0;
  if (nextStage > MAX_FOLLOWUPS) return null;
  var template = getTemplateForStage(campaignId, nextStage);
  return template ? nextStage : null;
}
