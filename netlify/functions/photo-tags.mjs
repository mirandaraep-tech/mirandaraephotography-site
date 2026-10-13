// Photo beach tags (added Oct 13 2026).
// Miranda taps which beach each Pixieset portfolio photo was taken at on the hidden
// /tag-photos page. Every tap is saved here online right away (no email), so she can
// stop and pick up later on any phone, and Randy/Claude can read the answers anytime.
// GET  /api/photo-tags                -> { tags: { photoId: "Beach", ... }, updated }
// POST /api/photo-tags {id, beach}    -> saves one answer (beach "" removes it)
// Live site uses the "photo-tags" store; test copies use "photo-tags-test".
import { getStore } from "@netlify/blobs";

const headers = { "Cache-Control": "no-store" };

export default async (req) => {
  const host = new URL(req.url).hostname.replace(/^www\./, "");
  const live = host === "mirandaraephotography.com";
  const store = getStore({ name: live ? "photo-tags" : "photo-tags-test", consistency: "strong" });
  const state = (await store.get("state", { type: "json" })) || { tags: {}, updated: null };

  if (req.method === "GET") return Response.json({ ...state, test: !live }, { headers });
  if (req.method !== "POST") return new Response("Not found", { status: 404 });

  let data = {};
  try { data = await req.json(); } catch (e) {}
  const id = String(data.id || "");
  const beach = String(data.beach || "").trim().slice(0, 40);
  if (!/^[A-Za-z0-9]{4,12}$/.test(id)) return Response.json({ ok: false }, { status: 400, headers });

  if (beach) state.tags[id] = beach;
  else delete state.tags[id];
  state.updated = new Date().toISOString();
  await store.setJSON("state", state);
  return Response.json({ ok: true, count: Object.keys(state.tags).length }, { headers });
};

export const config = { path: "/api/photo-tags" };
