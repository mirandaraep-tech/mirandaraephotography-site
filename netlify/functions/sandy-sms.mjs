// Sandy's texting number (448) 217-3502 — Twilio sends every incoming text here (added Oct 21 2026).
// In Twilio: Phone Numbers → (448) 217-3502 → Messaging → "A message comes in" → Webhook,
// https://mirandaraephotography.com/api/sandy-sms (HTTP POST).
// Twilio waits only 15 seconds, so this answers right away and Sandy replies by her own text a moment later.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PEOPLE, MIRANDA, digits, env, deliver, record } from "../sandy/brain.mjs";

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
  if (!PEOPLE[from]) {
    // A customer or anyone else. Sandy doesn't answer customers yet: pass it to Miranda.
    await record(base, { kind: "incoming-other", from, body: text });
    await deliver(base, MIRANDA, "Sandy here: a text came to my number from " + (params.From || "unknown") + ":\n\"" + text.slice(0, 400) + "\"\nYou may want to reply to them from your phone.", "forwarded");
    return empty();
  }
  await record(base, { kind: "incoming", from, body: text });
  // Hand the thinking to Sandy's longer-running helper (up to 15 minutes)
  await fetch(base + "/.netlify/functions/sandy-reply-background", {
    method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": env("SANDY_KEY") },
    body: JSON.stringify({ kind: "text", from, text, base }),
  });
  return empty();
};

export const config = { path: "/api/sandy-sms" };
