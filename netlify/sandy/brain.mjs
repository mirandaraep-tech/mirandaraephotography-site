// Sandy — Miranda Rae Photography's texting assistant (added Oct 21 2026).
// Sandy is Claude (Anthropic's AI) built into this site. She reads the private Bookings app (/log)
// and makes the same changes its buttons make (Deposit received, Paid in full, Move, Cancel...),
// always through /api/booking-counter so the money rules live in one place.
//
// Secrets live in Netlify's environment settings, never in this file:
//   ANTHROPIC_API_KEY  — Sandy's Claude account key
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN — Twilio account (texting)
//   SANDY_TEXTING      — set to "on" once Twilio approves the campaign. Until then nothing is texted;
//                        Sandy's texts only show on the private /sandy test page.
import { getStore } from "@netlify/blobs";
import { Buffer } from "node:buffer";
// Sandy talks to the Bookings code directly (not over the internet), so it also works on password-protected test copies
import bookingCounter from "../functions/booking-counter.mjs";
import PRICES from "../../prices.json" with { type: "json" };

export const MODEL = "claude-sonnet-5-5";
export const SANDY_NUMBER = "+14482173502"; // (448) 217-3502, Twilio
// Randy and Miranda (last 10 digits). Anyone else who texts Sandy is treated as a customer
// (customers.mjs, added Oct 28 2026).
export const PEOPLE = {
  "2563996736": { name: "Randy", role: "Randy (Miranda's dad, the administrator who set Sandy up)" },
  "4482196539": { name: "Miranda", role: "Miranda (she runs Miranda Rae Photography and does the shooting)" },
  // Oct 30 2026: Bradyn is staff too. He can okay customer dates and update the Bookings app. He can still
  // test as a customer the same way Randy does (send a website request from his phone).
  "2566134522": { name: "Bradyn", role: "Bradyn (he helps Miranda: he can okay customer date requests and update the Bookings app)" },
};
export const MIRANDA = "4482196539";
export const BRADYN = "2566134522";
// Oct 30 2026: who gets asked to okay a customer's date. Both at once; the first YES or NO decides.
export const STAFF = [MIRANDA, BRADYN];
// Pretend customer used by the "Customer" button on the private /sandy page. Never really texted.
export const TEST_CUSTOMER = "8505550100";
// Customers' conversations kept by phone number; the pretend customer's stays separate
export const histKey = (phone) => (digits(phone) === TEST_CUSTOMER ? "page-" : "chat-") + digits(phone);
// A customer's conversation. Randy's (or Miranda's) own number testing as a customer keeps a separate
// "cust-" conversation so it never mixes with their regular texts with Sandy (Oct 28 2026).
export const custKey = (phone) => { const d = digits(phone); return d === TEST_CUSTOMER ? "page-" + d : PEOPLE[d] ? "cust-" + d : "chat-" + d; };
export async function getCustHistory(base, phone) { return (await sandyStore(base).get(custKey(phone), { type: "json" })) || []; }
export async function saveCustHistory(base, phone, h) { await sandyStore(base).setJSON(custKey(phone), h.slice(-20)); }

// ---------- Website requests (Oct 28 2026) ----------
// Sandy texts people who send a request form on the site and check the OK-to-text box.
// Until Randy says to turn it on for everyone (SANDY_WEB_TEXTS = "everyone" in wrangler.jsonc),
// only these numbers get Sandy's texts: Randy and Bradyn.
export const WEB_TESTERS = ["2563996736", "2566134522"];
// Our own numbers (Randy, Bradyn, Miranda): their requests and Sandy's texts to Miranda about them say TEST
export const OUR_NUMBERS = ["2563996736", "2566134522", "4482196539"];
export const isOurs = (phone) => OUR_NUMBERS.includes(digits(phone));
export const webTextsFor = (phone) => env("SANDY_WEB_TEXTS").toLowerCase() === "everyone" || WEB_TESTERS.includes(digits(phone));
// Randy testing as a customer: for 3 hours after he sends a website request, his texts go to the customer
// side of Sandy. Texting "DONE" ends it sooner.
export async function customerMode(base, phone) { const u = await sandyStore(base).get("custmode-" + digits(phone), { type: "json" }); return !!(u && u > Date.now()); }
export async function setCustomerMode(base, phone, on) { await sandyStore(base).setJSON("custmode-" + digits(phone), on ? Date.now() + 3 * 3600000 : 0); }
// Same fingerprint as the /log passcode (only the fingerprint is public)
const PASS_SHA256 = "37ba3881108bf3e48180350246c5959b9481633d0cb1d8694fb141dc74e5fe79";

// Sandy's own password for reaching the Bookings data. Made up automatically the first time and kept in
// the site's private storage (never in this file or in Netlify settings), so nobody has to type it anywhere.
export async function sandyKey() {
  const s = getStore({ name: "sandy-secret", consistency: "strong" });
  let k = await s.get("key");
  if (!k || k.length < 20) { k = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join(""); await s.set("key", k); }
  return k;
}
export const env = (k) => ((globalThis.Netlify && Netlify.env.get(k)) || process.env[k] || "");
export const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
export const passOk = async (p) => (await sha(String(p || "").trim().toLowerCase())) === PASS_SHA256;
export const isLive = (base) => /^https:\/\/(www\.)?mirandaraephotography\.com/.test(base);
export const sandyStore = (base) => getStore({ name: isLive(base) ? "sandy" : "sandy-test", consistency: "strong" });

