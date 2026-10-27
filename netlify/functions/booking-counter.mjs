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
const PASS_SHA256 = "37ba3881108bf3e48180350246c5959b9481633d0cb1d8694fb141dc74e5fe79";
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
// Sandy (Oct 21 2026): Miranda's texting assistant reads and changes bookings through this same code,
// using her own password, kept in the site's private storage (made by netlify/sandy/brain.mjs), never in this file.
const sandyOk = async (req) => { const h = req.headers.get("x-sandy-key"); if (!h) return false; const k = await getStore({ name: "sandy-secret", consistency: "strong" }).get("key"); return !!k && k.length >= 20 && h === k; };
const okPass = async (req, data) => (await sandyOk(req)) || (await sha((req.headers.get("x-pass") || (data && data.pass) || "").trim().toLowerCase())) === PASS_SHA256;
const day = (v) => String(v || "").slice(0, 10);
// Oct 15 2026: a Wedding no longer blocks the whole day. A wedding only clashes with another wedding;
// a session on a wedding day still confirms, and Miranda gets a heads-up in the email to check the timing.
const clash = (a, b) => day(a.date) && day(a.date) === day(b.date) && String(a.time || "").toLowerCase() === String(b.time || "").toLowerCase();
const weddingDay = (a, b) => day(a.date) && day(a.date) === day(b.date) && (/wedding/i.test(a.time || "") !== /wedding/i.test(b.time || ""));
const clip = (v, n = 120) => String(v == null ? "" : v).slice(0, n);
// Deductions (Oct 16 2026): money taken off a booking from the master page (fewer people, a discount...)
const lessOf = (b) => cents((b.deducts || []).reduce((s, x) => s + (x.amount || 0), 0));
const totOf = (b) => cents((b.total || 0) + (b.addons || 0) - lessOf(b));
const resplit = (b) => { if (b.split) b.payout = cents(totOf(b) - shareOf(b.split, totOf(b))); };

function summary(state, live) {
  const payouts = cents(state.payouts || 0);
  return {
    total: state.total, count: state.count,
    contracted: state.contracted || 0, payouts, keeps: cents(state.total - payouts),
    test: !live,
  };
}

// Oct 20 2026: AffordableBeachPhotographer.com and MirandaRaePhotos.com may send a copy of each
// "Check My Date" request here too, so it shows on the Bookings page. Only that one kind of entry
// is accepted from them; nothing on the Bookings page can be read or changed from those sites.
const SISTER_SITES = { "affordablebeachphotographer.com": "AffordableBeachPhotographer.com", "mirandaraephotos.com": "MirandaRaePhotos.com" };
const sisterOf = (req) => {
  try { const o = req.headers.get("origin") || ""; const h = new URL(o).hostname.replace(/^www\./, "").toLowerCase(); return SISTER_SITES[h] ? { origin: o, name: SISTER_SITES[h] } : null; }
  catch (e) { return null; }
};

