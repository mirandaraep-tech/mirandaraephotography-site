// Private /sandy page (added Oct 21 2026): talk to Sandy here, see what she'd text, and see every
// text she sent. Behind the same passcode as the Bookings page. Changes Sandy makes here are real
// changes to the Bookings app (on the live site), same as texting her.
import { chat, dailyCheckin, passOk, sandyStore, PEOPLE, MIRANDA, TEST_CUSTOMER, textingOn, isLive, env, getRequests, saveRequests, getCustomers } from "../sandy/brain.mjs";
import { customerChat } from "../sandy/customers.mjs";

const json = (o) => Response.json(o, { headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  let d = {}; try { d = await req.json(); } catch (e) {}
  if (!(await passOk(req.headers.get("x-pass") || d.pass))) return json({ error: "passcode" });
  const base = new URL(req.url).origin;
  const store = sandyStore(base);
  // "Customer" = a pretend customer (Oct 28 2026); nothing is really texted to them or to Miranda
  const cust = d.as === "Customer";
  const phone = cust ? TEST_CUSTOMER : Object.keys(PEOPLE).find((p) => PEOPLE[p].name === d.as) || MIRANDA;
  const hkey = "page-" + phone; // this page keeps its own conversation, separate from real texts
  const status = { live: isLive(base), texting: textingOn(), ready: { claude: !!env("ANTHROPIC_API_KEY"), twilio: !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN")) } };
  try {
    if (d.action === "send") {
      const text = String(d.text || "").trim().slice(0, 1500);
      if (!text) return json({ error: "empty" });
      const h = (await store.get(hkey, { type: "json" })) || [];
      const out = cust ? await customerChat({ base, from: phone, text, history: h, page: true }) : await chat({ base, from: phone, text, history: h, page: true });
      await store.setJSON(hkey, out.history);
      return json({ reply: out.reply || "(Sandy texted the Confirm link)", changes: out.changes, history: out.history, status });
    }
    if (d.action === "daily") {
      const out = await dailyCheckin({ base, history: [] });
      return json({ reply: out ? out.reply : "(Nothing needs Miranda today — Sandy wouldn't text.)", status });
    }
    if (d.action === "reset") {
      await store.setJSON(hkey, []);
      // Starting the pretend customer over also clears their pretend requests
      if (cust) {
        await saveRequests(base, (await getRequests(base)).filter((r) => r.phone !== TEST_CUSTOMER));
        const c = await getCustomers(base); delete c[TEST_CUSTOMER]; await store.setJSON("customers", c);
      }
      return json({ ok: true, status });
    }
    return json({ history: (await store.get(hkey, { type: "json" })) || [], outbox: ((await store.get("outbox", { type: "json" })) || []).slice(-60).reverse(), status });
  } catch (e) { return json({ error: String(e.message || e), status }); }
};

export const config = { path: "/api/sandy" };