// ---------- Dates (Central time, same as Miranda's beaches) ----------
const ymdIn = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const todayCT = (now = new Date()) => ymdIn(now);
export const hourCT = (now = new Date()) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(now));
export const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nice = (ymd) => { try { return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch (e) { return ymd; } };
const daysAgo = (iso, today) => { const k = Math.round((new Date(today + "T12:00:00Z") - new Date(ymdIn(new Date(iso)) + "T12:00:00Z")) / 86400000); return k <= 0 ? "today" : k === 1 ? "yesterday" : k + " days ago"; };

// ---------- Money (same rules as the /log page) ----------
const r2 = (n) => Math.round(n * 100) / 100;
const less = (b) => (b.deducts || []).reduce((s, x) => s + (x.amount || 0), 0);
const tot = (b) => r2((b.total || 0) + (b.addons || 0) - less(b));
const shareOf = (sp, t) => { const v = sp.mode === "amt" ? sp.val : Math.max(t * sp.val / 100, sp.min || 0); return r2(Math.min(Math.max(0, t), v)); };
const payOf = (b) => !b.photographer ? 0 : b.split ? r2(tot(b) - shareOf(b.split, tot(b))) : (b.payout || 0);
const mineOf = (b) => Math.max(0, tot(b) - payOf(b));
const handed = (b) => (b.shooterPaid || []).reduce((s, x) => s + (x.amount || 0), 0);
const keepOf = (b) => b.cancelled ? (b.cancelled.kept || 0) : b.photographer ? Math.min(mineOf(b), ((b.deposit && b.deposit.amount) || 0) + handed(b)) : Math.min(tot(b), ((b.deposit && b.deposit.amount) || 0) + ((b.paid && b.paid.amount) || 0));
const shooterOwes = (b) => (!b.photographer || b.cancelled || !b.paid) ? 0 : Math.max(0, r2(mineOf(b) - keepOf(b)));
const due = (b) => Math.max(0, r2(tot(b) - ((b.deposit && b.deposit.amount) || 0) - ((b.paid && b.paid.amount) || 0)));
export const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const low = (s) => String(s || "").trim().toLowerCase();

// Oct 22 2026: same rule as /log — a booking closes the inquiry when it's clearly the same person even if
// the date moved (within 2 weeks) or the name has a typo or two, or the phone number matches.
const nameParts = (s) => low(s).replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
function edits(a, b) {
  if (a === b) return 0;
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const q = [i];
    for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = q;
  }
  return p[b.length];
}
const closeWord = (a, b) => { if (a === b) return true; if (!a || !b || a[0] !== b[0]) return false; const n = Math.min(a.length, b.length); return edits(a, b) <= (n >= 6 ? 2 : n >= 4 ? 1 : 0); };
function sameName(x, y) {
  const a = nameParts(x), b = nameParts(y);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  if (a.length < 2 || b.length < 2) return false;
  return closeWord(a[0], b[0]) && closeWord(a[a.length - 1], b[b.length - 1]);
}
const d10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const daysApart = (a, b) => Math.abs(new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000;
function bookedAs(o, b) {
  const samePhone = d10(o.phone).length === 10 && d10(o.phone) === d10(b.phone);
  if (!samePhone && !sameName(o.name, b.name)) return false;
  if (b.created && o.asked && b.created < new Date(new Date(o.asked).getTime() - 7 * 86400000).toISOString()) return false;
  if (o.date && b.date && daysApart(o.date, b.date) > 14) return false;
  return true;
}

// Inquiries: website requests and texted Confirm links nobody has confirmed (same as /log)
function inquiries(data, today) {
  const log = data.log || [], gone = {}, map = {};
  const key = (e) => low(e.name) + "|" + (e.date || "");
  (data.bookings || []).forEach((b) => { gone[low(b.name) + "|" + (b.date || "")] = 1; });
  log.forEach((e) => { if (e.kind === "confirm" || e.kind === "added" || e.kind === "dismiss") gone[key(e)] = 1; });
  log.forEach((e) => {
    // Oct 30 2026: Miranda said no after Bradyn's yes; the Confirm link that went out no longer counts
    if (e.kind === "void") { const v = map[key(e)]; if (v) delete v.sent; return; }
    if (e.kind !== "request" && e.kind !== "sent") return;
    if (!String(e.name || "").trim()) return;
    const k = key(e); if (gone[k]) return;
    const o = map[k] || { key: k, name: e.name, date: e.date || "", asked: e.at };
    if (e.kind === "request") { o.request = e; if (!o.phone && e.phone) o.phone = e.phone; if (!o.beach && e.beach) o.beach = e.beach; o.detail = e.detail; }
    else { o.sent = e; o.time = e.time || o.time; o.pkg = e.pkg || o.pkg; o.amount = e.amount || o.amount; if (e.phone) o.phone = e.phone; if (e.beach) o.beach = e.beach; }
    o.test = !!(o.test || e.test);
    map[k] = o;
  });
  const cut = new Date(Date.now() - 30 * 86400000).toISOString();
  return Object.values(map).filter((o) => !(data.bookings || []).some((b) => bookedAs(o, b))).map((o) => ({ ...o, old: o.date ? o.date < today : (o.asked || "") < cut }));
}

export const fmtPhone = (p) => { const d = digits(p); return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : ""; };
function line(b) {
  const bits = [
    b.num < 900000 ? "#" + b.num : "TEST #" + b.num, b.name, b.date ? nice(b.date) : "no date", b.time, b.beach, b.pkg,
    money(tot(b)),
    b.cancelled ? "CANCELLED" : due(b) <= 0 ? "paid in full" : (b.deposit ? "deposit in (" + money(b.deposit.amount) + " " + (b.deposit.method || "") + ")" : "NO DEPOSIT YET") + ", owes " + money(due(b)),
    b.photographer ? "shot by " + b.photographer + " (their pay " + money(payOf(b)) + ")" : "",
    b.phone ? "phone " + fmtPhone(b.phone) : "",
    b.notes ? "notes: " + b.notes : "",
  ];
  return "- " + bits.filter(Boolean).join(" · ");
}

// What Sandy "sees": a short written picture of the Bookings app
export function snapshot(data, today = todayCT()) {
  const withTests = !!data.test; // on a test copy of the site everything is test data, so show it
  const ok = (x) => withTests || !x.test;
  const B = (data.bookings || []).filter(ok);
  const live = B.filter((b) => !b.cancelled && !b.past);
  const tomorrow = addDays(today, 1);
  const sorted = (a) => a.slice().sort((x, y) => (x.date || "9999").localeCompare(y.date || "9999") || (x.num || 0) - (y.num || 0));
  const todays = sorted(live.filter((b) => b.date === today));
  const tomorrows = sorted(live.filter((b) => b.date === tomorrow));
  const upcoming = sorted(live.filter((b) => (b.date || "") > tomorrow || !b.date));
  const noDeposit = upcoming.concat(todays, tomorrows).filter((b) => !b.deposit && !b.paid && tot(b) > 0);
  const needs = sorted(live.filter((b) => b.date && b.date < today && due(b) > 0));
  const owes = B.filter((b) => shooterOwes(b) > 0);
  const inq = inquiries(data, today).filter(ok);
  const open = inq.filter((o) => !o.old).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const old = inq.filter((o) => o.old);
  const recentCut = addDays(today, -21);
  const offs = (data.daysOff || []).filter((o) => o.date >= today);
  const recent = sorted(B.filter((b) => (b.cancelled || b.past || (b.date && b.date < today && due(b) <= 0)) && (b.date || "") >= recentCut)).reverse();

  const inqLine = (o) => "- " + [o.name, o.date ? "wants " + nice(o.date) : "no date given", o.beach, o.time, o.pkg, o.amount ? money(o.amount) : "", o.phone ? "phone " + fmtPhone(o.phone) : "",
    o.sent ? "Confirm link texted " + daysAgo(o.sent.at, today) + ", not confirmed yet" : "asked " + daysAgo(o.asked, today) + " (" + (o.detail || "website") + "), no Confirm link sent yet", o.test ? "TEST" : ""].filter(Boolean).join(" · ");
  const sect = (title, arr, f = line) => title + " (" + arr.length + "):\n" + (arr.length ? arr.map(f).join("\n") : "- none");
  const parts = [
    "BOOKINGS SNAPSHOT — today is " + nice(today) + " (" + today + "), Central time." + (withTests ? " THIS IS THE TEST COPY OF THE SITE: all entries are test data." : ""),
    sect("TODAY'S SESSIONS", todays),
    sect("TOMORROW'S SESSIONS", tomorrows),
    sect("OPEN INQUIRIES (asked, not booked yet)", open, inqLine),
    sect("CONFIRMED BUT NO DEPOSIT YET", noDeposit),
    sect("NEEDS A LOOK (session date passed but not marked paid in full — shot or moved?)", needs),
    sect("PHOTOGRAPHER OWES MIRANDA", owes, (b) => line(b) + " · owes Miranda " + money(shooterOwes(b))),
    sect("OTHER UPCOMING BOOKINGS", upcoming),
    sect("RECENT (last 3 weeks: finished, cancelled or past entries)", recent),
    "OLD INQUIRIES that could be cleared (date passed or 30+ days old): " + old.length,
    "MIRANDA'S DAYS OFF (" + offs.length + "):\n" + (offs.length ? offs.map((o) => "- " + nice(o.date) + " (" + o.date + "): " + (o.part === "all" ? "whole day" : o.part + " only") + (o.note ? " · " + o.note : "")).join("\n") : "- none"),
  ];
  const loose = open.length + noDeposit.length + needs.length + owes.length;
  return { text: parts.join("\n\n"), counts: { today: todays.length, tomorrow: tomorrows.length, open: open.length, noDeposit: noDeposit.length, needs: needs.length, owes: owes.length, loose } };
}

// ---------- Talking to the Bookings app ----------
const api = (base) => base.replace(/\/$/, "") + "/api/booking-counter";
const callCounter = async (url, init) => (await bookingCounter(new Request(url, init))).json();
export async function loadData(base) {
  const j = await callCounter(api(base) + "?log=1", { headers: { "x-sandy-key": await sandyKey() } });
  if (j.error) throw new Error("Bookings app said: " + j.error);
  return j;
}
const post = async (base, body) => callCounter(api(base), { method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey() }, body: JSON.stringify(body) });

