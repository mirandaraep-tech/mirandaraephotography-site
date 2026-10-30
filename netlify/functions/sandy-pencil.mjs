// Bookings page "✕ Remove pencil-in" button (added Oct 30 2026). Behind the same passcode as the Bookings page.
// Takes a customer's pencil-in off; if Miranda says "Text them other times", Sandy texts the closest open times.
import { passOk } from "../sandy/brain.mjs";
import { removePencil } from "../sandy/customers.mjs";

const json = (o) => Response.json(o, { headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "post" });
  let d = {}; try { d = await req.json(); } catch (e) {}
  if (!(await passOk(req.headers.get("x-pass") || d.pass))) return json({ error: "passcode" });
  if (d.action !== "remove" || !d.request_id) return json({ error: "what?" });
  const base = new URL(req.url).origin;
  try {
    return json(await removePencil(base, String(d.request_id).slice(0, 20), { textTimes: !!d.text, by: "Bookings page · " + String(d.by || "").slice(0, 40), who: String(d.by || "").slice(0, 40) }));
  } catch (e) { return json({ error: String(e.message || e) }); }
};

export const config = { path: "/api/sandy-pencil" };
