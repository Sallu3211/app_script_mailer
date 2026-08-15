/**
 * Prospects.gs
 */

/**
 * Prospects due for their next touch in a given campaign, oldest-due first,
 * capped at `limit`. Only Pending/Scheduled are ever eligible — Paused,
 * Replied, Bounced and Completed are permanent/manual stops the scheduler
 * must never override.
 */
function getDueProspects(campaignId, limit) {
  var now = new Date();
  var all = sheetToObjects(SHEET_NAMES.PROSPECTS);

  var due = all.filter(function (p) {
    if (p.CampaignID !== campaignId) return false;
    if (PROSPECT_ACTIVE_STATUSES.indexOf(p.Status) === -1) return false;
    if (p.Status === PROSPECT_STATUS.PENDING) return true;
    if (!p.NextSendDate) return false;
    var nextSend = (p.NextSendDate instanceof Date) ? p.NextSendDate : new Date(p.NextSendDate);
    return nextSend.getTime() <= now.getTime();
  });

  due.sort(function (a, b) {
    var da = (a.Status === PROSPECT_STATUS.PENDING) ? 0 : new Date(a.NextSendDate).getTime();
    var db = (b.Status === PROSPECT_STATUS.PENDING) ? 0 : new Date(b.NextSendDate).getTime();
    return da - db;
  });

  return due.slice(0, limit);
}

/**
 * Called after a successful send. Advances CurrentStage, recomputes
 * NextSendDate from the next template's delay (or marks Completed if the
 * sequence is exhausted), and overwrites LastMessageId every time — initial
 * send and every follow-up — so the next follow-up always threads off the
 * most recently sent message.
 */
function updateProspectAfterSend(prospectId, sentStage, messageId) {
  var newCurrentStage = Number(sentStage) + 1;
  var next = computeNextSendDate(prospectId, newCurrentStage);

  var updates = {
    CurrentStage: newCurrentStage,
    LastSentDate: new Date(),
    LastMessageId: messageId || '',
    LastError: ''
  };

  if (next === null) {
    updates.Status = PROSPECT_STATUS.COMPLETED;
    updates.NextSendDate = '';
  } else {
    updates.Status = PROSPECT_STATUS.SCHEDULED;
    updates.NextSendDate = next;
  }

  updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospectId, updates);
}

/**
 * Given a prospect's CurrentStage (after the most recent send), returns the
 * Date the next template stage should go out, or null if the sequence is
 * exhausted (caller should mark the prospect Completed in that case).
 */
function computeNextSendDate(prospectId, currentStage) {
  var nextStage = getNextStage(prospectId, currentStage);
  if (nextStage === null) return null;
  var template = getTemplateForStage(prospectId, nextStage);
  var delayDays = parseFloat(template.DelayDaysFromPrevious) || 0;
  return addDays(new Date(), delayDays);
}

/**
 * Creates a new Prospect row plus one blank Template row per stage
 * (0 = Initial, 1..followupCount = Follow-up 1..N), pre-linked to the new
 * ProspectID so nothing needs to be manually copied/typed across rows.
 * `data`: {firstName, lastName, company, email, campaignId, custom1,
 * custom2, followupCount}. Returns {prospectId, stagesCreated}.
 */
function addProspectWithFollowups(data) {
  if (!data.email) throw new Error('Email is required');
  if (!data.campaignId) throw new Error('Campaign is required');

  var campaign = getCampaignById(data.campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + data.campaignId);

  var prospectId = generateId('PRO');
  appendRow(SHEET_NAMES.PROSPECTS, {
    ProspectID: prospectId,
    FirstName: data.firstName || '',
    LastName: data.lastName || '',
    Company: data.company || '',
    Email: normalizeEmail(data.email),
    CampaignID: campaign.CampaignID,
    SenderID: campaign.SenderID,
    Status: PROSPECT_STATUS.PENDING,
    CurrentStage: 0,
    LastSentDate: '',
    NextSendDate: '',
    LastMessageId: '',
    LastError: '',
    Custom1: data.custom1 || '',
    Custom2: data.custom2 || ''
  });

  var followupCount = Math.max(0, Math.min(MAX_FOLLOWUPS, parseInt(data.followupCount, 10) || 0));
  for (var stage = 0; stage <= followupCount; stage++) {
    appendRow(SHEET_NAMES.TEMPLATES, {
      TemplateID: generateId('TPL'),
      ProspectID: prospectId,
      Stage: stage,
      DelayDaysFromPrevious: stage === 0 ? 0 : '',
      Subject: '',
      Body: ''
    });
  }

  logSystemEvent(
    'Added prospect ' + prospectId + ' (' + data.email + ') with ' + (followupCount + 1) +
    ' blank template row(s) -- fill in Subject/Body/DelayDaysFromPrevious in the Templates tab',
    'Info'
  );

  return { prospectId: prospectId, stagesCreated: followupCount + 1 };
}

function markBounced(prospectId, errorMessage) {
  updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', prospectId, {
    Status: PROSPECT_STATUS.BOUNCED,
    LastError: errorMessage || ''
  });
}

/**
 * Called from Code.gs's doPost when the relay reports an inbound reply.
 * Idempotent: prospects already in a terminal state are left untouched, so
 * duplicate reports from overlapping IMAP poll windows are harmless.
 * Returns the array of matched prospect rows (empty array if none matched),
 * so the caller can log full reply details (name, campaign) even though
 * this function's own job is just the status flip.
 */
function markReplied(fromEmail, senderEmail) {
  var sender = getSenderByEmail(senderEmail);
  if (!sender) return [];

  var normFrom = normalizeEmail(fromEmail);
  var terminal = [PROSPECT_STATUS.REPLIED, PROSPECT_STATUS.BOUNCED, PROSPECT_STATUS.COMPLETED];
  var all = sheetToObjects(SHEET_NAMES.PROSPECTS);

  var match = all.filter(function (p) {
    return p.SenderID === sender.SenderID &&
      normalizeEmail(p.Email) === normFrom &&
      terminal.indexOf(p.Status) === -1;
  });

  match.forEach(function (p) {
    updateRowByKey(SHEET_NAMES.PROSPECTS, 'ProspectID', p.ProspectID, {
      Status: PROSPECT_STATUS.REPLIED
    });
  });
  return match;
}
