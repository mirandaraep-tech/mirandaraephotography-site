// Website requests to Sandy (added Oct 28 2026).
// source.js sends a copy of any request form here when the visitor checks the OK-to-text box.
// Sandy texts them first (to get anything missing) and lets Miranda know.
// Who gets a text: only Randy's and Bradyn's numbers until Randy says turn it on for everyone
// (then SANDY_WEB_TEXTS becomes "everyone" in wrangler.jsonc).
import { digits, record, sandyKey, sandyStore, webTextsFor } from "../sandy/brain.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("ok");
  let d = {}; try { d = await req.json(); } catch (e) { return new Response("ok"); }
  const f = (d && typeof d.fields === "object" && d.fields) || {};
  const phone = digits(f.phone), base = new URL(req.url).origin;
  if (d.consent !== true || phone.length !== 10) return new Response("ok");
  // Oct 30 2026: remember who checked OK to text, so Sandy only texts Confirm links to people who agreed
  await sandyStore(base).setJSON("ok-text-" + phone, Date.now());
  if (!webTextsFor(phone)) {
    await record(base, { kind: "web-skip", from: phone, body: "Website request said OK to text, but Sandy only texts Randy and Bradyn for now" });
    return new Response("ok");
  }
  // Limits: one Sandy text per number per 2 minutes (double taps), 10 a day per number, 100 a day overall
  const s = sandyStore(base), day = new Date().toISOString().slice(0, 10);
  const last = (await s.get("web-last-" + phone, { type: "json" })) || 0;
  if (Date.now() - last < 2 * 60000) return new Response("ok");
  const n = ((await s.get("web-" + phone + "-" + day, { type: "json" })) || 0) + 1, all = ((await s.get("web-all-" + day, { type: "json" })) || 0) + 1;
  if (n > 10 || all > 100) { await record(base, { kind: "web-skip", from: phone, body: "Too many website requests today" }); return new Response("ok"); }
  await s.setJSON("web-last-" + phone, Date.now()); await s.setJSON("web-" + phone + "-" + day, n); await s.setJSON("web-all-" + day, all);
  const form = { page: String(d.page || "").slice(0, 80), fields: Object.fromEntries(Object.entries(f).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 600)])) };
  await fetch(base + "/.netlify/functions/sandy-reply-background", {
    method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey() },
    body: JSON.stringify({ kind: "web", form, base }),
  });
  return new Response("ok");
};

export const config = { path: "/api/sandy-web" };
