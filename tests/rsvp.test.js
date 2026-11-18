const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const handler = require("../api/rsvp.js");
const originalFetch = global.fetch;
const originalNow = Date.now;
const originalEnv = { url: process.env.GOOGLE_SCRIPT_URL };
afterEach(() => {
  global.fetch = originalFetch;
  Date.now = originalNow;
  for (const [key, value] of [["GOOGLE_SCRIPT_URL", originalEnv.url]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const valid = () => ({ name: " Иван Иванов ", attending: true, companionNames: " Мария Иванова ", hasChildren: false });
async function request(body = valid(), method = "POST") {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, body, headers: { "content-type": "application/json" } }, res);
  return res;
}
function configure() {
  process.env.GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
  Date.now = () => Date.parse("2026-11-19T12:00:00+03:00");
}
test("API: подтверждает только проверенный ответ записи", async () => {
  configure();
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.name, "Иван Иванов");
    assert.equal(body.companionNames, "Мария Иванова");
    return { ok: true, json: async () => ({ ok: true }) };
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
    return { ok: true, json: async () => ({ ok: true }) };
  };
  assert.equal((await request({ ...valid(), attending: false })).statusCode, 200);
});
test("API: невалидные поля не отправляются в таблицу", async () => {
  configure(); global.fetch = () => assert.fail("Unexpected network call");
  for (const data of [{ ...valid(), name: " " }, { ...valid(), name: "x".repeat(161) },
    { ...valid(), attending: "yes" }, { ...valid(), hasChildren: null },
    { ...valid(), companionNames: "x".repeat(1001) }, "{bad", null]) {
    assert.equal((await request(data)).statusCode, 400);
  }
});
test("API: ошибка и HTML Google не дают ложный успех", async () => {
  configure();
  for (const reply of [{ ok: false }, {}]) {
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
  delete process.env.GOOGLE_SCRIPT_URL;
  assert.equal((await request()).statusCode, 503);
  Date.now = () => Date.parse("2027-01-27T17:30:00+03:00");
  assert.equal((await request()).body.code, "RSVP_CLOSED");
});

function scriptContext({ missingSheet = false, failWrite = false } = {}) {
  const rows = [];
  const sheet = { appendRow(row) { if (failWrite) throw Error("write failed"); rows.push(row); } };
  const context = vm.createContext({
    Date, JSON,
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, "1_kVBTBfBFuk_qendHiQo2rgLVapM_-I37wH34t09rRg");
        return { getSheetByName(name) { assert.equal(name, "Лист1"); return missingSheet ? null : sheet; } };
      },
      flush() {},
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../apps-script/rsvp.gs"), "utf8"), context);
  return { rows, context, post: data => context.doPost({ postData: { contents: JSON.stringify(data) } }) };
}
test("Apps Script: пять полей в существующий Лист1 нужной таблицы", () => {
  configure(); const script = scriptContext();
  assert.equal(script.post(valid()).ok, true);
  assert.equal(script.rows.length, 1); assert.equal(script.rows[0].length, 5);
  assert.equal(script.rows[0][1], "Иван Иванов"); assert.equal(script.rows[0][2], "Да");
  assert.equal(script.rows[0][3], "Мария Иванова"); assert.equal(script.rows[0][4], "Нет");
});
test("Apps Script: проверка данных", () => {
  configure(); const script = scriptContext();
  assert.equal(script.post({ ...valid(), hasChildren: null }).code, "INVALID_DATA");
  assert.equal(script.rows.length, 0);
});
test("Apps Script: отказ и защита от формулы", () => {
  configure(); const script = scriptContext();
  assert.equal(script.post({ ...valid(), name: "=IMPORTXML(1)", attending: false }).ok, true);
  assert.equal(script.rows[0][1], "'=IMPORTXML(1)"); assert.equal(script.rows[0][3], ""); assert.equal(script.rows[0][4], "");
});
test("Apps Script: закрытие точно по сроку", () => {
  configure(); const script = scriptContext(); Date.now = () => Date.parse("2027-01-27T14:30:00Z");
  assert.equal(script.post(valid()).code, "RSVP_CLOSED"); assert.equal(script.rows.length, 0);
});
test("Apps Script: отсутствующий лист и ошибка записи не дают успех", () => {
  configure();
  assert.equal(scriptContext({ missingSheet: true }).post(valid()).code, "SHEET_NOT_FOUND");
  assert.equal(scriptContext({ failWrite: true }).post(valid()).code, "SAVE_FAILED");
});