// ---------- Sandy's tools (each one is a button on the /log page) ----------
const num = { type: "integer", description: "Booking number, e.g. 112 (the # number in the snapshot; test bookings have big numbers like 900003)" };
const method = { type: "string", description: "How it was paid: Venmo, Cash App, PayPal, Pixieset, Cash, Zelle, Check or Other" };
export const TOOLS = [
  { name: "deposit_received", description: "Mark a booking's deposit as received (the 'Deposit received' button).", input_schema: { type: "object", properties: { num, amount: { type: "number", description: "Deposit amount in dollars; usually 50" }, method }, required: ["num", "method"] } },
  { name: "paid_in_full", description: "Mark a booking Paid in Full (the rest of the balance came in). The amount is worked out automatically.", input_schema: { type: "object", properties: { num, method }, required: ["num"] } },
  { name: "add_extra", description: "Add an extra charge to a booking (extra people, extra photos, extra time, travel fee...). Raises what the client owes.", input_schema: { type: "object", properties: { num, amount: { type: "number" }, what: { type: "string" } }, required: ["num", "amount", "what"] } },
  { name: "deduct", description: "Take money off a booking (a discount, fewer people...).", input_schema: { type: "object", properties: { num, amount: { type: "number" }, why: { type: "string" } }, required: ["num", "amount"] } },
  { name: "move_date", description: "Move a session to a new date (same time of day). Fails if that slot is already taken.", input_schema: { type: "object", properties: { num, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["num", "date"] } },
  { name: "edit_booking", description: "Change details on a booking. Only send the fields that change. time is a label like Sunrise, Sunset, Wedding, Midday or a clock time.", input_schema: { type: "object", properties: { num, name: { type: "string" }, phone: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string" }, beach: { type: "string" }, pkg: { type: "string", description: "Package name" }, total: { type: "number", description: "Session price before extras" }, notes: { type: "string" } }, required: ["num"] } },
  { name: "set_photographer", description: "Hand a session to another photographer (e.g. Kallie), or back to Miranda (photographer: 'Miranda'). The usual split is applied automatically: 20% to Miranda. Only if Miranda names a different split, also send miranda_percent (e.g. 30) OR miranda_dollars (e.g. 75) for Miranda's share.", input_schema: { type: "object", properties: { num, photographer: { type: "string" }, miranda_percent: { type: "number" }, miranda_dollars: { type: "number" } }, required: ["num", "photographer"] } },
  { name: "photographer_paid_miranda", description: "Record that the contracted photographer handed Miranda her share.", input_schema: { type: "object", properties: { num, amount: { type: "number" } }, required: ["num", "amount"] } },
  { name: "cancel_booking", description: "Cancel a booking. ONLY after the person has clearly said yes to cancelling AND said whether Miranda keeps or returns the deposit.", input_schema: { type: "object", properties: { num, deposit: { type: "string", enum: ["keep", "return", "none"], description: "none = no deposit was paid" } }, required: ["num", "deposit"] } },
  { name: "undo", description: "Undo the last change of one kind on a booking.", input_schema: { type: "object", properties: { num, what: { type: "string", enum: ["deposit", "paid", "cancel", "deduct", "photographer_paid"] } }, required: ["num", "what"] } },
  { name: "add_booking", description: "Add a client Miranda has already set up (nothing is texted to the client). A past date makes a past entry that doesn't count in totals.", input_schema: { type: "object", properties: { name: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string" }, beach: { type: "string" }, pkg: { type: "string" }, amount: { type: "number", description: "Session price" }, phone: { type: "string" }, photographer: { type: "string", description: "Leave empty if Miranda is shooting" }, pay: { type: "string", enum: ["none", "deposit", "full"] }, deposit: { type: "number" }, method }, required: ["name", "date", "amount", "pay"] } },
  { name: "remove_inquiry", description: "Take an inquiry off the list without booking it (they said no or never answered). Use name and date exactly as in the snapshot.", input_schema: { type: "object", properties: { name: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, or empty if none" } }, required: ["name"] } },
  { name: "clear_old_inquiries", description: "Clear every old inquiry (date passed, or 30+ days old with no date). They stay in the record, just off the list.", input_schema: { type: "object", properties: {} } },
  // Customers (Oct 28 2026)
  { name: "send_confirm_link", description: "Text a customer their Confirm link (they check the details, tap Confirm and pay the deposit). ONLY after Miranda (or Randy) has clearly said yes to sending it in this conversation. Use request_id for a request listed under CUSTOMER DATE REQUESTS; any field you also send replaces what's in the request (e.g. a different price or time Miranda asked for).", input_schema: { type: "object", properties: { request_id: { type: "string" }, name: { type: "string" }, phone: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "Sunrise, Sunset, Midday, Wedding, Engagement or Other" }, beach: { type: "string" }, pkg: { type: "string", description: "Package name as in the price list's booking names, e.g. Beach Mini" }, price: { type: "number", description: "Total price for the link (package + travel fee + extras Miranda agreed to)" }, deposit: { type: "number", description: "Only if not the usual $50" } } } },
  { name: "text_customer", description: "Text a customer from your number (Sandy's). Use it to pass along Miranda's answer, offer another date, or say a date isn't open. Write the text yourself in your friendly style; say it's from Miranda when it's her answer. Only to customers listed under CUSTOMER TEXTS or in the bookings/inquiries.", input_schema: { type: "object", properties: { phone: { type: "string" }, message: { type: "string" } }, required: ["phone", "message"] } },
  { name: "set_day_off", description: "Mark days or times Miranda is off, so they show on the Bookings calendar and you won't offer them to customers. For a range, give date and to. part: all (whole day), sunrise, sunset or midday.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD, last day of a range (optional)" }, part: { type: "string", enum: ["all", "sunrise", "sunset", "midday"] }, note: { type: "string", description: "Optional reason, e.g. vacation" } }, required: ["date"] } },
  { name: "remove_day_off", description: "Undo a day off (she's available again). Leave part out to clear the whole day.", input_schema: { type: "object", properties: { date: { type: "string" }, to: { type: "string" }, part: { type: "string", enum: ["all", "sunrise", "sunset", "midday"] } }, required: ["date"] } },
  { name: "offer_other_time", description: "Miranda said no to a customer's requested time but named another time she CAN do (e.g. \"No, but Friday sunset works\"). Texts the customer your message offering that time, and marks it okayed by Miranda, so if they say yes they get the Confirm link right away without asking her again.", input_schema: { type: "object", properties: { request_id: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD of the time Miranda can do" }, time: { type: "string", description: "Sunrise, Sunset, Midday or Other" }, message: { type: "string", description: "The text to the customer, e.g. \"So sorry, Miranda can't make Thursday, Nov 26 at sunrise after all, but she can do Friday, Nov 27 at sunset. Would that work for you? Reply YES and I'll send you the link to save your date.\"" } }, required: ["request_id", "date", "time", "message"] } },
  { name: "remove_pencil", description: "Take a customer's pencil-in (or waiting request) off, when Miranda, Bradyn or Randy asks. text_other_times true = text the customer the closest open times instead; false = just remove it, nothing is texted.", input_schema: { type: "object", properties: { request_id: { type: "string" }, text_other_times: { type: "boolean" } }, required: ["request_id", "text_other_times"] } },
  { name: "close_request", description: "Mark a customer date request as handled without sending a Confirm link (Miranda said no, or it was settled another way).", input_schema: { type: "object", properties: { request_id: { type: "string" }, why: { type: "string" } }, required: ["request_id"] } },
];

// Request tools (Oct 30 2026): the first YES or NO from Miranda or Bradyn decides. A later answer from the other
// one is turned away, except Miranda (or Randy) saying no to a link Bradyn okayed before the deposit is in.
const REQ_TOOLS = ["send_confirm_link", "close_request", "offer_other_time", "remove_pencil"];
const OPEN_REQ = ["waiting", "penciled"];
const whoName = (phone) => (PEOPLE[digits(phone)] || {}).name || "Someone";
const boss = (phone) => digits(phone) === MIRANDA || digits(phone) === "2563996736";
function handledNote(r) {
  if (r.status === "link sent") return (r.sent && r.sent.who ? r.sent.who : "Someone") + " already okayed it and I texted " + firstName(r.name) + " the Confirm link";
  if (r.status === "offered") return (r.offer && r.offer.who ? r.offer.who : "Someone") + " already answered: I offered " + firstName(r.name) + " " + nice(r.offer.date) + " " + low(r.offer.time) + " instead";
  return (r.closed && r.closed.who ? r.closed.who : "Someone") + " already answered it" + (r.closed && r.closed.why ? " (" + r.closed.why + ")" : "");
}
async function runTool(base, name, x, by, data, actor = "") {
  if (REQ_TOOLS.includes(name) && x.request_id) {
    const r = (await getRequests(base)).find((q) => q.id === x.request_id);
    if (!r) return { error: "no request with that id" };
    if (!OPEN_REQ.includes(r.status)) {
      const overrule = r.status === "link sent" && boss(actor) && (name === "close_request" || name === "offer_other_time");
      if (!overrule) return { error: "already handled: " + handledNote(r) + ". Tell them that; nothing else to do." };
      // Miranda wins (Oct 30 2026): cancel the Confirm link that went out (and an unpaid booking from it)
      const v = await post(base, { kind: "void", name: r.sent.n || r.name, date: r.sent.d || r.date, beach: r.sent.b || r.beach || "Other", by });
      if (v.paid) return { error: firstName(r.name) + " already paid the deposit, so it's booked. Tell Miranda she'll need to sort it out with them herself (or cancel the booking first)." };
      if (!v.ok) return { error: "couldn't cancel the Confirm link: " + (v.error || "unknown") };
    }
    const before = { ...r };
    const out = await runTool2(base, name, x, by, data, actor);
    if (out && out.ok && actor) await tellOthers(base, actor, before, name, x);
    return out;
  }
  return runTool2(base, name, x, by, data, actor);
}
// Tell the other staff member it's handled (Oct 30 2026), e.g. "Sandy here. Miranda okayed Jane Smith for
// Thu, Nov 26 sunset, so I texted them the Confirm link. Nothing needed from you."
async function tellOthers(base, actor, r, name, x) {
  const who = whoName(actor), slot = nice(r.date) + (r.time ? " " + low(r.time) : ""), mark = r.mark || r.test ? "TEST — " : "";
  const after = r.status === "link sent" ? " (after " + ((r.sent && r.sent.who) || "Bradyn") + "'s yes), so I cancelled that Confirm link and" : ", so I";
  const msg = name === "send_confirm_link" ? who + " okayed " + r.name + " for " + slot + ", so I texted them the Confirm link."
    : name === "offer_other_time" ? who + " said no to " + r.name + " for " + slot + after + " offered them " + nice(x.date) + " " + low(x.time) + " instead."
    : name === "remove_pencil" ? who + " took " + r.name + "'s pencil-in for " + slot + " off" + (x.text_other_times ? " and I texted them other times." : ".")
    : who + " said no to " + r.name + " for " + slot + after + " offered them other times.";
  for (const p of STAFF) if (p !== digits(actor)) await tellStaff(base, p, mark + "Sandy here. " + msg + " Nothing needed from you.", { page: !!r.test });
}

async function runTool2(base, name, x, by, data, actor) {
  const st = (action, extra) => post(base, { kind: "status", action, num: x.num, by, ...extra });
  switch (name) {
    case "deposit_received": return st("deposit", { amount: x.amount || 50, method: x.method });
    case "paid_in_full": return st("paid", { method: x.method || "" });
    case "add_extra": {
      const r = await post(base, { kind: "addon", ref: x.num, amount: x.amount, what: x.what, name: ((data.bookings || []).find((b) => b.num === x.num) || {}).name || "" });
      return r.num ? { ok: true } : { error: "booking not found" };
    }
    case "deduct": return st("deduct", { amount: x.amount, why: x.why || "" });
    case "move_date": return st("move", { date: x.date });
    case "edit_booking": { const { num: _n, ...fields } = x; return st("edit", { fields }); }
    case "set_photographer": return st("photographer", { photographer: x.photographer, ...(x.miranda_dollars != null ? { split: { mode: "amt", val: x.miranda_dollars } } : x.miranda_percent != null ? { split: { mode: "pct", val: x.miranda_percent } } : {}) });
    case "photographer_paid_miranda": return st("shooter-paid", { amount: x.amount });
    case "cancel_booking": return st("cancel", x.deposit === "none" ? {} : { deposit: x.deposit });
    case "undo": return st({ deposit: "undo-deposit", paid: "undo-paid", cancel: "undo-cancel", deduct: "undo-deduct", photographer_paid: "undo-shooter-paid" }[x.what]);
    case "add_booking": return post(base, { kind: "direct", ...x, dep: 50, by });
    case "remove_inquiry": {
      const o = inquiries(data, todayCT()).find((i) => low(i.name) === low(x.name) && (i.date || "") === (x.date || ""));
      if (!o) return { error: "no inquiry with that exact name and date" };
      return post(base, { kind: "dismiss", name: o.name, date: o.date, beach: o.beach || "", by, test: !!o.test });
    }
    case "clear_old_inquiries": {
      const old = inquiries(data, todayCT()).filter((o) => o.old);
      if (!old.length) return { ok: true, cleared: 0 };
      return post(base, { kind: "dismiss", items: old.map((o) => ({ name: o.name, date: o.date, beach: o.beach || "", test: !!o.test })), by });
    }
    case "set_day_off": return post(base, { kind: "dayoff", date: x.date, to: x.to || x.date, part: x.part || "all", note: x.note || "", by });
    case "remove_day_off": return post(base, { kind: "dayoff", action: "remove", date: x.date, to: x.to || x.date, ...(x.part ? { part: x.part } : {}), by });
    case "send_confirm_link": return sendConfirmLink(base, x, by, whoName(actor));
    case "remove_pencil": { const { removePencil } = await import("./customers.mjs"); return removePencil(base, x.request_id, { textTimes: !!x.text_other_times, by, who: whoName(actor) }); }
    case "text_customer": return textCustomer(base, x.phone, x.message, data);
    case "offer_other_time": {
      const list = await getRequests(base), r = list.find((q) => q.id === x.request_id);
      if (!r) return { error: "no request with that id" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) return { error: "date must be YYYY-MM-DD" };
      const sent = await textCustomer(base, r.phone, x.message, data);
      if (sent.error) return sent;
      const fresh = await getRequests(base), f = fresh.find((q) => q.id === x.request_id);
      if (f) { f.status = "offered"; f.offer = { date: x.date, time: x.time || f.time, at: new Date().toISOString(), by, who: whoName(actor) }; await saveRequests(base, fresh); }
      return { ok: true, offered: true };
    }
    case "close_request": {
      const list = await getRequests(base), r = list.find((q) => q.id === x.request_id);
      if (!r) return { error: "no request with that id" };
      r.status = "closed"; r.closed = { at: new Date().toISOString(), why: String(x.why || "").slice(0, 200), by, who: whoName(actor) };
      await saveRequests(base, list);
      return { ok: true };
    }
  }
  return { error: "unknown tool" };
}

// ---------- The conversation ----------
async function prices() { const p = { ...PRICES }; delete p._readme; return JSON.stringify(p); }

function system(who, snap, priceList, today) {
  return `You are Sandy, the texting assistant for Miranda Rae Photography, a family and wedding beach photography business on the Florida Gulf Coast (Mexico Beach, Port St. Joe, Cape San Blas, Panama City Beach, St. George Island, Destin, 30A). You are Claude, made by Anthropic, built into the business's website. Your texting number is (448) 217-3502.

You are texting with ${who}.
Randy is Miranda's dad and the administrator; he set you up and helps run the website and ads. Miranda runs the business and does the photography. Bradyn helps Miranda: he can okay customer date requests and update the Bookings app (he also sometimes tests the website as a customer). Kallie Callan is a photographer friend Miranda sometimes hands sessions to.

Your job: keep Miranda's Bookings app (the private /log page) tidy and up to date, and help her stay on top of loose ends — inquiries waiting on her, deposits not in yet, sessions whose date passed but aren't marked paid, photographers who owe her. When she or Randy tells you something, you fix it in the app with your tools.

How you text:
- Plain text only. No markdown, no asterisks, no headings. Short lines; a simple dash list is fine.
- Short and friendly, like a capable assistant who knows the business. Usually under 500 characters. Use first names.
- Only state facts from the snapshot below or from tool results. If you can't find something, say so — never guess or make up bookings, prices or payments.
- When asked to make a change, make it with a tool, then confirm in one line what changed (booking #, name, amount).
- If it's not clear which booking they mean (two with the same name, etc.), ask before changing anything.
- Before cancelling: ask them to confirm, and ask whether Miranda keeps or returns the deposit. Miranda's policy is that deposits aren't refundable, but it's her call case by case.
- If a tool returns a conflict (slot already taken) or an error, tell them plainly and suggest what to do.
- Customers text your number too (Oct 28 2026). Another copy of you answers them: prices, open dates, and taking down date requests. When a customer wants a date, you text Miranda AND Bradyn the details at the same time and ask "Want me to text them the Confirm link? Reply YES or NO".
- First answer decides (Oct 30 2026): if Miranda, Bradyn (or Randy) says yes to a request under CUSTOMER DATE REQUESTS (waiting or PENCILED IN), send it with send_confirm_link, then confirm in one line. If they want something changed first (price, package), send the link with that change. The other person is told automatically that it's handled, so don't text them yourself. If a tool says the request was already answered by someone else, tell them who answered and what happened, and do nothing more.
- Miranda's word wins (Oct 30 2026): if Bradyn okayed a request (listed under LINKS SENT, NO DEPOSIT YET as "okayed by Bradyn") and Miranda says NO to it, handle it exactly like a NO below, using that request_id (it cancels the Confirm link Bradyn's yes sent, and Bradyn is told automatically). Say "after all" in the text to the customer. Bradyn can't overrule Miranda.
- NO, Oct 30 2026 (Randy's rule) — don't ask Miranda what to tell them; handle it right away:
  - Plain NO: look at the calendar (bookings, days off, and other customers' requests listed here) and use text_customer to offer the closest open times: that day's other time (sunrise or sunset) and the next day's same time, or the nearest open ones. Write it like: "So sorry, Miranda can't make Thursday, Nov 26 at sunrise after all. Would Thursday at sunset or Friday, Nov 27 at sunrise work for you?" Say "after all" only when that request was PENCILED IN; otherwise "So sorry, Miranda isn't able to do Thursday, Nov 26 at sunrise." Then close_request (why: "Miranda said no; offered other times"), then tell Miranda in one line what you offered. If they pick one, it comes back to Miranda as a new request.
  - NO with another time she can do ("No, but Friday sunset works"): use offer_other_time with that date and time and a text like "So sorry, Miranda can't make Thursday, Nov 26 at sunrise after all, but she can do Friday, Nov 27 at sunset. Would that work for you? Reply YES and I'll send you the link to save your date." (again, "after all" only if PENCILED IN). If they say yes, they get the Confirm link right away and you'll text Miranda a heads-up. Then tell Miranda in one line it's offered.
- PENCILED IN (Oct 30 2026): if neither Miranda nor Bradyn answers a request within 5 minutes, the customer is automatically texted that they're penciled in and Miranda will send the final confirmation and link later today (or tomorrow, after 6 PM). Miranda and Bradyn get one reminder about anyone still penciled in at 5:00 PM and 8:30 PM, and the 9 AM check-in covers overnight ones. A YES or NO works the same as before. If a booking takes a penciled-in time anyway, the customer is automatically texted other open times and Miranda is told.
- Removing a pencil-in (Oct 30 2026): if Miranda (or Bradyn or Randy) asks you to remove or clear someone's pencil-in, ask "Text them other times?" unless they already said, then use remove_pencil with their answer, and confirm in one line.
- If there's more than one request waiting and it's not clear which one a YES is for, ask.
- Website requests (Oct 28 2026): when someone sends a request form on the website and checks OK to text, you text them to get anything missing, then it comes to Miranda like any other date request. Anything marked TEST came from Randy's, Bradyn's or Miranda's own phone; handle it exactly like a real one (they're testing), and say TEST when you mention it.
- If you're both answering a customer's question and sending their Confirm link, send the answer with text_customer FIRST, then the link, and don't mention the link in that answer (the link text explains itself).
- When Miranda answers a customer's question you passed along (CUSTOMER TEXTS, "waiting on Miranda"), text the customer her answer with text_customer, then tell her it's sent.
- Hand-offs (Oct 30 2026): when a customer is frustrated, confused, going in circles, wants something not on the price list, has a complaint, is a serious wedding or elopement inquiry, or the customer side of you isn't sure, it tells them Miranda will text them personally and texts Miranda "🙋 Please text [name] yourself, [phone]. Wants: ... Why: ..." (shown under CUSTOMER TEXTS as HANDED TO MIRANDA). Miranda texts them from her own phone. If she asks you to tell them something instead, use text_customer.
- Call-back requests (Oct 28 2026): when a customer asks for Miranda to call, the customer side of you asks them a good time, tells them Miranda will call, and texts Miranda "📞 Please call [name], [phone], [time]. ..." (shown under CUSTOMER TEXTS as ASKED MIRANDA TO CALL). If Miranda says she can't call then or wants them told something (e.g. "tell her I'll call tomorrow at noon"), pass it on with text_customer. If she just says she called or "ok", nothing else is needed.
- Days off: when Miranda says she's off (a day, a range, or just a sunrise/sunset), mark it with set_day_off and confirm the dates back. If she's available again, use remove_day_off. Days off are listed under MIRANDA'S DAYS OFF. If a customer request already waiting is on a day she just took off, mention it.
- You can't change the website.
- Deposits are usually $50. Sunrise and sunset are Miranda's main session times.
- Contracted sessions (Kallie or another photographer shooting): only bring up the photographer paying Miranda when that booking is listed under PHOTOGRAPHER OWES MIRANDA. Otherwise they owe her nothing, so don't ask about it.
- Never share passcodes, keys, or the running dollar total unless Randy or Miranda asks about money.

Today is ${nice(today)} (${today}), Central time.

PRICE LIST (website, matches Miranda's Pixieset): ${priceList}

${snap}`;
}

export async function claude(sys, messages, tools = TOOLS) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY isn't set in Netlify yet");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: sys, tools, messages }),
  });
  const j = await r.json();
  if (j.type === "error" || !j.content) { const m = (j.error && j.error.message) || String(r.status); await creditAlarm(m); throw new Error("Claude: " + m); }
  return j;
}

// Oct 28 2026: if Sandy's Claude credits run out, text Randy (once a day) so he can add more
export async function creditAlarm(msg) {
  if (!/credit balance|billing|insufficient/i.test(String(msg || ""))) return;
  try {
    const base = env("URL") || "https://mirandaraephotography.com", s = sandyStore(base), day = todayCT();
    if ((await s.get("credit-alarm", { type: "json" })) === day) return;
    await s.setJSON("credit-alarm", day);
    await deliver(base, "2563996736", "Sandy here: Randy, my Claude credits ran out, so I can't answer texts or calls until more are added. Please add credits at console.anthropic.com (signed in as mirandaraep@gmail.com).", "credit-alarm");
  } catch (e) {}
}

// One message in, one text out. history = [{role, content}] (plain text turns only).
// Returns { reply, changes: [tool calls made], history }
// On a phone call (voice: true) Sandy talks instead of texting, and a change only goes through after the
// caller has just said yes to her reading it back (Randy's rule, Oct 28 2026).
const VOICE_RULES = `

THIS IS A PHONE CALL, NOT A TEXT. These phone rules replace the texting style rules above.
- Your words are read aloud by a speaking voice. Talk naturally in short, plain sentences. No lists, dashes, symbols or abbreviations. Say "booking 112", "Saturday, November 7th", "50 dollars".
- Keep each answer short: one to three sentences. If there's more, give the most important part and ask if they want the rest.
- What you hear comes from speech recognition and can be wrong, especially names, numbers, dates and amounts. If anything sounds off or unclear, ask.
- Before ANY change to the Bookings app: repeat back exactly what you'll do (the name, booking number, and the amount, date or detail) and ask "Should I go ahead?". Do NOT use a tool until their very next answer clearly says yes. If they say no or correct you, repeat the corrected version and ask again.
- After a change goes through, say it's done in one short sentence and that you'll text them a confirmation (the confirmation text is sent automatically).
- When they're finished (they say bye, that's all, thanks that's it), say a short goodbye and end your answer with [HANG UP]. Never use [HANG UP] any other time.`;
const YES = /\b(yes|yeah|yep|yup|ya|sure|correct|right|go ahead|do it|please do|absolutely|ok|okay|affirmative|sounds good)\b/i;
const NO = /^\s*(no|nope|nah|wait|hold on|stop|don't|do not|not)\b/i;
export const saidYes = (t) => YES.test(t) && !NO.test(t);

export async function chat({ base, from, text, history = [], voice = false, page = false }) {
  const person = PEOPLE[digits(from)] || { name: "Someone", role: "an unknown number" };
  const by = "Sandy · " + person.name;
  let data = await loadData(base);
  const today = todayCT();
  const priceList = await prices(base);
  const msgs = history.slice(-16).concat({ role: "user", content: text });
  const changes = [];
  let reply = "";
  // The picture of the app is taken once, when the message comes in. Changes Sandy makes show up in her
  // tool results, so she doesn't mistake her own change for something that was already there.
  const sys = system(person.role, snapshot(data, today).text + "\n\n" + (await customerSection(base, page || !!data.test)) + "\n\n(This snapshot was taken when this message arrived. Changes you make with tools show in the tool results, not here.)", priceList, today) + (voice ? VOICE_RULES : "");
  for (let i = 0; i < 8; i++) {
    const res = await claude(sys, msgs);
    msgs.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((c) => c.type === "tool_use");
    reply = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (!uses.length || res.stop_reason !== "tool_use") break;
    const results = [];
    for (const u of uses) {
      let out;
      if (voice && !saidYes(text)) out = { error: "Not done. On a phone call you must first read the change back and ask 'Should I go ahead?', and only make it after they say yes." };
      else { try { out = await runTool(base, u.name, u.input || {}, by + (voice ? " (call)" : ""), data, digits(from)); } catch (e) { out = { error: String(e.message || e) }; } }
      changes.push({ tool: u.name, input: u.input, result: out });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 4000) });
    }
    msgs.push({ role: "user", content: results });
    data = await loadData(base); // fresh data for the next tool call (e.g. finding an inquiry)
  }
  reply = clean(reply) || "Sorry, I got mixed up there. Could you say that again?";
  const newHist = history.concat({ role: "user", content: text }, { role: "assistant", content: reply }).slice(-20);
  return { reply, changes, history: newHist };
}

