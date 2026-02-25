const chatlog = document.getElementById("chatlog");
const msg = document.getElementById("msg");
const sendBtn = document.getElementById("send");
const chips = document.getElementById("chips");

// Put your Azure Function HTTPS endpoint here
const API_URL = "YOUR_AZURE_FUNCTION_URL";

function addBubble(text, who) {
  const div = document.createElement("div");
  div.className = `bubble ${who}`;
  div.textContent = text;
  chatlog.appendChild(div);
  chatlog.scrollTop = chatlog.scrollHeight;
}

function looksLikePatientData(text) {
  const t = text.toLowerCase();

  // Common risky patterns (not perfect, but a strong first barrier)
  const nhsNumber = /\b\d{10}\b/;                  // 10 digits
  const dob1 = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/;  // dd/mm/yyyy
  const postcode = /\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b/i; // UK postcode-ish
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

async function askBot(question) {
  const q = question.trim();
  if (!q) return;

  if (looksLikePatientData(q)) {
    addBubble(q, "me");
    addBubble(
      "I can’t help with that as it looks like it may include patient-identifiable information.\n\nPlease remove NHS numbers, dates of birth, names, addresses, postcodes, screenshots, or anything that could identify a patient, then try again with a general description of the issue.",
      "bot"
    );
    return;
  }

  addBubble(q, "me");
  sendBtn.disabled = true;

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: q,
        context: {
          audience: "gp_practice_staff",
          scope: "non_clinical_nhs_app_support"
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      addBubble(`Something went wrong calling the bot (${res.status}).\n${errText}`, "bot");
      return;
    }

    const data = await res.json();
    addBubble(data.reply || "No reply returned.", "bot");
  } catch (e) {
    addBubble(`Couldn’t reach the bot service.\n${String(e)}`, "bot");
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", () => askBot(msg.value));
msg.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) askBot(msg.value);
});

chips.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-q]");
  if (!btn) return;
  askBot(btn.getAttribute("data-q"));
});
