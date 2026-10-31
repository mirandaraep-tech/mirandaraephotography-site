// Miranda's favorite photos (added Oct 25 2026).
// On the hidden /favorites page Miranda (1) checks every Pixieset portfolio photo she likes,
// then (2) numbers her top 50. Every tap is saved here online right away, so she can stop
// and pick up later on any phone, and Randy/Claude can read her picks anytime to swap
// photos on the website.
// GET  /api/photo-favorites                     -> { favs: [id...], top: [id...], updated, done }
// POST /api/photo-favorites {id, on}            -> checks/unchecks one favorite
// POST /api/photo-favorites {top: [id...]}      -> saves the numbered top list (in order, max 50)
// POST /api/photo-favorites {done: true}        -> marks her as finished
// Live site uses the "photo-favorites" store; test copies use "photo-favorites-test".
import { getStore } from "@netlify/blobs";

const headers = { "Cache-Control": "no-store" };
const ID = /^[A-Za-z0-9]{4,12}$/;

export default async (req) => {
  const host = new URL(req.url).hostname.replace(/^www\./, "");
  const live = host === "mirandaraephotography.com";
  const store = getStore({ name: live ? "photo-favorites" : "photo-favorites-test", consistency: "strong" });
  const state = (await store.get("state", { type: "json" })) || { favs: [], top: [], updated: null, done: null };

  if (req.method === "GET") return Response.json({ ...state, test: !live }, { headers });
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  let data = {};
  try { data = await req.json(); } catch (e) {}

  if (Array.isArray(data.top)) {
    const top = [...new Set(data.top.map(String).filter((id) => ID.test(id)))].slice(0, 50);
    state.top = top;
    // anything in the top list is a favorite too
    top.forEach((id) => { if (!state.favs.includes(id)) state.favs.push(id); });
  } else if (data.done) {
    state.done = new Date().toISOString();
  } else {
    const id = String(data.id || "");
    if (!ID.test(id)) return Response.json({ ok: false }, { status: 400, headers });
    if (data.on) { if (!state.favs.includes(id)) state.favs.push(id); }
    else {
      state.favs = state.favs.filter((x) => x !== id);
      state.top = state.top.filter((x) => x !== id);
    }
  }
  state.updated = new Date().toISOString();
  await store.setJSON("state", state);
  return Response.json({ ok: true, favs: state.favs.length, top: state.top.length }, { headers });
};

export const config = { path: "/api/photo-favorites" };