// ---------- Live phone calls (added Oct 28 2026) ----------
// Same brain as chat(), but Sandy's words stream out as she thinks them, so the caller hears her start
// talking right away instead of waiting for the whole answer. onText(piece) gets each bit of speech;
// onWorking() is called once if she has to stop and make a change (so the call can say "One sec").
async function claudeStream(sys, messages, onText, signal, maxTokens) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY isn't set yet");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: sys, tools: TOOLS, messages, stream: true }),
  });
  if (!r.ok || !r.body) { let m = r.status; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (e) {} await creditAlarm(m); throw new Error("Claude: " + m); }
  const content = [], json = {};
  let stop = null, buf = "";
  const reader = r.body.getReader(), dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const dl = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dl) continue;
      let e; try { e = JSON.parse(dl.slice(5)); } catch (x) { continue; }
      if (e.type === "content_block_start") { content[e.index] = { ...e.content_block }; if (e.content_block.type === "tool_use") json[e.index] = ""; }
      else if (e.type === "content_block_delta") {
        const b = content[e.index];
        if (e.delta.type === "text_delta") { b.text = (b.text || "") + e.delta.text; onText(e.delta.text); }
        else if (e.delta.type === "input_json_delta") json[e.index] += e.delta.partial_json;
      } else if (e.type === "content_block_stop" && json[e.index] !== undefined) {
        try { content[e.index].input = json[e.index] ? JSON.parse(json[e.index]) : {}; } catch (x) { content[e.index].input = {}; }
      } else if (e.type === "message_delta" && e.delta && e.delta.stop_reason) stop = e.delta.stop_reason;
      else if (e.type === "error") throw new Error("Claude: " + ((e.error && e.error.message) || "stream error"));
    }
  }
  return { content: content.filter(Boolean), stop_reason: stop };
}

