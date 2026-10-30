// The site's own request emails (added Oct 29 2026, after FormSubmit went down and two requests were missed).
// Nothing on mirandaraephotography.com depends on FormSubmit anymore:
//   /api/request  every "Send My Request" form posts here. The visitor is ALWAYS sent on to the thank-you
//                 page right away (even if something below fails); then, in the background:
//                   1) the request is saved in the site's storage ("web-requests"), so it can never be lost
//                   2) the request email goes out from mirandaraephotography.com itself through Cloudflare
//                      (to mirandaraep@gmail.com, copy to bookmirandarae@gmail.com)
//                   3) Sandy texts Randy and Miranda about it
//                 Tests (Randy's, Bradyn's or Miranda's own numbers, or "test" in the name) email and text Randy only.
//   /api/notify   the smaller emails pages used to send through FormSubmit (Confirm, deposits, add-ons, Bookings
//                 page, Text Miranda taps, link clicks). Same fields, same subject lines, sent the same way.
//   Sister sites  AffordableBeachPhotographer.com and MirandaRaePhotos.com already send a copy of each request
//                 to the Bookings page; that copy now also gets the email + Sandy texts (backup while their
//                 FormSubmit is down). They can also post their forms straight to /api/request.
// Emails are sent with Cloudflare Email Routing: both Gmail addresses are "verified destinations" on the
// mirandaraephotography.com domain, which is what lets the site send to them.

export const RANDY = "2563996736", MIRANDA = "4482196539";
const TEST_PHONES = ["2563996736", "2566134522", "4482196539", "8505550100"]; // Randy, Bradyn, Miranda, Sandy page's pretend customer
const MAIN_TO = "mirandaraep@gmail.com", MIRANDA_TO = "bookmirandarae@gmail.com";
const FROM = "requests@mirandaraephotography.com", FROM_NAME = "Miranda Rae Photography Website";
const SITES = { "mirandaraephotography.com": "MirandaRaePhotography.com", "affordablebeachphotographer.com": "AffordableBeachPhotographer.com", "mirandaraephotos.com": "MirandaRaePhotos.com" };

const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const fmtPhone = (p) => { const d = digits(p); return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : String(p || ""); };
const oneLine = (s, n = 200) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim().slice(0, n);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const niceDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return v || "";
  try { return new Date(v + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); } catch (e) { return v; }
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } };
export const isLiveHost = (url) => hostOf(url) === "mirandaraephotography.com";
export const isTest = (f, subject) => TEST_PHONES.includes(digits(f.phone)) || /\btest\b/i.test(String(f.name || "")) || /🧪|\bTEST\b/.test(String(subject || ""));

// ---------- Reading a form ----------
export async function readFields(req) {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  const out = {};
  const add = (k, v) => { k = String(k).slice(0, 60); v = String(v == null ? "" : v).slice(0, 3000); if (!k) return; out[k] = out[k] ? out[k] + ", " + v : v; };
  try {
    if (type.includes("application/json")) {
      const j = await req.json();
      if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) add(k, typeof v === "object" ? JSON.stringify(v) : v);
    } else if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) if (typeof v === "string") add(k, v);
    } else {
      for (const [k, v] of new URLSearchParams(await req.text())) add(k, v);
    }
  } catch (e) {}
  return Object.fromEntries(Object.entries(out).slice(0, 60));
}

// ---------- The email ----------
// Same order as the FormSubmit emails: the request first, tracking at the very bottom (Randy's choice, Oct 7 2026)
const TOP = ["name", "senior", "phone", "email", "date", "leaving", "time", "beach", "who", "session-type", "session", "collection", "people", "reply", "contact-pref", "message", "heard-from", "text-consent"];
const TRACK = ["came-from", "campaign", "search-phrase", "google-ads-click-id", "referring-site", "first-page", "visits", "page", "form", "site"];
const LABELS = { name: "Name", senior: "Senior's name", leaving: "Leaving town", phone: "Phone", email: "Email", date: "Date", time: "Sunset or sunrise", beach: "Beach", who: "Who's in the photos", "session-type": "Session type", session: "Session",
  collection: "Wedding package", people: "How many people", reply: "Best way to reply", "contact-pref": "Best way to reply", message: "Message", "heard-from": "Heard about Miranda from",
  "text-consent": "OK to text", "came-from": "Came from", campaign: "Ad campaign", "search-phrase": "Search phrase", "google-ads-click-id": "Google Ads click ID",
  "referring-site": "Referring site", "first-page": "First page", visits: "Visits", page: "Page", form: "Form", site: "Website" };
