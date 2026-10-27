// Netlify -> Cloudflare move (added Oct 27 2026). Read-only: hands the private /move page on the new
// Cloudflare copy everything saved on Netlify (bookings, totals, log, Sandy, favorites, photo tags) so it
// can be copied over exactly. Behind the Bookings passcode. Changes nothing. Can be deleted after the move.
import { getStore } from "@netlify/blobs";

const PASS_SHA256 = "37ba3881108bf3e48180350246c5959b9481633d0cb1d8694fb141dc74e5fe79"; // same as /log
const STORES = ["booking-counter", "sandy", "photo-favorites", "photo-tags", "sandy-secret"];
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const okOrigin = /^https:\/\/([a-z0-9-]*mirandaraephotography[a-z0-9-]*\.[a-z0-9-]+\.workers\.dev|mirandaraephotography\.com)$/i.test(origin);
  const cors = okOrigin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "x-pass", "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" } : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const headers = { ...cors, "Cache-Control": "no-store" };
  if ((await sha(String(req.headers.get("x-pass") || "").trim().toLowerCase())) !== PASS_SHA256) return Response.json({ error: "passcode" }, { status: 403, headers });
  const stores = {};
  for (const name of STORES) {
    const st = getStore({ name, consistency: "strong" });
    const { blobs } = await st.list();
    stores[name] = {};
    for (const b of blobs) stores[name][b.key] = await st.get(b.key);
  }
  return Response.json({ stores, at: new Date().toISOString() }, { headers });
};

export const config = { path: "/api/move-export" };