export default async (req) => {
  const sister = sisterOf(req);
  if (sister) {
    const cors = { "Access-Control-Allow-Origin": sister.origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin", "Cache-Control": "no-store" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let d = {};
    try { d = JSON.parse(await req.text()); } catch (e) {}
    if (req.method !== "POST" || d.kind !== "request") return new Response(JSON.stringify({ error: "not allowed" }), { status: 403, headers: cors });
    const host0 = new URL(req.url).hostname.replace(/^www\./, "");
    const st = getStore({ name: host0 === "mirandaraephotography.com" ? "booking-counter" : "booking-counter-test", consistency: "strong" });
    const log = (await st.get("log", { type: "json" })) || [];
    const c = (v, n = 120) => String(v == null ? "" : v).slice(0, n);
    log.push({ at: new Date().toISOString(), kind: "request", name: c(d.name, 60), date: String(d.date || "").slice(0, 10), beach: c(d.beach, 40),
      detail: [sister.name, c(d.detail)].filter(Boolean).join(" · "), phone: String(d.phone || "").replace(/\D/g, "").slice(-10), site: sister.name,
      test: /\btest\b/i.test(String(d.name || "")) || TEST_PHONES.includes(String(d.phone || "").replace(/\D/g, "").slice(-10)) });
    await st.setJSON("log", log.slice(-1000));
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
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
    else if (a === "paid") b.paid = { amount: cents(Math.max(0, totOf(b) - ((b.deposit && b.deposit.amount) || 0))), method: clip(data.method, 30), at: now, by: who };
    else if (a === "undo-paid") delete b.paid;
    else if (a === "cancel") {
      // Oct 20 2026: Cancel asks whether Miranda keeps the deposit or gives it back. A kept deposit
      // still counts as money collected; a returned one doesn't.
      const dep = (b.deposit && b.deposit.amount) || 0;
      const keep = data.deposit === "keep";
      const kept = keep ? cents(cleanMoney(data.amount) || dep) : 0;
      b.cancelled = { at: now, by: who, ...(data.deposit ? { deposit: keep ? "kept" : "returned" } : {}), ...(kept ? { kept } : {}),
        ...(!keep && (cleanMoney(data.amount) || dep) ? { returned: cents(cleanMoney(data.amount) || dep) } : {}) };
    }
    else if (a === "undo-cancel") delete b.cancelled;
    // Photographer owes Miranda (Oct 20 2026): on a contracted session the photographer collects the balance;
    // "Kallie paid me" records Miranda's part of it being handed over
    else if (a === "shooter-paid") {
      const amt = cents(cleanMoney(data.amount));
      if (!(amt > 0) || !b.photographer) return json({ error: "amount" });
      b.shooterPaid = (b.shooterPaid || []).concat({ amount: amt, at: now, by: who });
      data.detail = b.photographer + " paid Miranda";
    } else if (a === "undo-shooter-paid") {
      if (!(b.shooterPaid && b.shooterPaid.length)) return json({ error: "nothing" });
      b.shooterPaid.pop(); if (!b.shooterPaid.length) delete b.shooterPaid;
    }
    else if (a === "edit") {
      // Edit button (Oct 20 2026): change the details on a booking. The booking keeps its original
      // matching key, so an old Confirm link tapped later still isn't counted twice.
      const f = data.fields || {}, before = { ...b }, changed = [];
      const nb = { date: f.date != null ? day(f.date) : b.date, time: f.time != null ? clip(f.time, 30) : b.time };
      if (f.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(nb.date)) return json({ error: "date" });
      if ((nb.date !== b.date || nb.time !== b.time) && !b.past && !data.force) {
        const same = (x) => String(x.photographer || "").toLowerCase() === String(b.photographer || "").toLowerCase();
        const other = list.find((x) => x !== b && !x.cancelled && !x.past && !!x.test === !!b.test && same(x) && clash(x, nb));
        if (other) return json({ conflict: true, with: other.num, name: other.name });
      }
      const set = (k, v, n) => { if (v != null && String(v) !== String(b[k] == null ? "" : b[k])) { b[k] = v; changed.push(n); } };
      if (f.name != null && clip(f.name, 60).trim()) set("name", clip(f.name, 60).trim(), "name");
      if (f.phone != null) set("phone", digits(f.phone), "phone");
      set("date", f.date != null ? nb.date : null, "date");
      set("time", f.time != null ? nb.time : null, "time");
      if (f.beach != null) set("beach", clip(f.beach, 40), "beach");
      if (f.pkg != null) set("pkg", clip(f.pkg, 60), "package");
      if (f.notes != null) set("notes", clip(f.notes, 300), "notes");
      if (f.dep != null) { const dp = cents(cleanMoney(f.dep)); if (dp !== (b.dep || 50)) { if (dp && dp !== 50) b.dep = dp; else delete b.dep; changed.push("deposit"); } }
      if (f.total != null) {
        const t = cents(cleanMoney(f.total));
        if (t !== (b.total || 0)) {
          // Keep the running total in the emails in step with a corrected price
          if (!b.past && !b.test && b.num > START && b.num < 700000) state.total = cents(state.total + t - (b.total || 0));
          b.total = t; changed.push("price"); resplit(b);
        }
      }
      if (before.date !== b.date && !b.movedFrom) b.movedFrom = before.date;
      if (!changed.length) return json({ ok: true, booking: b, unchanged: true });
      data.detail = "Changed " + changed.join(", ");
      b.edited = { at: now, by: who };
    }
    else if (a === "photographer") {
      // Photographer button (Oct 20 2026): hand a session to Kallie (or anyone), or back to Miranda.
      // The new photographer's same-time sessions are checked so nobody is double-booked.
      const name = clip(data.photographer, 60).trim();
      const nameIsMiranda = /^miranda$/i.test(name);
      const shooter = nameIsMiranda ? "" : name;
      const same = (x) => String(x.photographer || "").toLowerCase() === shooter.toLowerCase();
      if (!b.past && !data.force) {
        const other = list.find((x) => x !== b && !x.cancelled && !x.past && !!x.test === !!b.test && same(x) && clash(x, b));
        if (other) return json({ conflict: true, with: other.num, name: other.name });
      }
      const counted = !b.past && !b.test && b.num > START && b.num < 700000;
      if (counted && b.photographer) { state.contracted = Math.max(0, (state.contracted || 0) - 1); state.payouts = cents((state.payouts || 0) - (b.payout || 0)); }
      b.photographer = shooter;
      if (shooter) {
        // Usual split (Oct 20 2026): flat $50 to Miranda, weddings 25% (at least $50)
        const wed = /wedding/i.test(b.time || "") || /wedding/i.test(b.pkg || "");
        b.split = cleanSplit(data.split) || (wed ? { mode: "pct", val: (state.splitDefault || DEFAULT_SPLIT).pct, min: (state.splitDefault || DEFAULT_SPLIT).min } : { mode: "amt", val: 50 });
        resplit(b);
        const names = Array.isArray(state.photographers) && state.photographers.length ? state.photographers : DEFAULT_PHOTOGRAPHERS.slice();
        if (!names.some((n) => n.toLowerCase() === shooter.toLowerCase())) names.push(shooter);
        state.photographers = names.slice(-12);
        if (counted) { state.contracted = (state.contracted || 0) + 1; state.payouts = cents((state.payouts || 0) + (b.payout || 0)); }
      } else { delete b.split; b.payout = 0; }
      data.detail = shooter ? "Now shot by " + shooter + " · their pay $" + (b.payout || 0) : "Back to Miranda";
      state.updated = now; await store.setJSON("state", state);
    }
    else if (a === "deduct") {
      const amt = cents(cleanMoney(data.amount));
      if (!(amt > 0) || amt > totOf(b)) return json({ error: "amount" });
      b.deducts = (b.deducts || []).concat({ amount: amt, why: clip(data.why, 80), at: now, by: who });
      resplit(b);
    } else if (a === "undo-deduct") {
      if (!(b.deducts && b.deducts.length)) return json({ error: "nothing" });
      b.deducts.pop(); if (!b.deducts.length) delete b.deducts;
      resplit(b);
    } else if (a === "move") {
      // Move date (Oct 16 2026): same time of day, new date. Blocked if that photographer already has that slot.
      const nd = day(data.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return json({ error: "date" });
      const same = (x) => String(x.photographer || "").toLowerCase() === String(b.photographer || "").toLowerCase();
      const other = list.find((x) => x !== b && !x.cancelled && !!x.test === !!b.test && same(x) && clash(x, { date: nd, time: b.time }));
      if (other) return json({ conflict: true, with: other.num, name: other.name });
      b.movedFrom = b.date; b.date = nd;
    } else return json({ error: "action" });
    await store.setJSON("bookings", list);
    if (a === "edit" && data.fields && data.fields.total != null) { state.updated = now; await store.setJSON("state", state); }
    const amt = a === "deposit" ? b.deposit.amount : a === "paid" ? b.paid.amount : a === "deduct" ? b.deducts[b.deducts.length - 1].amount : a === "shooter-paid" ? b.shooterPaid[b.shooterPaid.length - 1].amount : 0;
    const cxd = a === "cancel" && b.cancelled.deposit ? (b.cancelled.deposit === "kept" ? "Deposit kept" + (b.cancelled.kept ? " $" + b.cancelled.kept : "") : "Deposit returned" + (b.cancelled.returned ? " $" + b.cancelled.returned : "")) : "";
    await logIt({ kind: a === "move" ? "moved" : a, num: b.num, name: b.name, amount: amt, by: who, test: !!b.test,
      ...(a === "move" ? { date: b.date, detail: "Moved from " + b.movedFrom } : a === "deduct" ? { detail: b.deducts[b.deducts.length - 1].why }
        : a === "edit" || a === "photographer" || a === "shooter-paid" ? { detail: data.detail } : cxd ? { detail: cxd } : {}) });
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
  // Bookings page (Oct 20 2026): take a texted client off the Inquiry list without booking them
  // (they said no, or never answered). Only the master page list changes.
  if (data.kind === "dismiss") {
    if (!(await okPass(req, data))) return json({ error: "passcode" });
    // One client, or several at once ("Clear all old inquiries"). Hidden from the cards only; the
    // original request stays in "Everything that came in".
    const items = Array.isArray(data.items) ? data.items.slice(0, 300) : [data];
    const log = await getList("log"), at = new Date().toISOString();
    items.forEach((it) => log.push({ at, kind: "dismiss", name: clip(it.name, 60), date: day(it.date), beach: clip(it.beach, 40), by: clip(data.by, 40), test: !!it.test, ...(items.length > 1 ? { bulk: true } : {}) }));
    await store.setJSON("log", log.slice(-1000));
    return json({ ok: true, cleared: items.length });
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
  // Add without texting (Oct 16 2026; started as "Entering an old session?"): Miranda adds a client she's
  // already set up, straight from New Booking. Nothing is texted. The date decides what it is:
  // - a past date is a Past session: no booking number, no slot check, never in the running total
  // - today or later is a real upcoming booking: gets a booking number, counts in the total, and goes
  //   through the same double-booking check as the Confirm page.
  // pay: "none" (nothing paid yet), "deposit" ($50 or the amount sent) or "full" (paid in full).
  if (data.kind === "past" || data.kind === "direct") {
    const d = day(data.date);
    const ct = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); // today in Central time
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "date" });
    const name = clip(data.name, 60).trim();
    if (!name) return json({ error: "name" });
    const isPast = d < ct;
    if (data.kind === "past" && d > ct) return json({ error: "future" }); // older New Booking pages
    const list = await getList("bookings");
    const b = { name, date: d, time: clip(data.time, 30), beach: clip(data.beach, 40) };
    b.key = keyOf(b);
    if (list.some((x) => x.key === b.key && !x.cancelled)) return json({ duplicate: true });
    // Confirmed from the Bookings page's Inquiry list (Oct 20 2026): use who's shooting and the
    // client's phone that were saved when the Confirm link was texted
    const pend = data.fromInquiry ? (state.pending || []).find((p) => p.key === b.key) : null;
    if (pend) {
      if (!data.phone && pend.phone) data.phone = pend.phone;
      if (!data.photographer && pend.photographer) { data.photographer = pend.photographer; data.split = pend.split; }
      if (pend.testPhone) data.testPhone = true;
    }
    const test = isTestName(name) || isTestPhone(data.phone) || !!data.testPhone;
    const total = cents(cleanMoney(data.amount));
    const who = clip(data.photographer, 60).trim(), split = who ? cleanSplit(data.split) : null;
    if (!isPast) {
      const sameShooter = (x) => String(x.photographer || "").toLowerCase() === who.toLowerCase();
      const taken = list.find((x) => !x.cancelled && !x.past && !!x.test === test && sameShooter(x) && clash(x, b));
      if (taken && !data.force) return json({ conflict: true, with: taken.num, withName: taken.name });
    }
    const now = new Date().toISOString(), by = clip(data.by, 40);
    let num;
    if (isPast) { state.lastPast = (state.lastPast || 0) + 1; num = 700000 + state.lastPast; }
    else if (test) { state.lastTest = (state.lastTest || 0) + 1; num = 900000 + state.lastTest; }
    else { state.last += 1; num = state.last; }
    const payout = split ? cents(total - shareOf(split, total)) : 0;
    Object.assign(b, { num, ...(isPast ? { past: true } : { direct: true }), ...(pend ? { fromInquiry: true } : {}), pkg: clip(data.pkg, 60), total, ...(cleanMoney(data.dep) && cleanMoney(data.dep) !== 50 ? { dep: cleanMoney(data.dep) } : {}), by, phone: digits(data.phone),
      photographer: who, payout, ...(split ? { split } : {}), test, created: now });
    const pay = data.pay || (data.paid ? "full" : "none");
    if (pay === "full" && total > 0) b.paid = { amount: total, method: clip(data.method, 30), at: now, by };
    else if (pay === "deposit") b.deposit = { amount: Math.min(total || 50, cleanMoney(data.deposit) || 50), method: clip(data.method, 30), at: now, by };
    if (!isPast && !test) {
      // Same running total and booking number as a Confirm-page booking; also remembered so that if the
      // client later taps an old Confirm link for this same session it isn't counted twice.
      state.count += 1; state.total = cents(state.total + total);
      if (who) { state.contracted = (state.contracted || 0) + 1; state.payouts = cents((state.payouts || 0) + payout); }
      state.recent = Array.isArray(state.recent) ? state.recent : [];
      state.recent.push({ key: b.key, num, ...(who ? { photographer: who, payout } : {}) });
      if (state.recent.length > 200) state.recent = state.recent.slice(-200);
    }
    list.push(b);
    await store.setJSON("bookings", list.slice(-500));
    state.updated = now; await store.setJSON("state", state);
    const payTxt = b.paid ? "paid in full" : b.deposit ? "deposit paid" : isPast ? "still owes" : "no deposit yet";
    await logIt({ kind: isPast ? "past" : "added", num: isPast ? null : num, name, date: d, beach: b.beach, amount: total, by, detail: (who ? "Shot by " + who + " · " : "") + payTxt, test });
    return json({ ok: true, past: isPast, booking: b });
  }
  // A "Check My Date" request from any page on the site (logged only, never counted)
  if (data.kind === "request") {
    // Oct 20 2026: the phone is kept too, so the request shows on the Bookings page as an Inquiry card
    // Miranda can build and text a Confirm link from
    await logIt({ kind: "request", name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), detail: clip(data.detail), phone: digits(data.phone), test: isTestName(data.name) || isTestPhone(data.phone) });
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
      // Oct 20 2026: the texted details are kept with the entry so the Bookings page can show the client
      // as an Inquiry card (Text again, Confirmed, Not booking) until they confirm
      await logIt({ kind: "sent", name: clip(data.name, 60), date: day(data.date), beach: clip(data.beach, 40), by: p.by, detail: p.photographer ? "Shot by " + p.photographer : "", test: !!(p.testPhone || isTestName(data.name)),
        time: clip(data.time, 30), pkg: clip(data.pkg, 60), amount: cleanMoney(data.amount), dep: cleanMoney(data.dep) || 50, phone: p.phone, ...(p.photographer ? { photographer: p.photographer } : {}), link: clip(data.link, 3000) });
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
        resplit(b);
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
      pkg: clip(data.pkg, 60), total: amount, ...(cleanMoney(data.dep) && cleanMoney(data.dep) !== 50 ? { dep: cleanMoney(data.dep) } : {}), by: clip((pend && pend.by) || data.by, 40), phone: pend && pend.phone || "",
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
    // Oct 27 2026: tell the client screen whether Miranda has already marked the deposit / full payment,
    // so a repeat tap shows "Deposit received" instead of asking them to pay again.
    const bk = bookings.find((b) => b.num === seen.num && !b.cancelled);
    return json({ num: seen.num, repeat: true, depositIn: !!(bk && (bk.deposit || bk.paid)), paidFull: !!(bk && bk.paid),
      photographer: seen.photographer || null, payout: seen.payout || 0, ...summary(state, live) });
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
