/**
 * Senders.gs
 */

function getActiveSenders() {
  return sheetToObjects(SHEET_NAMES.SENDERS).filter(function (s) {
    return s.Status === 'Active';
  });
}

function getSenderById(id) {
  var rows = sheetToObjects(SHEET_NAMES.SENDERS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].SenderID === id) return rows[i];
  }
  return null;
}

function getSenderByEmail(email) {
  var norm = normalizeEmail(email);
  var rows = sheetToObjects(SHEET_NAMES.SENDERS);
  for (var i = 0; i < rows.length; i++) {
    if (normalizeEmail(rows[i].Email) === norm) return rows[i];
  }
  return null;
}

/**
 * Resets SentToday to 0 if LastResetDate isn't today. Returns the
 * (possibly updated) sender row.
 */
function resetSenderDailyCounterIfNeeded(sender) {
  if (isNewDay(sender.LastResetDate)) {
    updateRowByKey(SHEET_NAMES.SENDERS, 'SenderID', sender.SenderID, {
      SentToday: 0,
      LastResetDate: todayDateString()
    });
    sender.SentToday = 0;
    sender.LastResetDate = todayDateString();
  }
  return sender;
}

function incrementSenderSentCount(senderId, currentSentToday) {
  updateRowByKey(SHEET_NAMES.SENDERS, 'SenderID', senderId, {
    SentToday: currentSentToday + 1
  });
}

function senderRemainingCapacity(sender) {
  var limit = parseInt(sender.DailyLimit, 10) || 0;
  var sent = parseInt(sender.SentToday, 10) || 0;
  return Math.max(0, limit - sent);
}
