// Private booking counter (added Oct 10 2026).
// Gives each confirmed session a booking number (#101, #102, ...) and keeps a
// running dollar total of confirmed sessions. The total only goes into
// the emails to Randy and Miranda; clients never see it on screen.
// Live site uses the "booking-counter" store; test copies use "booking-counter-test".
//
// Oct 14 2026 changes:
// - Only the Confirm page adds to the total. Add-ons are emailed but no longer change it.
// - Tests are never counted: a name with the word "test" in it, or Randy's, Miranda's or
//   Bradyn's phone number (the client's mobile Miranda types on the New Booking page).
// - "Contracting out" (New Booking page): Miranda can hand a session to another photographer
//   (e.g. Kallie). The photographer's name and pay are saved here when Miranda sends the link
//   (never put in the client's link), then counted when the client confirms.
// - One-time cleanup of the live numbers (tests and a double-counted booking removed).
import { getStore } from "@netlify/blobs";

const START = 100; // first booking becomes #101
// Phone numbers that mean "this is a test" (last 10 digits)
const TEST_PHONES = ["2563996736", "2566134522", "4482196539"]; // Randy, Bradyn, Miranda
const DEFAULT_PHOTOGRAPHERS = ["Kallie"];
// Split for contracted-out sessions (Oct 15 2026): Miranda's share is a percentage of the session
// (default 25%, or $50 if that's more) or a dollar amount she types. The photographer gets the rest,
// and add-ons are split the same way. Miranda can change the usual percentage from the New Booking page.
const DEFAULT_SPLIT = { pct: 25, min: 50 };
const cleanSplit = (s) => {
  if (!s || typeof s !== "object") return null;
  const val = Number(s.val);
  if (!isFinite(val) || val < 0) return null;
  if (s.mode === "amt") return { mode: "amt", val: Math.min(val, 10000) };
  const min = Number(s.min);
  return { mode: "pct", val: Math.min(val, 100), ...(isFinite(min) && min > 0 ? { min: Math.min(min, 10000) } : {}) };
};
// Miranda's share of a contracted session total (never more than the total)
const shareOf = (split, total) => {
  if (!split) return null;
  const t = Math.max(0, total || 0);
  const v = split.mode === "amt" ? split.val : Math.max(t * split.val / 100, split.min || 0);
  return cents(Math.min(t, v));
};

const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const isTestName = (v) => /\btest\b/i.test(String(v || ""));
const isTestPhone = (v) => { const d = digits(v); return d.length === 10 && TEST_PHONES.includes(d); };
const keyOf = (d) => [d.name, d.date, d.beach].map((v) => String(v || "").trim().toLowerCase()).join("|");
const cents = (n) => Math.round(n * 100) / 100;
const cleanMoney = (v) => { const n = Number(String(v || "0").replace(/[^0-9.]/g, "")); return isFinite(n) && n >= 0 && n <= 10000 ? n : 0; };
const json = (o) => Response.json(o, { headers: { "Cache-Control": "no-store" } });

// Master page (Oct 15 2026): every booking and entry is also kept as a list, shown on the private
// /log page behind a passcode. Times are labels (Sunrise, Sunset...), so the slot check treats the
// same date + same time as taken, and a Wedding as taking the whole day.
// Only a SHA-256 fingerprint of the passcode is kept here (this code is public on GitHub).
const PASS_SHA256 = "7520b1eea1d95304e8ae042ee214edcc352583b8a4101ce34c54bb20d5915b30";
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const okPass = async (req, data) => (await sha((req.headers.get("x-pass") || (data && data.pass) || "").trim().toLowerCase())) === PASS_SHA256;
const day = (v) => String(v || "").slice(0, 10);
// Oct 15 2026: a Wedding no longer blocks the whole day. A wedding only clashes with another wedding;
// a session on a wedding day still confirms, and Miranda gets a heads-up in the email to check the timing.
const clash = (a, b) => day(a.date) && day(a.date) === day(b.date) && String(a.time || "").toLowerCase() === String(b.time || "").toLowerCase();
const weddingDay = (a, b) => day(a.date) && day(a.date) === day(b.date) && (/wedding/i.test(a.time || "") !== /wedding/i.test(b.time || ""));
const clip = (v, n = 120) => String(v == null ? "" : v).slice(0, n);

