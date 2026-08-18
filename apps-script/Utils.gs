/**
 * Utils.gs
 * Generic, stateless helpers with no knowledge of specific sheet semantics
 * beyond "read/write rows by header name." Business logic lives in the
 * per-entity files (Senders.gs, Prospects.gs, etc.), not here.
 */

/**
 * Reads an entire sheet into an array of plain objects keyed by header row.
 */
function sheetToObjects(sheetName) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var obj = { _row: r + 1 }; // 1-indexed sheet row, for writes
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = data[r][c];
    }
    out.push(obj);
  }
  return out;
}

/**
 * Finds the row where idColumn === idValue and patches only the given
 * columns (by header name). No-op if the id isn't found.
 */
function updateRowByKey(sheetName, idColumn, idValue, updates) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx = headers.indexOf(idColumn);
  if (idIdx === -1) return false;

  for (var r = 1; r < data.length; r++) {
    if (data[r][idIdx] === idValue) {
      var rowNum = r + 1;
      for (var key in updates) {
        var colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          sheet.getRange(rowNum, colIdx + 1).setValue(updates[key]);
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Appends a row built from an object keyed by header name. Missing keys
 * become blank cells; the column order always follows COLUMNS[sheetKey].
 */
function appendRow(sheetName, rowObject) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return rowObject.hasOwnProperty(h) ? rowObject[h] : '';
  });
  sheet.appendRow(row);
}

/**
 * Replaces {{tag}} tokens with dataObject[tag]. Tokens with no matching key
 * are left as-is (a visible "{{unknown_tag}}" in a sent email is a far
 * easier bug to spot than silently blanked-out text).
 */
function mergeTags(template, dataObject) {
  if (!template) return '';
  return String(template).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, function (match, key) {
    return dataObject.hasOwnProperty(key) ? String(dataObject[key]) : match;
  });
}

/**
 * Builds the merge-tag data object for a prospect row (as returned by
 * sheetToObjects), converting header names to snake_case tag names.
 */
function buildMergeData(prospect) {
  return {
    first_name: prospect.FirstName || '',
    last_name: prospect.LastName || '',
    company: prospect.Company || '',
    email: prospect.Email || '',
    custom1: prospect.Custom1 || '',
    custom2: prospect.Custom2 || ''
  };
}

/**
 * Normalizes a send-window boundary to "HH:mm". If a cell typed as "09:00"
 * gets auto-converted by Sheets into its internal time-serial type, Apps
 * Script reads it back as a Date object whose UTC hour/minute directly ARE
 * the displayed wall-clock time (Sheets time-only serials are timezone-
 * agnostic elapsed-time values, epoch-dated 1899-12-30) -- so this must
 * read getUTCHours()/getUTCMinutes() directly and must NOT run the value
 * through a timezone conversion, which would shift it incorrectly.
 */
function normalizeTimeOfDay_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return ('0' + value.getUTCHours()).slice(-2) + ':' + ('0' + value.getUTCMinutes()).slice(-2);
  }
  // Zero-pad plain text too ("9:00" -> "09:00") -- the "HH:mm" comparison
  // in isWithinSendWindow is a plain string compare, and an unpadded
  // single-digit hour breaks lexicographic ordering (e.g. "14:32" sorts
  // before "9:00" as text even though 2:32pm is obviously later).
  var parts = String(value).trim().split(':');
  var hh = ('0' + (parseInt(parts[0], 10) || 0)).slice(-2);
  var mm = ('0' + (parseInt(parts[1], 10) || 0)).slice(-2);
  return hh + ':' + mm;
}

function isWithinSendWindow(startStr, endStr, tz) {
  if (!startStr || !endStr) return true;
  var now = Utilities.formatDate(new Date(), tz || getSetting('TIMEZONE'), 'HH:mm');
  var start = normalizeTimeOfDay_(startStr);
  var end = normalizeTimeOfDay_(endStr);
  return now >= start && now <= end;
}

/**
 * Adds `days` (fractional allowed, e.g. 1/24 for a 1-hour delay) to `date`.
 * Millisecond-based rather than setDate() so fractional values work --
 * setDate() truncates non-integers, which silently no-ops sub-day delays.
 */
function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Nudges `date` by a random +/- maxMinutes offset. Real people don't send
 * a follow-up at the exact same second every cycle -- a perfectly fixed
 * interval is itself a spam-filter signal, so scheduled send times get a
 * small human-like wobble instead of landing on the exact same time
 * every day.
 */
function addJitterMinutes_(date, maxMinutes) {
  var jitterMs = (Math.random() * 2 - 1) * maxMinutes * 60 * 1000;
  return new Date(date.getTime() + jitterMs);
}

/**
 * Initial-send scheduling for prospect N (0-indexed) within a batch added
 * together -- see BATCH_STAGGER_* in Config.gs. Position 0 sends
 * immediately (Status Pending, no NextSendDate needed); every later
 * position gets a Scheduled status with a NextSendDate staggered forward
 * so a batch of 20 doesn't fire in the same scheduler run.
 */
function computeInitialSchedule_(position) {
  var pos = Number(position) || 0;
  if (pos <= 0) {
    return { status: PROSPECT_STATUS.PENDING, nextSendDate: '' };
  }
  var offsetMinutes = pos * BATCH_STAGGER_AVG_MINUTES +
    (Math.random() * 2 - 1) * BATCH_STAGGER_JITTER_MINUTES;
  var nextSendDate = new Date(Date.now() + Math.max(1, offsetMinutes) * 60 * 1000);
  return { status: PROSPECT_STATUS.SCHEDULED, nextSendDate: nextSendDate };
}

function todayDateString(tz) {
  return Utilities.formatDate(new Date(), tz || getSetting('TIMEZONE'), 'yyyy-MM-dd');
}

function isNewDay(lastResetDateValue, tz) {
  if (!lastResetDateValue) return true;
  var last = (lastResetDateValue instanceof Date)
    ? Utilities.formatDate(lastResetDateValue, tz || getSetting('TIMEZONE'), 'yyyy-MM-dd')
    : String(lastResetDateValue);
  return last !== todayDateString(tz);
}

/**
 * Deletes every row in `sheetName` whose `idColumn` matches one of
 * `idValues` (a single value or array). Deletes bottom-up so earlier row
 * numbers found in the same pass stay valid. Used by deleteCampaign() to
 * cascade-remove a campaign's Prospects/Templates rows.
 */
function deleteRowsByKey(sheetName, idColumn, idValues) {
  var ids = Array.isArray(idValues) ? idValues : [idValues];
  if (ids.length === 0) return 0;
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx = headers.indexOf(idColumn);
  if (idIdx === -1) return 0;

  var rowsToDelete = [];
  for (var r = 1; r < data.length; r++) {
    if (ids.indexOf(data[r][idIdx]) !== -1) rowsToDelete.push(r + 1);
  }
  rowsToDelete.sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (rowNum) { sheet.deleteRow(rowNum); });
  return rowsToDelete.length;
}

function generateId(prefix) {
  return prefix + '-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
