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
    .addSeparator()
    .addItem('Reinstall Trigger', 'installTriggers')
    .addToUi();
}

function showDashboardDialog_() {
  var html = HtmlService.createTemplateFromFile('dashboard').evaluate().setWidth(700).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Cold Email Dashboard');
}

function doGet(e) {
  return renderDashboard();
}

/**
 * Called by the relay service when its IMAP poller finds a new inbound
 * message. Body: { secret, senderEmail, fromEmail, subject, receivedAt }.
 * Apps Script Web Apps always return HTTP 200 regardless of outcome, so the
 * caller must check body.success, not the status code.
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

    var matched = markReplied(body.fromEmail, body.senderEmail);

    logSystemEvent(
      'Reply report: from=' + body.fromEmail + ' sender=' + body.senderEmail +
      ' subject="' + (body.subject || '') + '" matched=' + matched,
      'Info'
    );

    response.success = true;
    response.matched = matched;
  } catch (err) {
    response.error = err.message;
    logSystemEvent('doPost error: ' + err.message, 'Error');
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
