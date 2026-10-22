// Private /sandy page (added Oct 21 2026): talk to Sandy here, see what she'd text, and see every
// text she sent. Behind the same passcode as the Bookings page. Changes Sandy makes here are real
// changes to the Bookings app (on the live site), same as texting her.
import { chat, dailyCheckin, passOk, sandyStore, PEOPLE, MIRANDA, textingOn, isLive, env } from "../sandy/brain.mjs";

const json = (o) => Response.json(o, { headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  let d = {}; try { d = await req.json(); } catch (e) {}
  if (!(await passOk(req.headers.get("x-pass") || d.pass))) return json({ error: "passcode" });
  const base = new URL(req.url).origin;
  const store = sandyStore(base);
  const phone = Object.keys(PEOPLE).find((p) => PEOPLE[p].name === d.as) || MIRANDA;
  const hkey = "page-" + phone; // this page keeps its own conversation, separate from real texts
  const status = { live: isLive(base), texting: textingOn(), ready: { claude: !!env("ANTHROPIC_API_KEY"), key: env("SANDY_KEY").length >= 20, twilio: !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN")) } };
  try {
    if (d.action === "send") {
      const text = String(d.text || "").trim().slice(0, 1500);
      if (!text) return json({ error: "empty" });
      const out = await chat({ base, from: phone, text, history: (await store.get(hkey, { type: "json" })) || [] });
      await store.setJSON(hkey, out.history);
      return json({ reply: out.reply, changes: out.changes, history: out.history, status });
    }
    if (d.action === "daily") {
      const out = await dailyCheckin({ base, history: [] });
      return json({ reply: out ? out.reply : "(Nothing needs Miranda today — Sandy wouldn't text.)", status });
    }
    if (d.action === "reset") { await store.setJSON(hkey, []); return json({ ok: true, status }); }
    return json({ history: (await store.get(hkey, { type: "json" })) || [], outbox: ((await store.get("outbox", { type: "json" })) || []).slice(-60).reverse(), status });
  } catch (e) { return json({ error: String(e.message || e), status }); }
};

export const config = { path: "/api/sandy" };