// One thing the caller said in, Sandy's spoken answer streamed out. Returns { reply, changes } —
// the caller keeps the call's history (plain text turns) and passes it back in each time.
export async function chatLive({ base, from, text, history = [], onText, onWorking, signal, changes = [] }) {
  const person = PEOPLE[digits(from)] || { name: "Someone", role: "an unknown number" };
  const by = "Sandy · " + person.name + " (call)";
  let data = await loadData(base);
  const today = todayCT();
  const sys = system(person.role, snapshot(data, today).text + "\n\n" + (await customerSection(base, !!data.test)) + "\n\n(This snapshot was taken when this call started talking about this. Changes you make with tools show in the tool results, not here.)", await prices(base), today) + VOICE_RULES + LIVE_RULES;
  const msgs = history.slice(-24).concat({ role: "user", content: text });
  let spoken = "", working = false;
  const say = (t) => { spoken += t; onText(t); };
  for (let i = 0; i < 8; i++) {
    const res = await claudeStream(sys, msgs, say, signal, 700);
    msgs.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((c) => c.type === "tool_use");
    if (!uses.length || res.stop_reason !== "tool_use") break;
    if (!working && onWorking) { working = true; onWorking(); }
    const results = [];
    for (const u of uses) {
      let out;
      if (!saidYes(text)) out = { error: "Not done. On a phone call you must first read the change back and ask 'Should I go ahead?', and only make it after they say yes." };
      else { try { out = await runTool(base, u.name, u.input || {}, by, data, digits(from)); } catch (e) { out = { error: String(e.message || e) }; } }
      changes.push({ tool: u.name, input: u.input, result: out });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 4000) });
    }
    msgs.push({ role: "user", content: results });
    data = await loadData(base);
    if (spoken && !/\s$/.test(spoken)) say(" ");
  }
  return { reply: spoken.trim(), changes };
}
const LIVE_RULES = `
- This is a live back-and-forth call. The caller can talk over you, so start with the answer, and keep it to a sentence or two. Never start with filler like "Great question" or "Let me check".
- If you need to make a change after they said yes, don't announce that you're about to; just do it, then say it's done.`;

