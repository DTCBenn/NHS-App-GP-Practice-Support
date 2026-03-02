export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      res.status(400).json({ error: "Missing message" });
      return;
    }

    // Basic PII guardrail (keep it simple, but effective)
    if (looksLikePatientData(message)) {
      res.status(400).json({
        error:
          "That looks like it may include patient-identifiable information. Please remove NHS numbers, DOB, names, addresses, postcodes, screenshots, then try again with a general description."
      });
      return;
    }

    const systemPrompt =
      "You support GP practice staff with NON-CLINICAL NHS App queries only. " +
      "Never request or accept patient-identifiable information. " +
      "If identifiers appear, refuse and ask for a general description. " +
      "Structure answers as: What this usually means, Practice checks, Patient steps, Escalation route. " +
      "Keep it practical and short.";

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        store: false
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: "OpenAI upstream error", detail });
      return;
    }

    const data = await r.json();

    const reply =
      data.output_text ||
      extractOutputText(data) ||
      "No reply returned.";

    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
}

function looksLikePatientData(text) {
  const t = text.toLowerCase();

  const nhsNumber = /\b\d{10}\b/; // 10 digits
  const dob = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/; // dd/mm/yyyy
  const postcode = /\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b/i;
  const addressWords = /\b(address|postcode|house\s*number|flat|street|road|avenue)\b/i;

  return nhsNumber.test(text) || dob.test(text) || postcode.test(text) || addressWords.test(t);
}

function extractOutputText(data) {
  const out = data.output || [];
  const msgItem = out.find((i) => i.type === "message");
  if (!msgItem?.content) return "";
  return msgItem.content
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}