const label = (k) => LABELS[k] || k.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export function buildEmail(f, { subject, note = "", footer = "" } = {}) {
  const keys = Object.keys(f).filter((k) => !k.startsWith("_") && k !== "subject" && f[k] !== "");
  const main = TOP.filter((k) => keys.includes(k)).concat(keys.filter((k) => !TOP.includes(k) && !TRACK.includes(k)));
  const track = TRACK.filter((k) => keys.includes(k));
  const val = (k) => (k === "date" || k === "leaving" ? niceDate(f[k]) : k === "phone" ? fmtPhone(f[k]) : f[k]);
  const row = (k) => '<tr><th style="text-align:left;vertical-align:top;padding:8px 12px;background:#f3efe8;border-bottom:1px solid #e6dfd3;width:38%;font-weight:600">' + esc(label(k)) +
    '</th><td style="padding:8px 12px;border-bottom:1px solid #e6dfd3;white-space:pre-wrap">' + (k === "phone" && digits(f[k]).length === 10
      ? '<a href="sms:+1' + digits(f[k]) + '" style="color:#1d5b6b">' + esc(val(k)) + "</a>" : k === "email" ? '<a href="mailto:' + esc(f[k]) + '" style="color:#1d5b6b">' + esc(f[k]) + "</a>" : esc(val(k))) + "</td></tr>";
  const table = (ks) => '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:620px;border:1px solid #e6dfd3;font-size:15px">' + ks.map(row).join("") + "</table>";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#26394a;line-height:1.45">' +
    '<h2 style="font-size:19px;margin:0 0 12px">' + esc(subject) + "</h2>" +
    (note ? '<p style="margin:0 0 12px;padding:10px 12px;background:#fff6d6;border:1px solid #ecd98a;border-radius:6px">' + esc(note) + "</p>" : "") +
    table(main) +
    (track.length ? '<h3 style="font-size:13px;margin:22px 0 6px;color:#6b7a85;text-transform:uppercase;letter-spacing:.04em">Tracking</h3>' + table(track) : "") +
    '<p style="font-size:12px;color:#8a949b;margin-top:18px">' + esc(footer || "Sent by Miranda's website (mirandaraephotography.com) through Cloudflare.") + "</p></div>";
  const text = subject + "\n\n" + (note ? note + "\n\n" : "") + main.map((k) => label(k) + ": " + val(k)).join("\n") +
    (track.length ? "\n\n--- Tracking ---\n" + track.map((k) => label(k) + ": " + f[k]).join("\n") : "") + "\n\n" + (footer || "Sent by Miranda's website (mirandaraephotography.com) through Cloudflare.");
  return { html, text };
}

// Raw email for Cloudflare's send_email binding (older form of the binding, used if the newer one isn't there)
const b64 = (s) => { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?=");
export function mime({ from, fromName, to, replyTo, subject, html, text }) {
  const bound = "mrp" + Math.random().toString(36).slice(2), id = "<" + Date.now() + "." + Math.random().toString(36).slice(2) + "@mirandaraephotography.com>";
  return ["From: " + encWord(fromName) + " <" + from + ">", "To: " + to, replyTo ? "Reply-To: " + replyTo : "", "Subject: " + encWord(subject),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"), "Message-ID: " + id, "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + bound + '"', "", "--" + bound, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(text)),
    "--" + bound, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(html)), "--" + bound + "--", ""].filter((l, i) => l !== "" || i > 5).join("\r\n");
}

// Sends one email to each address. Returns { ok, error }
export async function sendEmail(env, deps, { to, subject, html, text, replyTo }) {
  if (!env || !env.EMAIL) return { ok: false, error: "email isn't set up in Cloudflare yet" };
  const errors = [];
  for (const addr of to) {
    try {
      let done = false;
      try {
        // Newer Cloudflare email API
        await env.EMAIL.send({ to: addr, from: { email: FROM, name: FROM_NAME }, subject, html, text, ...(replyTo ? { replyTo } : {}) });
        done = true;
      } catch (e) {
        if (!deps || !deps.EmailMessage) throw e;
      }
      if (!done) {
        // Older Cloudflare email API: a ready-made email
        await env.EMAIL.send(new deps.EmailMessage(FROM, addr, mime({ from: FROM, fromName: FROM_NAME, to: addr, replyTo, subject, html, text })));
      }
    } catch (e) { errors.push(addr + ": " + String((e && (e.message || e.code)) || e)); }
  }
  return { ok: errors.length === 0, error: errors.join("; ") };
}

// ---------- Where the visitor goes next ----------
export function nextUrl(f, req) {
  const here = new URL(req.url);
  const fallback = new URL("/thank-you", here.origin).toString();
  const n = String(f._next || "").trim();
  if (!n) return fallback;
  try {
    const u = new URL(n, here.origin), h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.protocol !== "https:" && u.origin !== here.origin) return fallback;
    // A form on a test copy sends people to the test copy's own thank-you page
    if (h === "mirandaraephotography.com" && !isLiveHost(req.url)) return new URL(u.pathname + u.search, here.origin).toString();
    return SITES[h] || u.origin === here.origin ? u.toString() : fallback;
  } catch (e) { return fallback; }
}