// Did a change really go through? (the Bookings app answers ok / num, or error / conflict / duplicate)
export const changeWorked = (c) => { const r = c.result || {}; return !r.error && !r.conflict && !r.duplicate && !r.unchanged && !!(r.ok || r.num); };
// One plain line per change, for the confirmation text after a call
export function describeChange(c, data) {
  const x = c.input || {}, b = ((data && data.bookings) || []).find((y) => y.num === x.num);
  const who = x.num ? "#" + x.num + (b ? " " + b.name : "") + ": " : "";
  switch (c.tool) {
    case "deposit_received": return who + money(x.amount || 50) + " deposit received" + (x.method ? " (" + x.method + ")" : "");
    case "paid_in_full": return who + "marked paid in full" + (x.method ? " (" + x.method + ")" : "");
    case "add_extra": return who + "added " + money(x.amount) + " extra (" + x.what + ")";
    case "deduct": return who + "took " + money(x.amount) + " off" + (x.why ? " (" + x.why + ")" : "");
    case "move_date": return who + "moved to " + nice(x.date);
    case "edit_booking": { const { num: _n, ...f } = x; return who + "changed " + Object.entries(f).map(([k, v]) => k + " to " + (k === "date" ? nice(v) : k === "total" ? money(v) : v)).join(", "); }
    case "set_photographer": return who + "photographer set to " + x.photographer;
    case "photographer_paid_miranda": return who + "photographer paid Miranda " + money(x.amount);
    case "cancel_booking": return who + "cancelled" + (x.deposit === "keep" ? " (Miranda keeps the deposit)" : x.deposit === "return" ? " (deposit returned)" : "");
    case "undo": return who + "undid the last " + String(x.what).replace("_", " ");
    case "add_booking": return "New booking: " + [x.name, x.date ? nice(x.date) : "", x.time, x.beach, money(x.amount)].filter(Boolean).join(", ");
    case "remove_inquiry": return "Inquiry removed: " + x.name + (x.date ? " (" + nice(x.date) + ")" : "");
    case "clear_old_inquiries": return "Cleared " + ((c.result && c.result.cleared) || "the") + " old inquiries";
    case "send_confirm_link": return "Confirm link texted to " + ((c.result && c.result.name) || x.name || "the customer");
    case "text_customer": return "Texted " + fmtPhone(x.phone);
    case "close_request": return "Request closed";
    case "offer_other_time": return "Offered " + nice(x.date) + " " + x.time + " to the customer";
    case "remove_pencil": return "Pencil-in removed" + (x.text_other_times ? ", other times texted" : "");
    case "set_day_off": return "Day off: " + nice(x.date) + (x.to && x.to !== x.date ? " to " + nice(x.to) : "") + (x.part && x.part !== "all" ? " (" + x.part + ")" : "");
    case "remove_day_off": return "Available again: " + nice(x.date) + (x.to && x.to !== x.date ? " to " + nice(x.to) : "");
  }
  return c.tool;
}

