const DEADLINE = Date.parse("2027-01-27T17:30:00+03:00");

/* ===== Запись анкеты через Google Apps Script ===== */
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  if (Date.now() >= DEADLINE) return res.status(403).json({ ok: false, code: "RSVP_CLOSED" });
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    return res.status(415).json({ ok: false, code: "INVALID_CONTENT_TYPE" });
  }

  let data;
  try {
    data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, code: "INVALID_DATA" });
  }
  if (!data || typeof data.name !== "string" || !data.name.trim() || data.name.length > 160 ||
      typeof data.attending !== "boolean" ||
      (data.attending && (typeof data.companionNames !== "string" || data.companionNames.length > 1000 ||
        typeof data.hasChildren !== "boolean"))) {
    return res.status(400).json({ ok: false, code: "INVALID_DATA" });
  }

  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(scriptUrl)) {
    return res.status(503).json({ ok: false, code: "NOT_CONFIGURED" });
  }
  const payload = {
    name: data.name.trim(),
    attending: data.attending,
    companionNames: data.attending ? data.companionNames.trim() : "",
    hasChildren: data.attending ? data.hasChildren : null,
  };
  try {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    const result = await response.json();
    if (response.ok && result.code === "RSVP_CLOSED") {
      return res.status(403).json({ ok: false, code: "RSVP_CLOSED" });
    }
    if (!response.ok || result.ok !== true) {
      return res.status(502).json({ ok: false, code: "SAVE_FAILED" });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ ok: false, code: "SAVE_FAILED" });
  }
};
