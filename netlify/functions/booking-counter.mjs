// Private booking counter (added Oct 10 2026).
// Gives each confirmed session a booking number (#101, #102, ...) and keeps a
// running dollar total of confirmed sessions + add-ons. The total only goes into
// the emails to Randy and Miranda; clients never see it on screen.
// Live site uses the "booking-counter" store; test copies use "booking-counter-test".
import { getStore } from "@netlify/blobs";

const START = 100; // first booking becomes #101

export default async (req) => {
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  let data = {};
  try { data = await req.json(); } catch (e) {}
  const kind = data.kind === "addon" ? "addon" : data.kind === "deposit" ? "deposit" : "confirm";
  let amount = Number(String(data.amount || "0").replace(/[^0-9.]/g, ""));
  if (!isFinite(amount) || amount < 0 || amount > 10000) amount = 0;

  const host = new URL(req.url).hostname.replace(/^www\./, "");
  const live = host === "mirandaraephotography.com";
  // "strong" = always read the very latest numbers, so two quick entries can't overwrite each other
  const store = getStore({ name: live ? "booking-counter" : "booking-counter-test", consistency: "strong" });

  const state = (await store.get("state", { type: "json" })) || { last: START, total: 0, count: 0, addons: 0 };
  let num = null;
  if (kind === "deposit") {
    // Deposits received (added Oct 12 2026): kept in their own total, NOT added to the bookings total
    const ref = parseInt(String(data.ref || "").replace(/\D/g, ""), 10);
    num = ref > START ? ref : null;
    state.deposits = Math.round(((state.deposits || 0) + amount) * 100) / 100;
    state.depositCount = (state.depositCount || 0) + 1;
    state.updated = new Date().toISOString();
    await store.setJSON("state", state);
    return Response.json({ num, deposits: state.deposits, depositCount: state.depositCount, test: !live }, { headers: { "Cache-Control": "no-store" } });
  }
  if (kind === "confirm") {
    // Same client confirming the same date + beach again (e.g. tapped the link twice): give back the
    // same booking number and don't add the price again (added Oct 12 2026).
    const key = [data.name, data.date, data.beach].map((v) => String(v || "").trim().toLowerCase()).join("|");
    state.recent = Array.isArray(state.recent) ? state.recent : [];
    const seen = key.replace(/\|/g, "") ? state.recent.find((r) => r.key === key) : null;
    if (seen) {
      return Response.json({ num: seen.num, total: state.total, count: state.count, addons: state.addons, repeat: true, test: !live }, { headers: { "Cache-Control": "no-store" } });
    }
    state.last += 1;
    state.recent.push({ key, num: state.last });
    if (state.recent.length > 200) state.recent = state.recent.slice(-200);
    state.count += 1;
    num = state.last;
  } else {
    state.addons += 1;
    const ref = parseInt(String(data.ref || "").replace(/\D/g, ""), 10);
    num = ref > START ? ref : null;
  }
  state.total = Math.round((state.total + amount) * 100) / 100;
  state.updated = new Date().toISOString();
  await store.setJSON("state", state);

  return Response.json(
    { num, total: state.total, count: state.count, addons: state.addons, test: !live },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const config = { path: "/api/booking-counter" };