// Morning check-in for Miranda. Returns null when there's nothing worth texting.
export async function dailyCheckin({ base, history = [] }) {
  const data = await loadData(base);
  const today = todayCT();
  const snap = snapshot(data, today);
  const waiting = (await getRequests(base)).filter((r) => (r.status === "waiting" || r.status === "penciled") && (!!data.test || !r.test)).length;
  if (!snap.counts.loose && !snap.counts.today && !snap.counts.tomorrow && !waiting) return null;
  const sys = system(PEOPLE[MIRANDA].role, snap.text + "\n\n" + (await customerSection(base, !!data.test)), await prices(base), today);
  const ask = "[Automatic morning check-in — this message is from the system, not Miranda.] Write today's check-in text to Miranda. Start with a short greeting. Then: today's and tomorrow's sessions in one line each (if any), then the loose ends that need her (customer date requests waiting on her YES, inquiries she hasn't sent a Confirm link to, confirmed sessions with no deposit, past sessions not marked paid, photographers who owe her). Number the loose ends so she can answer by number, and ask simple questions she can answer by text (e.g. 'Did the Smiths pay the rest?') so you can fix the app for her. Group, don't list more than 6; say how many more if there are. Keep it under 700 characters. Don't use any tools now.";
  const res = await claude(sys, history.slice(-10).concat({ role: "user", content: ask }));
  const reply = clean(res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"));
  if (!reply) return null;
  // Saved as Sandy's own text so Miranda can simply reply to it
  return { reply, counts: snap.counts, history: history.concat({ role: "user", content: "[Morning check-in]" }, { role: "assistant", content: reply }).slice(-20) };
}

// Strip any markdown that slipped through; texts are plain
export const clean = (s) => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").replace(/`/g, "").trim().slice(0, 1500);

// ---------- Texting (Twilio) ----------
export const textingOn = () => env("SANDY_TEXTING").toLowerCase() === "on";
export async function sendText(to, body) {
  const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN");
  if (!sid || !tok) throw new Error("Twilio keys aren't set in Cloudflare yet");
  const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(sid + ":" + tok), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: "+1" + digits(to), From: SANDY_NUMBER, Body: body }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Twilio: " + (j.message || r.status));
  return j.sid;
}

// Keeps each person's conversation, and a list of every text Sandy sent (or would have sent)
export async function getHistory(base, phone) { return (await sandyStore(base).get("chat-" + digits(phone), { type: "json" })) || []; }
export async function saveHistory(base, phone, h) { await sandyStore(base).setJSON("chat-" + digits(phone), h.slice(-20)); }
export async function record(base, entry) {
  const s = sandyStore(base);
  const list = (await s.get("outbox", { type: "json" })) || [];
  list.push({ at: new Date().toISOString(), ...entry });
  await s.setJSON("outbox", list.slice(-200));
}
// Deliver a text: really sends only when SANDY_TEXTING is "on" and this is the live site
export async function deliver(base, to, body, kind) {
  let sent = false, error = "";
  if (textingOn() && isLive(base) && digits(to) !== TEST_CUSTOMER) { try { await sendText(to, body); sent = true; } catch (e) { error = String(e.message || e); } }
  await record(base, { kind, to: digits(to), body, sent, ...(error ? { error } : {}) });
  return { sent, error };
}

// ---------- Customers (added Oct 28 2026) ----------
// Date requests customers make by texting Sandy wait here for Miranda's YES before a Confirm link goes out.
export async function getRequests(base) { return (await sandyStore(base).get("requests", { type: "json" })) || []; }
export async function saveRequests(base, list) { await sandyStore(base).setJSON("requests", list.slice(-150)); }
// One line per customer who texted Sandy: name (once known), last thing they said, questions waiting on Miranda
export async function getCustomers(base) { return (await sandyStore(base).get("customers", { type: "json" })) || {}; }
export async function noteCustomer(base, phone, patch) {
  const s = sandyStore(base), all = (await s.get("customers", { type: "json" })) || {}, k = digits(phone);
  all[k] = { ...(all[k] || { first: new Date().toISOString() }), ...patch, at: new Date().toISOString() };
  const keep = Object.entries(all).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 300);
  await s.setJSON("customers", Object.fromEntries(keep));
}

// Price list lookups (prices.json is the master list)
const PK = Object.values(PRICES.packages || {});
export function findPackage(name) {
  const n = low(name).replace(/^\$\d+\s*/, "");
  if (!n) return null;
  return PK.find((p) => low(p.booking) === n || low(p.name) === n) ||
    PK.find((p) => n.includes(low(p.booking).split(" (")[0]) || low(p.booking).includes(n)) || null;
}
export const travelFee = (beach) => { const t = PRICES.travel || {}; const k = Object.keys(t).find((b) => low(beach).includes(low(b))); return k ? t[k] : 0; };
export const longDay = (ymd) => { try { return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); } catch (e) { return ymd; } };
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

// What Miranda's side of Sandy sees about customers
export async function customerSection(base, withTests) {
  const reqs = (await getRequests(base)).filter((r) => withTests || !r.test);
  const waiting = reqs.filter((r) => r.status === "waiting" || r.status === "penciled");
  const offered = reqs.filter((r) => r.status === "offered" && r.offer && r.at > new Date(Date.now() - 7 * 86400000).toISOString());
  // Oct 30 2026: links that went out in the last 7 days, so Miranda can still say no to one Bradyn okayed
  const linked = reqs.filter((r) => r.status === "link sent" && r.sent && r.date >= todayCT() && (r.sent.at || "") > new Date(Date.now() - 7 * 86400000).toISOString());
  const cust = Object.entries(await getCustomers(base)).filter(([p, c]) => (withTests || !c.test) && c.at > new Date(Date.now() - 7 * 86400000).toISOString());
  const rq = (r) => "- request_id " + r.id + ": " + [r.name, fmtPhone(r.phone), r.date ? nice(r.date) : "", r.time, r.beach, r.pkg, money(r.price) + (r.travel ? " (incl. " + money(r.travel) + " travel fee)" : ""), r.people ? r.people + " people" : "", r.notes ? "notes: " + r.notes : "", "asked " + daysAgo(r.at, todayCT()), r.status === "penciled" ? "PENCILED IN (customer was told Miranda will send the final confirmation and link later)" : "", r.test || r.mark ? "TEST" : ""].filter(Boolean).join(" · ");
  const cl = ([p, c]) => "- " + [c.name || "name not given", fmtPhone(p), "last text " + daysAgo(c.at, todayCT()) + ': "' + String(c.last || "").slice(0, 120) + '"', c.waiting ? 'WAITING ON MIRANDA: "' + c.waiting + '"' : "", c.handoffAt && c.handoffAt > new Date(Date.now() - 3 * 86400000).toISOString() ? "HANDED TO MIRANDA " + daysAgo(c.handoffAt, todayCT()) + " (" + (c.handoffWhy || "") + "): she texts them herself" : "", c.callback && c.callbackAt > new Date(Date.now() - 3 * 86400000).toISOString() ? "ASKED MIRANDA TO CALL " + daysAgo(c.callbackAt, todayCT()) + ", " + c.callback + (c.callbackAbout ? " (" + c.callbackAbout + ")" : "") : "", c.test || isOurs(p) ? "TEST" : ""].filter(Boolean).join(" · ");
  return "CUSTOMER DATE REQUESTS WAITING ON A YES FROM MIRANDA OR BRADYN (" + waiting.length + "):\n" + (waiting.length ? waiting.map(rq).join("\n") : "- none") +
    (linked.length ? "\n\nLINKS SENT, NO DEPOSIT YET (Confirm link texted; Miranda can still say no):\n" + linked.map((r) => rq(r) + " · okayed by " + ((r.sent && r.sent.who) || "Miranda") + " " + daysAgo(r.sent.at, todayCT())).join("\n") : "") +
    (offered.length ? "\n\nOTHER TIMES MIRANDA OKAYED, WAITING ON THE CUSTOMER (" + offered.length + "):\n" + offered.map((r) => rq(r) + " · offered " + nice(r.offer.date) + " " + r.offer.time + " instead").join("\n") : "") +
    "\n\nCUSTOMER TEXTS (last 7 days, " + cust.length + "):\n" + (cust.length ? cust.map(cl).join("\n") : "- none");
}

