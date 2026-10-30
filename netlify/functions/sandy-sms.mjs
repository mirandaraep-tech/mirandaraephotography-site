// Sandy's texting number (448) 217-3502 — Twilio sends every incoming text here (added Oct 21 2026).
// In Twilio: Phone Numbers → (448) 217-3502 → Messaging → "A message comes in" → Webhook,
// https://mirandaraephotography.com/api/sandy-sms (HTTP POST).
// Twilio waits only 15 seconds, so this answers right away and Sandy replies by her own text a moment later.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PEOPLE, MIRANDA, digits, env, deliver, record, sandyKey, sandyStore, customerMode, setCustomerMode } from "../sandy/brain.mjs";
import { OPT_WORDS } from "../sandy/customers.mjs";

const empty = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml" } });

// Proves the text really came through Miranda's Twilio account
function fromTwilio(req, url, params) {
  const tok = env("TWILIO_AUTH_TOKEN"), sig = req.headers.get("x-twilio-signature") || "";
  if (!tok || !sig) return false;
  const s = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const mine = createHmac("sha1", tok).update(s).digest("base64");
  return mine.length === sig.length && timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Sandy here.", { status: 200 });
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const site = env("URL") || "https://mirandaraephotography.com";
  const urls = [req.url, site.replace(/\/$/, "") + "/api/sandy-sms"];
  if (!urls.some((u) => fromTwilio(req, u, params))) return new Response("Forbidden", { status: 403 });
  const from = digits(params.From), text = String(params.Body || "").trim().slice(0, 1500);
  const base = new URL(req.url).origin;
  if (!text) return empty();
  // Randy testing a website request from his own phone (Oct 28 2026): for 3 hours his texts get the
  // customer side of Sandy, like a real customer would. "DONE" switches him back right away.
  let asCustomer = false;
  if (PEOPLE[from] && (await customerMode(base, from))) {
    if (/^\s*done( testing)?\s*[.!]*\s*$/i.test(text)) {
      await setCustomerMode(base, from, false);
      await deliver(base, from, "Sandy here. Got it, you're done testing as a customer. I'm back to regular Sandy for you.", "reply");
      return empty();
    }
    asCustomer = true;
  }
  if (!PEOPLE[from] || asCustomer) {
    // A customer (Oct 28 2026): Sandy answers them herself when SANDY_CUSTOMERS is "on"
    await record(base, { kind: "incoming-other", from, body: text });
    if (env("SANDY_CUSTOMERS").toLowerCase() !== "on") {
      await deliver(base, MIRANDA, "Sandy here: a text came to my number from " + (params.From || "unknown") + ":\n\"" + text.slice(0, 400) + "\"\nYou may want to reply to them from your phone.", "forwarded");
      return empty();
    }
    // STOP / HELP and the like: Twilio answers those itself
    if (OPT_WORDS.test(text)) {
      if (/^\s*cancel/i.test(text)) await deliver(base, MIRANDA, "Sandy here: " + (params.From || "a customer") + " texted just \"CANCEL\". That also stops my texts to them, so I can't reply. If they have a session, they may want to cancel it. You may want to call or text them from your phone.", "forwarded");
      return empty();
    }
    // Limits so one number (or a flood of texts) can't run up Sandy's Claude bill
    const s = sandyStore(base), day = new Date().toISOString().slice(0, 10);
    const n = ((await s.get("rate-" + from + "-" + day, { type: "json" })) || 0) + 1, all = ((await s.get("rate-all-" + day, { type: "json" })) || 0) + 1;
    await s.setJSON("rate-" + from + "-" + day, n); await s.setJSON("rate-all-" + day, all);
    if (n > 30 || all > 300) {
      if (n === 31 || all === 301) await deliver(base, MIRANDA, "Sandy here: " + (n > 30 ? (params.From || "a number") + " has texted me over 30 times today" : "I've had over 300 customer texts today") + ", so I've stopped answering " + (n > 30 ? "them" : "customers") + " until tomorrow. You may want to reply from your phone.", "forwarded");
      return empty();
    }
    await fetch(base + "/.netlify/functions/sandy-reply-background", {
      method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey() },
      body: JSON.stringify({ kind: "customer", from, text, base }),
    });
    return empty();
  }
  await record(base, { kind: "incoming", from, body: text });
  // Hand the thinking to Sandy's longer-running helper (up to 15 minutes)
  await fetch(base + "/.netlify/functions/sandy-reply-background", {
    method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey() },
    body: JSON.stringify({ kind: "text", from, text, base }),
  });
  return empty();
};

export const config = { path: "/api/sandy-sms" };
