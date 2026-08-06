/**
 * EmailSender.gs
 * The only file that talks to the relay service over HTTP. Scheduler.gs
 * never calls UrlFetchApp directly.
 */

/**
 * Builds the {senderEmail, to, subject, body, inReplyToMessageId, references,
 * prospectId} payload for one send. Applies TEST_MODE redirection: the
 * actual `to` becomes TEST_MODE_EMAIL_OVERRIDE, but subject/body are still
 * built from the real prospect's data and the prospect's real progression
 * is still advanced by the caller — this exercises the full pipeline
 * against a safe inbox before any real prospect is emailed.
 */
function buildEmailPayload(sender, prospect, template) {
  var mergeData = buildMergeData(prospect);
  var subject = mergeTags(template.Subject, mergeData);
  var body = mergeTags(template.Body, mergeData);

  var testMode = getSettingBool('TEST_MODE');
  var testOverride = getSetting('TEST_MODE_EMAIL_OVERRIDE');
  var realTo = normalizeEmail(prospect.Email);
  var to = (testMode && testOverride) ? testOverride : realTo;

  return {
    senderEmail: sender.Email,
    to: to,
    subject: subject,
    body: body,
    inReplyToMessageId: prospect.LastMessageId || '',
    references: prospect.LastMessageId || '',
    prospectId: prospect.ProspectID,
    _testMode: testMode && !!testOverride,
    _realRecipient: realTo
  };
}

/**
 * POSTs to the relay's /send endpoint. One retry on a transient failure
 * (network error or a 5xx-shaped relay response); permanent failures
 * (bad address, auth issue reported by the relay) are not retried here.
 *
 * Returns { success, messageId, permanent, error }.
 */
function sendEmailViaRelay(payload) {
  var result = _callRelaySend(payload);
  if (!result.success && !result.permanent && result.transient) {
    Utilities.sleep(2000);
    result = _callRelaySend(payload);
  }
  return result;
}

function _callRelaySend(payload) {
  var baseUrl = getSetting('RELAY_BASE_URL');
  var secret = getSetting('RELAY_SHARED_SECRET');

  if (!baseUrl) {
    return { success: false, permanent: false, transient: true, error: 'RELAY_BASE_URL not configured' };
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Relay-Secret': secret },
    payload: JSON.stringify({
      senderEmail: payload.senderEmail,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      inReplyToMessageId: payload.inReplyToMessageId,
      references: payload.references,
      prospectId: payload.prospectId
    }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(baseUrl.replace(/\/$/, '') + '/send', options);
    var code = response.getResponseCode();
    var body;
    try {
      body = JSON.parse(response.getContentText());
    } catch (parseErr) {
      return { success: false, permanent: false, transient: true, error: 'Non-JSON relay response (HTTP ' + code + ')' };
    }

    if (body.success) {
      return { success: true, messageId: body.messageId || '' };
    }

    var permanent = body.permanent === true || body.code === 'INVALID_RECIPIENT';
    return {
      success: false,
      permanent: permanent,
      transient: !permanent,
      error: body.error || ('Relay error (' + (body.code || 'UNKNOWN') + ')')
    };
  } catch (e) {
    return { success: false, permanent: false, transient: true, error: 'Relay unreachable: ' + e.message };
  }
}