// Text Miranda something about a customer, and keep it in her conversation so she can just reply YES
export async function notifyMiranda(base, text, { page = false } = {}) {
  const key = page ? "page-" + MIRANDA : null;
  if (page) {
    const s = sandyStore(base), h = (await s.get(key, { type: "json" })) || [];
    await s.setJSON(key, h.concat({ role: "user", content: "[Customer update]" }, { role: "assistant", content: text }).slice(-20));
    await record(base, { kind: "to-miranda-test", to: MIRANDA, body: text, sent: false });
    return;
  }
  await saveHistory(base, MIRANDA, (await getHistory(base, MIRANDA)).concat({ role: "user", content: "[Customer update]" }, { role: "assistant", content: text }));
  await deliver(base, MIRANDA, text, "to-miranda");
}

// Text one staff member (Miranda or Bradyn), kept in their conversation so they can just reply YES (Oct 30 2026)
export async function tellStaff(base, phone, text, { page = false } = {}) {
  const p = digits(phone);
  if (page) {
    const s = sandyStore(base), key = "page-" + p, h = (await s.get(key, { type: "json" })) || [];
    await s.setJSON(key, h.concat({ role: "user", content: "[Customer update]" }, { role: "assistant", content: text }).slice(-20));
    await record(base, { kind: "to-staff-test", to: p, body: text, sent: false });
    return;
  }
  await saveHistory(base, p, (await getHistory(base, p)).concat({ role: "user", content: "[Customer update]" }, { role: "assistant", content: text }));
  await deliver(base, p, text, "to-staff");
}
// Text Miranda and Bradyn the same thing at the same time (Oct 30 2026). One right after the other (a second
// apart at most), so the shared list of sent texts never loses one.
export async function notifyStaff(base, text, opts = {}) {
  for (const p of STAFF) await tellStaff(base, p, text, opts);
}

// Add Sandy's own text to a customer's conversation so she remembers it when they answer
export async function addToCustomer(base, phone, text) {
  const s = sandyStore(base), k = custKey(phone), h = (await s.get(k, { type: "json" })) || [];
  // keep turns alternating: a text Sandy sends on her own follows a placeholder turn
  const add = h.length && h[h.length - 1].role === "user" ? [{ role: "assistant", content: text }] : [{ role: "user", content: "[No new text from the customer]" }, { role: "assistant", content: text }];
  await s.setJSON(k, h.concat(add).slice(-20));
}

export async function textCustomer(base, phone, message, data) {
  const p = digits(phone), body = String(message || "").trim().slice(0, 1200);
  if (p.length !== 10 || !body) return { error: "need a 10-digit phone and a message" };
  if (PEOPLE[p] && !(await customerMode(base, p))) return { error: "that's Randy's or Miranda's number, not a customer" };
  const known = !!(await getCustomers(base))[p] || ((data && data.bookings) || []).some((b) => digits(b.phone) === p) || ((data && data.log) || []).some((e) => digits(e.phone) === p);
  if (!known) return { error: "that number hasn't texted me and isn't in the bookings, so I can't text it" };
  const r = await deliver(base, p, body, "to-customer");
  await addToCustomer(base, p, body);
  await noteCustomer(base, p, { waiting: "" });
  return r.error ? { error: "Twilio: " + r.error } : { ok: true, ...(p === TEST_CUSTOMER ? { pretend_customer: "test only, counts as sent" } : { sent: r.sent }) };
}

// Oct 30 2026: Sandy only texts people who agreed: they texted her number, or checked "OK to text" on a website form
export async function okToText(base, phone) {
  const p = digits(phone);
  if ((await getCustomers(base))[p]) return true;
  return !!(await sandyStore(base).get("ok-text-" + p, { type: "json" }));
}

export async function sendConfirmLink(base, x, by, who = "") {
  const list = await getRequests(base), r = x.request_id ? list.find((q) => q.id === x.request_id) : null;
  if (x.request_id && !r) return { error: "no request with that id" };
  const o = { ...(r || {}), ...Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== undefined && v !== "" && k !== "request_id")) };
  const phone = digits(o.phone);
  if (!o.name || phone.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(o.date || "")) return { error: "need the customer's name, 10-digit phone and the date" };
  const p = findPackage(o.pkg);
  const price = Number(o.price) || (p ? p.price + travelFee(o.beach) : 0);
  if (!price) return { error: "which package or price?" };
  const dep = Number(o.deposit) || Math.min(PRICES.deposit || 50, price);
  // Same Confirm link the Bookings page and New Booking make
  const lk = { v: 1, n: o.name, d: o.date, t: o.time || "Sunset", b: o.beach || "Other", pk: p ? p.booking : o.pkg || "Custom session", base: price,
    len: p ? [p.timeWords && p.timeWords.charAt(0).toUpperCase() + p.timeWords.slice(1), ...(p.details || []).filter((d) => /outfit|location/.test(d))].filter(Boolean).join(" · ") : "",
    ppl: p ? p.bookingPeople || (p.people ? "Up to " + p.people : "") : "", ph: p ? p.photos || (/wedding/i.test(p.booking) ? "Full gallery" : "") : "",
    x: [], dc: 0, dr: "", note: "", by: "Sandy", total: price };
  if (dep !== 50) lk.dep = dep;
  const url = base.replace(/\/$/, "") + "/confirm?s=" + Buffer.from(JSON.stringify(lk), "utf8").toString("base64url");
  if (phone !== TEST_CUSTOMER && !(await okToText(base, phone)))
    return { error: lk.n + " never texted me or checked OK to text, so I can't text them. Tell Miranda to send it from her own phone, and give her this Confirm link to paste: " + url };
  // Tell the Bookings app first (so the card shows "Link texted"), like the Bookings page does
  await post(base, { kind: "pending", by: "Sandy", name: lk.n, date: lk.d, beach: lk.b, phone, time: lk.t, pkg: lk.pk, amount: price, dep, link: url });
  const t = low(lk.t), slot = t && t !== "other" && t !== "wedding" ? " (" + t + ")" : "", place = lk.b && lk.b !== "Other" ? " at " + lk.b : "";
  // Oct 30 2026: Miranda okayed it; the date isn't held until the deposit is in
  const body = "Hi " + firstName(lk.n) + "! It's Sandy with Miranda Rae Photography. Good news, Miranda okayed " + longDay(lk.d) + place + slot + " for your " + money(price) + " " + lk.pk + "! " +
    "Check your session details, then tap Confirm and pay your " + money(dep) + " deposit to secure your date: " + url + "\n\nJust so you know, your date isn't held until the deposit is in. Any questions, just text me back!";
  const d = await deliver(base, phone, body, "confirm-link");
  await addToCustomer(base, phone, body);
  if (r) { r.status = "link sent"; r.sent = { at: new Date().toISOString(), by, price, who: who || "Miranda", n: lk.n, d: lk.d, b: lk.b }; await saveRequests(base, list); }
  return d.error ? { error: "link made but the text didn't go: " + d.error } : { ok: true, name: lk.n, price, ...(phone === TEST_CUSTOMER ? { pretend_customer: "test only, counts as sent" } : { sent: d.sent }) };
}
