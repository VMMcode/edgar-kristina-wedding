const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const handler = require("../api/rsvp.js");
const originalFetch = global.fetch;
const originalNow = Date.now;
const originalEnv = { url: process.env.GOOGLE_SCRIPT_URL, secret: process.env.RSVP_SECRET };
afterEach(() => {
  global.fetch = originalFetch;
  Date.now = originalNow;
  for (const [key, value] of [["GOOGLE_SCRIPT_URL", originalEnv.url], ["RSVP_SECRET", originalEnv.secret]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const valid = () => ({ requestId: "12345678-1234-4321-8123-123456789abc", name: " Иван Иванов ", attending: true, companionNames: " Мария Иванова ", hasChildren: false });
async function request(body = valid(), method = "POST") {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, body, headers: { "content-type": "application/json" } }, res);
  return res;
}
function configure() {
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
  process.env.RSVP_SECRET = "test-secret";
  Date.now = () => Date.parse("2026-11-19T12:00:00+03:00");
}
test("API: подтверждает только проверенный ответ записи", async () => {
  configure();
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.name, "Иван Иванов");
    assert.equal(body.secret, "test-secret");
    assert.equal(body.companionNames, "Мария Иванова");
    return { ok: true, json: async () => ({ ok: true, requestId: body.requestId }) };
  };
  const res = await request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});
test("API: отказ очищает зависимые ответы", async () => {
  configure();
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.companionNames, ""); assert.equal(body.hasChildren, null);
    return { ok: true, json: async () => ({ ok: true, requestId: body.requestId }) };
  };
  assert.equal((await request({ ...valid(), attending: false })).statusCode, 200);
});
test("API: невалидные поля не отправляются в таблицу", async () => {
  configure(); global.fetch = () => assert.fail("Unexpected network call");
  for (const data of [{ ...valid(), name: " " }, { ...valid(), name: "x".repeat(161) },
    { ...valid(), attending: "yes" }, { ...valid(), hasChildren: null },
    { ...valid(), companionNames: "x".repeat(1001) }, { ...valid(), requestId: "bad" }, "{bad", null]) {
    assert.equal((await request(data)).statusCode, 400);
  }
});
test("API: ошибка, HTML Google и чужой ID не дают ложный успех", async () => {
  configure();
  for (const reply of [{ ok: false }, { ok: true, requestId: "other" }]) {
    global.fetch = async () => ({ ok: true, json: async () => reply });
    assert.equal((await request()).statusCode, 502);
  }
  global.fetch = async () => ({ ok: true, json: async () => { throw Error("HTML instead of JSON"); } });
  assert.equal((await request()).statusCode, 502);
  global.fetch = async () => { throw Error("timeout"); };
  assert.equal((await request()).statusCode, 502);
});
test("API: метод, конфигурация и срок", async () => {
  configure();
  assert.equal((await request(valid(), "GET")).statusCode, 405);
  delete process.env.RSVP_SECRET;
  assert.equal((await request()).statusCode, 503);
  Date.now = () => Date.parse("2027-01-27T17:30:00+03:00");
  assert.equal((await request()).body.code, "RSVP_CLOSED");
});

function scriptContext() {
  const rows = [];
  let released = 0;
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange: () => ({ createTextFinder: id => ({ matchEntireCell: () => ({ findNext: () => rows.find(row => row[5] === id) }) }) }),
    appendRow: row => rows.push(row),
  };
  const context = vm.createContext({
    Date, JSON, PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "RSVP_SECRET" ? "test-secret" : "sheet-id" }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() { released++; } }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../apps-script/rsvp.gs"), "utf8"), context);
  return { rows, context, released: () => released, post: data => context.doPost({ postData: { contents: JSON.stringify(data) } }) };
}
test("Apps Script: запись, повтор без дубля и освобождение блокировки", () => {
  configure(); const script = scriptContext(); const data = { ...valid(), secret: "test-secret" };
  assert.equal(script.post(data).ok, true); assert.equal(script.post(data).ok, true);
  assert.equal(script.rows.length, 1); assert.equal(script.released(), 2);
  assert.equal(script.rows[0][1], "Иван Иванов"); assert.equal(script.rows[0][4], "Нет");
});
test("Apps Script: секрет и проверка данных", () => {
  configure(); const script = scriptContext();
  assert.equal(script.post(valid()).code, "UNAUTHORIZED");
  assert.equal(script.post({ ...valid(), secret: "test-secret", hasChildren: null }).code, "INVALID_DATA");
  assert.equal(script.rows.length, 0);
});
test("Apps Script: отказ и защита от формулы", () => {
  configure(); const script = scriptContext();
  assert.equal(script.post({ ...valid(), secret: "test-secret", name: "=IMPORTXML(1)", attending: false }).ok, true);
  assert.equal(script.rows[0][1], "'=IMPORTXML(1)"); assert.equal(script.rows[0][3], ""); assert.equal(script.rows[0][4], "");
});
test("Apps Script: закрытие точно по сроку", () => {
  configure(); const script = scriptContext(); Date.now = () => Date.parse("2027-01-27T14:30:00Z");
  assert.equal(script.post({ ...valid(), secret: "test-secret" }).code, "RSVP_CLOSED");
  assert.equal(script.rows.length, 0);
});
