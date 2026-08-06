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

function isWithinSendWindow(startStr, endStr, tz) {
  if (!startStr || !endStr) return true;
  var now = Utilities.formatDate(new Date(), tz || getSetting('TIMEZONE'), 'HH:mm');
  return now >= startStr && now <= endStr;
}

function addDays(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
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

function generateId(prefix) {
  return prefix + '-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
