// Azure Functions (Node.js) HTTP trigger
// Set environment variables in Azure:
// - AI_API_KEY
// - AI_API_URL  (your provider endpoint)
// - AI_MODEL    (optional, provider-specific)

const crypto = require("crypto");

const memoryRate = new Map(); // in-memory rate limit (resets on cold start)

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 30;

  const entry = memoryRate.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  memoryRate.set(ip, entry);

  return entry.count <= limit;
}

function looksLikePatientData(text) {
  const t = text.toLowerCase();
  const nhsNumber = /\b\d{10}\b/;
  const dob1 = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/;
  const postcode = /\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b/i;
  const addressWords = /\b(address|postcode|house\s*number|flat|street|road|avenue)\b/i;
  const nameHint = /\b(mr|mrs|miss|ms|dr)\b/i;

  return (
    nhsNumber.test(text) ||
    dob1.test(text) ||
    postcode.test(text) ||
    addressWords.test(t) ||
    nameHint.test(t)
  );
}

module.exports = async function (context, req) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    "unknown";

  if (!rateLimit(ip)) {
    context.res = { status: 429, body: { error: "Rate limit exceeded. Try again shortly." } };
    return;
  }

  const message = (req.body && req.body.message) ? String(req.body.message) : "";
  if (!message.trim()) {
    context.res = { status: 400, body: { error: "Missing 'message'." } };
    return;
  }

  if (looksLikePatientData(message)) {
    context.res = {
      status: 400,
      body: {
        error:
          "Message appears to include patient-identifiable information. Remove NHS numbers, DOB, names, addresses, postcodes, screenshots, and try again with a general description."
      }
    };
    return;
  }

  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL;

  if (!apiKey || !apiUrl) {
    context.res = { status: 500, body: { error: "AI service not configured." } };
    return;
  }

  const systemPrompt =
    "You are an assistant for GP practice staff answering NON-CLINICAL NHS App support queries. " +
    "Never request or accept patient-identifiable information. " +
    "If the user includes anything identifiable, refuse and ask them to remove it. " +
    "Structure answers as: What this usually means, Practice checks, Patient steps, Escalation route. " +
    "Keep it practical and short.";

  // Provider-agnostic-ish payload (you may need to adjust to your AI provider)
  const payload = {
    model: process.env.AI_MODEL || "default",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ],
    temperature: 0.2
  };

  try {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const t = await r.text();
      context.res = { status: 502, body: { error: "AI upstream error", detail: t } };
      return;
    }

    const data = await r.json();

    // Adjust extraction to match your provider response shape
    const reply =
      data.reply ||
      data.output ||
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      "No reply.";

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" // public site access
      },
      body: { reply }
    };
  } catch (e) {
    context.res = { status: 500, body: { error: "Proxy error", detail: String(e) } };
  }
};
