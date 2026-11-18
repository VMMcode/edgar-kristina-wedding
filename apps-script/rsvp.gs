const SPREADSHEET_ID = "1_kVBTBfBFuk_qendHiQo2rgLVapM_-I37wH34t09rRg";
const SHEET_NAME = "Лист1";
const DEADLINE = Date.parse("2027-01-27T17:30:00+03:00");

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Пользовательский текст сохраняем как текст, включая строки, начинающиеся с формулы.
function cellText(value) {
  return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
}

function doPost(event) {
  try {
    const data = JSON.parse(event.postData.contents);
    if (Date.now() >= DEADLINE) return jsonResponse({ ok: false, code: "RSVP_CLOSED" });
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 160 ||
        typeof data.attending !== "boolean" ||
        (data.attending && (typeof data.companionNames !== "string" || data.companionNames.length > 1000 ||
          typeof data.hasChildren !== "boolean"))) {
      return jsonResponse({ ok: false, code: "INVALID_DATA" });
    }
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse({ ok: false, code: "SHEET_NOT_FOUND" });
    sheet.appendRow([
        new Date(), cellText(data.name.trim()), data.attending ? "Да" : "Нет",
        data.attending ? cellText(data.companionNames.trim()) : "",
        data.attending ? (data.hasChildren ? "Да" : "Нет") : "",
      ]);
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ ok: false, code: "SAVE_FAILED" });
  }
}