// ---------- Keeping a copy + not sending twice ----------
const storeName = (req) => (isLiveHost(req.url) ? "web-requests" : "web-requests-test");
const keyOf = (f) => [digits(f.phone), String(f.date || "").slice(0, 10), oneLine(f.name, 40).toLowerCase()].join("|");
async function seen(store, f, kind) {
  // kind "full" = the whole form; "copy" = a sister site's short Bookings copy. Returns what's already there.
  const k = "seen-" + keyOf(f), now = Date.now(), prev = (await store.get(k, { type: "json" })) || {};
  const recent = (t) => t && now - t < 15 * 60000;
  const was = { full: recent(prev.full), copy: recent(prev.copy) };
  await store.setJSON(k, { ...prev, [kind]: now });
  return was;
}
async function keep(store, entry) {
  const list = (await store.get("list", { type: "json" })) || [];
  list.push(entry);
  await store.setJSON("list", list.slice(-500));
}
// Simple limit per visitor so nobody can flood the inboxes: 20 sends an hour from one connection
async function tooMany(store, req, what) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown", hour = new Date().toISOString().slice(0, 13);
  const k = "rate-" + what + "-" + ip + "-" + hour, n = ((await store.get(k, { type: "json" })) || 0) + 1;
  await store.setJSON(k, n);
  return n > (what === "notify" ? 40 : 20);
}

// ---------- Sandy's text to Randy and Miranda ----------
export function alertText(f, { subject, site, page, emailed, test }) {
  let line = String(subject || "").replace(/^.*?NEW REQUEST:\s*/i, "").replace(/^🧪\s*TEST\s*·\s*/, "").replace(/\s*\([A-Za-z]+\.com\)$/, "");
  const name = oneLine(f.name, 60) || "No name";
  const rest = line.split(" · ").filter((p, i) => !(i === 0 && p.trim().toLowerCase() === name.toLowerCase()));
  if (!rest.length) rest.push(f.date ? niceDate(f.date) : "no date yet", oneLine(f.beach, 40));
  const extra = [oneLine(f.time, 12), oneLine(f.who || f["session-type"], 30), (f.reply || f["contact-pref"]) ? "reply by " + oneLine(f.reply || f["contact-pref"], 20) : "", f["text-consent"] ? "OK to text" : "", oneLine(f.details, 80)].filter(Boolean).join(" · ");
  return (test ? "🧪 TEST · " : "") + "📩 New website request\n" + name + ", " + fmtPhone(f.phone) + "\n" + rest.filter(Boolean).join(" · ") +
    (extra ? "\n" + extra : "") + (f.message && !/^Came from:/.test(f.message) ? '\n"' + oneLine(f.message.replace(/\n*Came from:[\s\S]*$/, ""), 160) + '"' : "") +
    "\nFrom " + site + (page ? " (" + page + ")" : "") + (emailed ? "" : "\n(The email didn't go out, so this text is your copy.)");
}
async function textAlerts(deps, base, body, test) {
  if (!deps || !deps.tell) return;
  for (const who of test ? [RANDY] : [RANDY, MIRANDA]) {
    try { await deps.tell(base, who, body); } catch (e) { console.log("alert text failed", who, String(e)); }
  }
}

// ---------- One request: save, email, text ----------
async function handleOne({ f, req, env, deps, site, kind }) {
  const store = deps.getStore({ name: storeName(req), consistency: "strong" });
  const was = await seen(store, f, kind);
  const test = isTest(f, f._subject || f.subject);
  let page = "";
  if (kind === "full") { try { const r = new URL(req.headers.get("referer") || ""); page = r.pathname; } catch (e) {} }
  page = oneLine(page, 60);
  let subject = oneLine(f._subject || f.subject || "", 250);
  if (!subject || /^📩 NEW REQUEST$/.test(subject)) subject = (test ? "🧪 TEST · " : "") + "📩 NEW REQUEST: " + [oneLine(f.name, 60) || "No name", f.date ? niceDate(f.date) : "no date yet", oneLine(f.beach, 40)].filter(Boolean).join(" · ");
  if (kind === "copy" && !/\(.*\.com\)$/.test(subject)) subject += " (" + site + ")";
  const entry = { at: new Date().toISOString(), site, kind, name: oneLine(f.name, 60), phone: digits(f.phone), date: String(f.date || "").slice(0, 10), beach: oneLine(f.beach, 40), subject, test, fields: f };
  // Double tap of Send, or the same request arriving twice: keep it, but don't email/text again
  if (was.full || (kind === "copy" && was.copy)) { await keep(store, { ...entry, skipped: "already sent" }); return; }
  const live = isLiveHost(req.url);
  const to = [MAIN_TO].concat(live && !test ? [MIRANDA_TO] : []);
  const note = kind === "copy" ? "Backup copy from " + site + ". That site's own email has every detail; if it didn't come, this is what reached the Bookings page." : "";
  const { html, text } = buildEmail(f, { subject, note, footer: kind === "copy" ? "Sent by Miranda's website (mirandaraephotography.com) from " + site + "'s Bookings copy." : "" });
  const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(f.email || "").trim()) ? String(f.email).trim() : "";
  const mail = await sendEmail(env, deps, { to, subject, html, text, replyTo });
  await textAlerts(deps, new URL(req.url).origin, alertText(f, { subject, site, page, emailed: mail.ok, test }), test);
  await keep(store, { ...entry, emailed: mail.ok, ...(mail.error ? { emailError: mail.error } : {}) });
}

