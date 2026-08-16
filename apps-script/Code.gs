/**
 * Code.gs
 * Entry points only: menu wiring, doGet (dashboard), doPost (relay callback).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cold Email')
    .addItem('Setup System', 'setupSystem')
    .addItem('Run Scheduler Now', 'runScheduler')
    .addItem('Open Dashboard', 'showDashboardDialog_')
    .addItem('Add New Prospect', 'showAddProspectDialog_')
    .addItem('Add Campaign (Wizard)', 'showCampaignWizardDialog_')
    .addSeparator()
    .addItem('Reinstall Trigger', 'installTriggers')
    .addToUi();
}

function showDashboardDialog_() {
  var html = HtmlService.createTemplateFromFile('dashboard').evaluate().setWidth(700).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Cold Email Dashboard');
}

function showAddProspectDialog_() {
  var html = HtmlService.createTemplateFromFile('addProspect').evaluate().setWidth(480).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add New Prospect');
}

function showCampaignWizardDialog_() {
  var html = HtmlService.createTemplateFromFile('campaignWizard').evaluate().setWidth(720).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Campaign');
}

/**
 * Public Web App URL, with ?page=wizard, for the "+ Add Campaign" link on
 * the dashboard -- works the same whether the dashboard is opened from the
 * Sheet menu or via the public /exec URL directly.
 */
function getWizardUrl() {
  return ScriptApp.getService().getUrl() + '?page=wizard';
}

function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'wizard') {
    return HtmlService.createTemplateFromFile('campaignWizard')
      .evaluate()
      .setTitle('Add Campaign')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return renderDashboard();
}

/**
 * Called by the relay service when its IMAP poller finds a new inbound
 * message. Body: { secret, senderEmail, fromEmail, subject, receivedAt,
 * bodyPreview }. Apps Script Web Apps always return HTTP 200 regardless of
 * outcome, so the caller must check body.success, not the status code.
 */
function doPost(e) {
  var response = { success: false };
  try {
    var body = JSON.parse(e.postData.contents);

    if (!body.secret || body.secret !== getSetting('RELAY_SHARED_SECRET')) {
      response.error = 'Invalid secret';
      return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
    }

    if (!body.senderEmail || !body.fromEmail) {
      response.error = 'Missing senderEmail or fromEmail';
      return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
    }

    var matchedProspects = markReplied(body.fromEmail, body.senderEmail);
    var isMatched = matchedProspects.length > 0;

    // The status flip above already happened -- that's the part that must
    // never be lost. Logging to the Replies tab is secondary, so a failure
    // there (e.g. the tab doesn't exist yet) must not turn this response
    // into a failure and trigger pointless retries of an already-applied change.
    try {
      if (isMatched) {
        matchedProspects.forEach(function (p) {
          logReply({
            senderEmail: body.senderEmail,
            prospectId: p.ProspectID,
            prospectName: (p.FirstName || '') + ' ' + (p.LastName || ''),
            fromEmail: body.fromEmail,
            campaignId: p.CampaignID,
            subject: body.subject,
            bodyPreview: body.bodyPreview,
            matched: true
          });
        });
      } else {
        // Still log unmatched inbound mail so it's visible in the Replies tab
        // (e.g. helps catch a typo'd prospect email, or just shows inbox noise).
        logReply({
          senderEmail: body.senderEmail,
          fromEmail: body.fromEmail,
          subject: body.subject,
          bodyPreview: body.bodyPreview,
          matched: false
        });
      }
    } catch (logErr) {
      logSystemEvent('logReply failed (Replies tab missing? Run Setup System): ' + logErr.message, 'Error');
    }

    response.success = true;
    response.matched = isMatched;
  } catch (err) {
    response.error = err.message;
    logSystemEvent('doPost error: ' + err.message, 'Error');
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
