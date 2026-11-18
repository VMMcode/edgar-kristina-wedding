const SHEET_NAME = "Ответы гостей";
const DEADLINE = Date.parse("2027-01-27T17:30:00+03:00");
const HEADERS = ["Дата ответа", "Имя и фамилия", "Присутствие", "Сопровождающие взрослые", "Будут дети", "ID ответа"];

/* ===== Запустить один раз из редактора привязанной к таблице программы ===== */
function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Откройте Apps Script из нужной Google Таблицы.");
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());
  if (!properties.getProperty("RSVP_SECRET")) throw new Error("Добавьте RSVP_SECRET в свойства скрипта.");
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#e8ded4");
    sheet.setFrozenRows(1);
    sheet.getRange("A:A").setNumberFormat("dd.MM.yyyy HH:mm:ss");
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidths(2, 4, 220);
    sheet.hideColumns(6);
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Пользовательский текст сохраняем как текст, включая строки, начинающиеся с формулы.
function cellText(value) {
  return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
}

function doPost(event) {
  let lock;
  try {
    const data = JSON.parse(event.postData.contents);
    const properties = PropertiesService.getScriptProperties();
    const secret = properties.getProperty("RSVP_SECRET");
    if (!secret || data.secret !== secret) return jsonResponse({ ok: false, code: "UNAUTHORIZED" });
    if (Date.now() >= DEADLINE) return jsonResponse({ ok: false, code: "RSVP_CLOSED" });
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 160 ||
        typeof data.attending !== "boolean" || typeof data.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId) ||
        (data.attending && (typeof data.companionNames !== "string" || data.companionNames.length > 1000 ||
          typeof data.hasChildren !== "boolean"))) {
      return jsonResponse({ ok: false, code: "INVALID_DATA" });
    }
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
    const sheet = SpreadsheetApp.openById(properties.getProperty("SPREADSHEET_ID")).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error("Сначала запустите setup.");
    // При потере ответа сервера повторная попытка не создаёт вторую строку.
    const rows = sheet.getLastRow();
    const duplicate = rows > 1 && sheet.getRange(2, 6, rows - 1, 1)
      .createTextFinder(data.requestId).matchEntireCell(true).findNext();
    if (!duplicate) {
      sheet.appendRow([
        new Date(), cellText(data.name.trim()), data.attending ? "Да" : "Нет",
        data.attending ? cellText(data.companionNames.trim()) : "",
        data.attending ? (data.hasChildren ? "Да" : "Нет") : "",
        data.requestId,
      ]);
      SpreadsheetApp.flush();
    }
    return jsonResponse({ ok: true, requestId: data.requestId });
  } catch {
    return jsonResponse({ ok: false, code: "SAVE_FAILED" });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}