// POST /api/request — a "Send My Request" form. The visitor always goes on to the thank-you page.
export async function handleRequest(req, env, ctx, deps) {
  let f = {}, next = new URL("/thank-you", new URL(req.url).origin).toString();
  try {
    if (req.method !== "POST") return Response.redirect(next, 303);
    f = await readFields(req);
    next = nextUrl(f, req);
    const spam = !!String(f._honey || "").trim() || (!digits(f.phone) && !String(f.name || "").trim() && !String(f.email || "").trim());
    if (!spam) {
      const site = SITES[hostOf(f._next)] && !/mirandaraephotography/.test(hostOf(f._next)) ? SITES[hostOf(f._next)] : "MirandaRaePhotography.com";
      const work = (async () => {
        const store = deps.getStore({ name: storeName(req), consistency: "strong" });
        if (await tooMany(store, req, "request")) { await keep(store, { at: new Date().toISOString(), skipped: "too many from one visitor", fields: f }); return; }
        await handleOne({ f, req, env, deps, site, kind: "full" });
      })().catch((e) => console.log("request failed", String(e && e.stack || e)));
      if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    }
  } catch (e) { console.log("request error", String(e)); }
  return new Response(null, { status: 303, headers: { Location: next, "Cache-Control": "no-store" } });
}

// A sister site's short Bookings copy ({ name, date, beach, phone, detail }). Waits a few seconds in case
// that site also posts the whole form to /api/request, so Randy gets one full email instead of two.
export function handleSisterCopy(d, siteName, req, env, ctx, deps) {
  const f = { name: oneLine(d.name, 60), phone: digits(d.phone), date: String(d.date || "").slice(0, 10), beach: oneLine(d.beach, 40), details: oneLine(d.detail, 300), site: siteName };
  if (!f.phone && !f.name) return;
  const work = (async () => {
    await new Promise((r) => setTimeout(r, deps.wait == null ? 10000 : deps.wait));
    const store = deps.getStore({ name: storeName(req), consistency: "strong" });
    if (await tooMany(store, req, "request")) return;
    await handleOne({ f, req, env, deps, site: siteName, kind: "copy" });
  })().catch((e) => console.log("sister copy failed", String(e)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(work);
  return work;
}

// POST /api/notify — the smaller emails (Confirm, deposits, add-ons, Bookings page, taps and clicks).
// Answers like FormSubmit did ({ success: "true" }) so the pages work unchanged.
export async function handleNotify(req, env, ctx, deps) {
  const ok = (s = 200, extra = {}) => new Response(JSON.stringify({ success: s === 200 ? "true" : "false", ...extra }), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST") return ok(405);
  const f = await readFields(req);
  if (String(f._honey || "").trim()) return ok();
  const store = deps.getStore({ name: storeName(req), consistency: "strong" });
  if (await tooMany(store, req, "notify")) return ok(429, { message: "too many" });
  const subject = oneLine(f._subject || f.subject || "Website note", 250);
  const live = isLiveHost(req.url);
  // Miranda gets a copy only when the page asked for it (pages leave her off for tests), and only on the real site
  const to = [MAIN_TO].concat(live && /^bookmirandarae@gmail\.com$/i.test(String(f._cc || "").trim()) ? [MIRANDA_TO] : []);
  const { html, text } = buildEmail(f, { subject });
  const mail = await sendEmail(env, deps, { to, subject, html, text });
  if (!mail.ok) {
    const list = (await store.get("notify-failed", { type: "json" })) || [];
    await store.setJSON("notify-failed", list.concat({ at: new Date().toISOString(), subject, error: mail.error, fields: f }).slice(-200));
    console.log("notify email failed", mail.error);
  }
  // The page goes on either way: the Bookings page already has the booking/deposit/extra saved
  return ok();
}
