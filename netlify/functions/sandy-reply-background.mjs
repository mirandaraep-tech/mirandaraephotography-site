// Sandy's helper that does the thinking (added Oct 21 2026). Runs in the background (up to 15 min),
// started by sandy-sms (a text came in) or sandy-daily (morning check-in).
import { chat, dailyCheckin, deliver, getHistory, saveHistory, record, env, MIRANDA, sandyKey } from "../sandy/brain.mjs";

export default async (req) => {
  const k = await sandyKey();
  if (!(k.length >= 20 && req.headers.get("x-sandy-key") === k)) return;
  let d = {}; try { d = await req.json(); } catch (e) { return; }
  const base = /^https:\/\/[a-z0-9.-]+$/i.test(d.base || "") ? d.base : env("URL");
  try {
    if (d.kind === "text") {
      const out = await chat({ base, from: d.from, text: d.text, history: await getHistory(base, d.from) });
      await saveHistory(base, d.from, out.history);
      if (out.changes.length) await record(base, { kind: "changes", from: d.from, changes: out.changes });
      await deliver(base, d.from, out.reply, "reply");
    } else if (d.kind === "daily") {
      const out = await dailyCheckin({ base, history: await getHistory(base, MIRANDA) });
      if (!out) { await record(base, { kind: "daily-skip", body: "Nothing needed Miranda today" }); return; }
      await saveHistory(base, MIRANDA, out.history);
      await deliver(base, MIRANDA, out.reply, "daily");
    }
  } catch (e) {
    await record(base, { kind: "error", body: String(e.message || e) });
    if (d.kind === "text") await deliver(base, d.from, "Sandy here. Sorry, something went wrong on my end and I couldn't do that. Randy can check what happened.", "reply");
  }
};