function summary(state, live) {
  const payouts = cents(state.payouts || 0);
  return {
    total: state.total, count: state.count,
    contracted: state.contracted || 0, payouts, keeps: cents(state.total - payouts),
    test: !live,
  };
}

export default async (req) => {
  const host = new URL(req.url).hostname.replace(/^www\./, "");
  const live = host === "mirandaraephotography.com";
  // "strong" = always read the very latest numbers, so two quick entries can't overwrite each other
  const store = getStore({ name: live ? "booking-counter" : "booking-counter-test", consistency: "strong" });
  const state = (await store.get("state", { type: "json" })) || { last: START, total: 0, count: 0, addons: 0 };

  // Photographer names for the New Booking page's one-tap buttons (names only, no numbers)
  const getList = async (k) => (await store.get(k, { type: "json" })) || [];
  const logIt = async (e) => {
    const log = await getList("log");
    log.push({ at: new Date().toISOString(), ...e });
    await store.setJSON("log", log.slice(-1000));
  };
  // One-time load (Oct 15 2026): real bookings confirmed before the Bookings log started, copied from
  // the confirmation emails. Goes on the log page only; the running total already counted them.
  // Left out: tests #104/#105/#107, Ava Allen's double #103, and #110 (Brianna Smith's second tap).
  if (live && !state.importOct15) {
    const list = await getList("bookings"), now = new Date().toISOString();
    const early = [
      { num: 98, name: "Lauren Kays", date: "2026-10-17", time: "Sunrise", beach: "Mexico Beach", pkg: "Beach Mini", total: 130 },
      { num: 99, name: "Veronica Kemmerer", date: "2026-10-13", time: "Sunrise", beach: "Port St. Joe", pkg: "Beach Mini", total: 130 },
      { num: 101, name: "Victoria Waldner", date: "2026-10-28", time: "Sunrise", beach: "Cape San Blas", pkg: "Beach Mini", total: 130 },
      { num: 102, name: "Ava Allen", date: "2026-10-23", time: "Sunset", beach: "30A", pkg: "Beach Special", total: 199 },
      { num: 106, name: "Ashley Carter", date: "2026-10-10", time: "Sunset", beach: "Mexico Beach", pkg: "Beach Mini", total: 130, by: "Miranda", deposit: { amount: 50, method: "Venmo", at: "2026-10-13T14:38:00Z", by: "Deposit page" } },
      { num: 108, name: "Brianna Smith", date: "2026-10-25", time: "Sunrise", beach: "30A", pkg: "Beach Special + Travel Fee", total: 229, by: "Miranda" },
      { num: 109, name: "Taylor Ransdell", date: "2026-10-14", time: "Sunset", beach: "Other", pkg: "Beach Mini", total: 130 },
      { num: 111, name: "andrea stumpf", date: "2026-10-18", time: "Sunrise", beach: "Panama City Beach", pkg: "Beach Special", total: 199, by: "Miranda", deposit: { amount: 50, method: "Venmo", at: "2026-10-15T18:00:55Z", by: "Deposit page" } },
    ];
    let added = 0;
    for (const b of early) {
      if (list.some((x) => x.num === b.num)) continue;
      list.push({ key: keyOf(b), by: "", phone: "", photographer: "", payout: 0, test: false, created: now, imported: true, ...b });
      added++;
    }
    list.sort((x, y) => (x.num || 0) - (y.num || 0));
    await store.setJSON("bookings", list.slice(-500));
    state.importOct15 = now + " (" + added + " added)";
    await store.setJSON("state", state);
  }

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("log")) {
    if (!(await okPass(req))) return json({ error: "passcode" });
    return json({ bookings: await getList("bookings"), log: (await getList("log")).slice(-300), test: !live });
  }
  if (req.method === "GET") {
    const list = Array.isArray(state.photographers) && state.photographers.length ? state.photographers : DEFAULT_PHOTOGRAPHERS;
    return json({ photographers: list, split: state.splitDefault || DEFAULT_SPLIT });
  }
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  // One-time cleanup (Oct 14 2026), live numbers only. Before: $1,399 from 9 sessions + 3 add-ons,
  // deposits $100 from 2. Removed: tests #104 ($219) and #107 ($130), Ava Allen's double #103 ($199),
  // Bradyn #105 set to $0 (-$160), Taylor #109 set to a $130 Mini (+$130), the three $1 test add-ons,
  // and Bradyn's $50 deposit. After: $818 from 6 sessions, deposits $50 from 1.
  if (live && !state.fixOct14) {
    state.total = cents(state.total - 581);
    state.count = Math.max(0, state.count - 3);
    state.addons = 0;
    state.deposits = cents(Math.max(0, (state.deposits || 0) - 50));
    state.depositCount = Math.max(0, (state.depositCount || 0) - 1);
    state.fixOct14 = new Date().toISOString();
  }

  let data = {};
  try { data = await req.json(); } catch (e) {}
  // Master page buttons: Deposit Received / Paid in Full / Cancel (+ undo)
  if (data.kind === "status") {
    if (!(await okPass(req, data))) return json({ error: "passcode" });
    const list = await getList("bookings");
    const b = list.find((x) => x.num === parseInt(data.num, 10));
    if (!b) return json({ error: "not found" });
    const now = new Date().toISOString(), who = clip(data.by, 40);
    const a = data.action;
    if (a === "deposit") b.deposit = { amount: cleanMoney(data.amount) || 50, method: clip(data.method, 30) || "Venmo", at: now, by: who };
    else if (a === "undo-deposit") delete b.deposit;
    else if (a === "paid") b.paid = { amount: cents(Math.max(0, (b.total || 0) + (b.addons || 0) - ((b.deposit && b.deposit.amount) || 0))), method: clip(data.method, 30), at: now, by: who };
    else if (a === "undo-paid") delete b.paid;
    else if (a === "cancel") b.cancelled = { at: now, by: who };
    else if (a === "undo-cancel") delete b.cancelled;
    else return json({ error: "action" });
    await store.setJSON("bookings", list);
    await logIt({ kind: a, num: b.num, name: b.name, amount: a === "deposit" ? b.deposit.amount : a === "paid" ? b.paid.amount : 0, by: who, test: !!b.test });
    return json({ ok: true, booking: b });
  }
  // Master page "Clear all tests" button (Oct 15 2026): removes test bookings and test entries from
  // the master page only. Real bookings, totals and booking numbers are never touched.
  if (data.kind === "clear-tests") {
    if (!(await okPass(req, data))) return json({ error: "passcode" });
    const list = await getList("bookings"), log = await getList("log");
    const keepB = list.filter((b) => !b.test), keepL = log.filter((e) => !e.test);
    await store.setJSON("bookings", keepB);
    await store.setJSON("log", keepL);
    return json({ ok: true, removed: (list.length - keepB.length) + (log.length - keepL.length) });
  }
  // New Booking page "Make this the usual" (Oct 15 2026): saves Miranda's usual percentage
  if (data.kind === "split-default") {
    const pct = Number(data.pct);
    if (!isFinite(pct) || pct < 0 || pct > 100) return json({ error: "pct" });
    state.splitDefault = { pct: Math.round(pct * 100) / 100, min: (state.splitDefault || DEFAULT_SPLIT).min };
    state.updated = new Date().toISOString(); await store.setJSON("state", state);
    await logIt({ kind: "split-default", detail: "Usual split now " + state.splitDefault.pct + "% to Miranda", by: clip(data.by, 40) });
    return json({ ok: true, split: state.splitDefault });
  }
  // A "Check My Date" request from any page on the site (logged only, never counted)
  if (data.kind === "request") {
    await logIt({ kind: "request", name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), detail: clip(data.detail), test: isTestName(data.name) || isTestPhone(data.phone) });
    return json({ ok: true });
  }
  const kinds = ["confirm", "addon", "deposit", "pending"];
  const kind = kinds.includes(data.kind) ? data.kind : "confirm";
  const amount = cleanMoney(data.amount);
  const ref = parseInt(String(data.ref || "").replace(/\D/g, ""), 10);
  const save = async () => { state.updated = new Date().toISOString(); await store.setJSON("state", state); };

  // New Booking page: Miranda sent (or previewed) a Confirm link. Remember the client's phone and,
  // if she's contracting the session out, who's shooting it and what they're paid.
  if (kind === "pending") {
    const key = keyOf(data);
    if (key.replace(/\|/g, "")) {
      state.pending = (state.pending || []).filter((p) => p.key !== key);
      const p = { key, at: new Date().toISOString() };
      if (isTestPhone(data.phone)) p.testPhone = true;
      p.by = clip(data.by, 40); p.phone = digits(data.phone);
      const who = String(data.photographer || "").trim().slice(0, 60);
      if (who) {
        p.photographer = who;
        p.split = cleanSplit(data.split);
        if (!p.split) p.payout = cleanMoney(data.payout); // older New Booking pages sent a dollar payout
        const names = Array.isArray(state.photographers) && state.photographers.length ? state.photographers : DEFAULT_PHOTOGRAPHERS.slice();
        if (!names.some((n) => n.toLowerCase() === who.toLowerCase())) names.push(who);
        state.photographers = names.slice(-12);
      }
      state.pending.push(p);
      if (state.pending.length > 200) state.pending = state.pending.slice(-200);
      await save();
      await logIt({ kind: "sent", name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), by: p.by, detail: p.photographer ? "Shot by " + p.photographer : "", test: !!(p.testPhone || isTestName(data.name)) });
    }
    return json({ ok: true });
  }

  // Deposit Received page: kept in its own total, never added to the bookings total. Tests not counted.
  if (kind === "deposit") {
    const num = ref > START ? ref : null;
    if (isTestName(data.name) || isTestPhone(data.phone)) {
      await save();
      return json({ num, notCounted: "test", deposits: state.deposits || 0, depositCount: state.depositCount || 0, test: !live });
    }
    if (num) {
      const list = await getList("bookings"), b = list.find((x) => x.num === num);
      if (b && !b.deposit) { b.deposit = { amount, method: clip(data.method, 30), at: new Date().toISOString(), by: "Deposit page" }; await store.setJSON("bookings", list); }
    }
    await logIt({ kind: "deposit", num, name: clip(data.name, 60), amount, detail: clip(data.method, 30) });
    state.deposits = cents((state.deposits || 0) + amount);
    state.depositCount = (state.depositCount || 0) + 1;
    await save();
    return json({ num, deposits: state.deposits, depositCount: state.depositCount, test: !live });
  }

  // Add-On page: emailed to both inboxes, but no longer added to the total (Oct 14 2026)
  if (kind === "addon") {
    if (ref > START) {
      const list = await getList("bookings"), b = list.find((x) => x.num === ref);
      if (b) {
        b.addons = cents((b.addons || 0) + amount);
        if (b.split) b.payout = cents((b.total || 0) + b.addons - shareOf(b.split, (b.total || 0) + b.addons));
        await store.setJSON("bookings", list);
      }
    }
    await logIt({ kind: "addon", num: ref > START ? ref : null, name: clip(data.name, 60), amount, detail: clip(data.what) });
    await save();
    return json({ num: ref > START ? ref : null, ...summary(state, live) });
  }

  // Confirm page
  const key = keyOf(data);
  const pend = (state.pending || []).find((p) => p.key === key) || null;
  // Photographer's pay for a contracted session: the session total minus Miranda's share
  if (pend && pend.photographer && pend.split) pend.payout = cents(amount - shareOf(pend.split, amount));
  const isTest = isTestName(data.name) || isTestPhone(data.phone) || !!(pend && pend.testPhone);
  const bookings = await getList("bookings");
  // Who's shooting decides whose time it is (Oct 15 2026): a session contracted out (e.g. to Kallie)
  // doesn't block Miranda's times, and only clashes with that same photographer's other sessions.
  const me = { date: data.date, time: clip(data.time, 30), photographer: (pend && pend.photographer) || "" };
  const sameShooter = (b) => String(b.photographer || "").toLowerCase() === String(me.photographer || "").toLowerCase();
  // Slot check: someone else already holds this date + time (tests only clash with tests)
  const taken = bookings.find((b) => !b.cancelled && b.key !== key && !!b.test === isTest && sameShooter(b) && clash(b, me));
  if (taken && !data.force) {
    await logIt({ kind: "slot-taken", name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), detail: (me.time || "") + " already held by #" + taken.num + " " + taken.name, test: isTest });
    return json({ conflict: true, with: taken.num });
  }
  const near = bookings.find((b) => !b.cancelled && b.key !== key && !!b.test === isTest && sameShooter(b) && weddingDay(b, me));
  const headsUp = near ? "Same day as #" + near.num + " " + near.name + "'s " + (/wedding/i.test(near.time || "") ? "wedding" : (near.time || "session")) + " — check the timing" : "";
  const keepBooking = async (num) => {
    if (bookings.some((b) => b.key === key && !b.cancelled)) return;
    bookings.push({ key, num, name: clip(data.name, 60), date: day(data.date), time: me.time, beach: clip(data.beach, 40),
      pkg: clip(data.pkg, 60), total: amount, by: clip((pend && pend.by) || data.by, 40), phone: pend && pend.phone || "",
      photographer: pend && pend.photographer || "", payout: pend && pend.payout || 0, ...(pend && pend.photographer && pend.split ? { split: pend.split } : {}), test: isTest, created: new Date().toISOString() });
    await store.setJSON("bookings", bookings.slice(-500));
    await logIt({ kind: "confirm", num, name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), amount, by: (pend && pend.by) || "", detail: headsUp, test: isTest });
  };
  if (isTest) {
    // Tests get their own T-numbers on the master page and never touch the totals
    state.lastTest = (state.lastTest || 0) + 1;
    const tnum = 900000 + state.lastTest;
    await save();
    await keepBooking(tnum);
    return json({ num: null, notCounted: "test", headsUp, ...summary(state, live) });
  }
  // Same client confirming the same date + beach again (e.g. tapped the link twice): give back the
  // same booking number and don't add the price again (added Oct 12 2026).
  state.recent = Array.isArray(state.recent) ? state.recent : [];
  const seen = key.replace(/\|/g, "") ? state.recent.find((r) => r.key === key) : null;
  if (seen) {
    await save();
    return json({ num: seen.num, repeat: true, photographer: seen.photographer || null, payout: seen.payout || 0, ...summary(state, live) });
  }
  state.last += 1;
  const rec = { key, num: state.last };
  if (pend && pend.photographer) {
    rec.photographer = pend.photographer;
    rec.payout = pend.payout || 0;
    state.contracted = (state.contracted || 0) + 1;
    state.payouts = cents((state.payouts || 0) + rec.payout);
  }
  state.recent.push(rec);
  if (state.recent.length > 200) state.recent = state.recent.slice(-200);
  state.count += 1;
  state.total = cents(state.total + amount);
  await save();
  await keepBooking(rec.num);
  return json({ num: rec.num, photographer: rec.photographer || null, payout: rec.payout || 0, headsUp, ...summary(state, live) });
};

export const config = { path: "/api/booking-counter" };
