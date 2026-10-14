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

const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);
const isTestName = (v) => /\btest\b/i.test(String(v || ""));
const isTestPhone = (v) => { const d = digits(v); return d.length === 10 && TEST_PHONES.includes(d); };
const keyOf = (d) => [d.name, d.date, d.beach].map((v) => String(v || "").trim().toLowerCase()).join("|");
const cents = (n) => Math.round(n * 100) / 100;
const cleanMoney = (v) => { const n = Number(String(v || "0").replace(/[^0-9.]/g, "")); return isFinite(n) && n >= 0 && n <= 10000 ? n : 0; };
const json = (o) => Response.json(o, { headers: { "Cache-Control": "no-store" } });

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
  if (req.method === "GET") {
    const list = Array.isArray(state.photographers) && state.photographers.length ? state.photographers : DEFAULT_PHOTOGRAPHERS;
    return json({ photographers: list });
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
      const who = String(data.photographer || "").trim().slice(0, 60);
      if (who) {
        p.photographer = who;
        p.payout = cleanMoney(data.payout);
        const names = Array.isArray(state.photographers) && state.photographers.length ? state.photographers : DEFAULT_PHOTOGRAPHERS.slice();
        if (!names.some((n) => n.toLowerCase() === who.toLowerCase())) names.push(who);
        state.photographers = names.slice(-12);
      }
      state.pending.push(p);
      if (state.pending.length > 200) state.pending = state.pending.slice(-200);
      await save();
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
    state.deposits = cents((state.deposits || 0) + amount);
    state.depositCount = (state.depositCount || 0) + 1;
    await save();
    return json({ num, deposits: state.deposits, depositCount: state.depositCount, test: !live });
  }

  // Add-On page: emailed to both inboxes, but no longer added to the total (Oct 14 2026)
  if (kind === "addon") {
    await save();
    return json({ num: ref > START ? ref : null, ...summary(state, live) });
  }

  // Confirm page
  const key = keyOf(data);
  const pend = (state.pending || []).find((p) => p.key === key) || null;
  if (isTestName(data.name) || isTestPhone(data.phone) || (pend && pend.testPhone)) {
    await save();
    return json({ num: null, notCounted: "test", ...summary(state, live) });
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
  return json({ num: rec.num, photographer: rec.photographer || null, payout: rec.payout || 0, ...summary(state, live) });
};

export const config = { path: "/api/booking-counter" };
