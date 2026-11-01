// Sandy's helper that does the thinking (added Oct 21 2026). Runs in the background (up to 15 min),
// started by sandy-sms (a text came in) or sandy-daily (morning check-in).
import { chat, dailyCheckin, deliver, getHistory, saveHistory, record, env, MIRANDA, sandyKey, sandyStore, loadData, describeChange, changeWorked } from "../sandy/brain.mjs";
import { customerChat, webRequest, pencilCheck, nudgeCheck } from "../sandy/customers.mjs";
import { getCustHistory, saveCustHistory } from "../sandy/brain.mjs";

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
    } else if (d.kind === "customer") {
      // A customer texted (Oct 28 2026)
      const out = await customerChat({ base, from: d.from, text: d.text, history: await getCustHistory(base, d.from) });
      await saveCustHistory(base, d.from, out.history);
      if (out.changes.length) await record(base, { kind: "changes", from: d.from, changes: out.changes });
      if (out.reply) await deliver(base, d.from, out.reply, "to-customer");
    } else if (d.kind === "pencil") {
      // Every minute (Oct 30 2026): pencil in customers nobody okayed within 5 minutes, bump ones whose time got
      // booked, and remind Miranda and Bradyn at 5:00 and 8:30 PM
      await pencilCheck(base);
      // Nov 1 2026: text Miranda once about any website request still unanswered after an hour
      try { await nudgeCheck(base); } catch (e) { await record(base, { kind: "error", body: "nudge: " + String(e.message || e) }); }
    } else if (d.kind === "web") {
      // Someone sent a website request and checked OK to text (Oct 28 2026)
      await webRequest({ base, form: d.form || {} });
    } else if (d.kind === "voice") {
      // One turn of a phone call (sandy-voice.mjs picks up the answer and speaks it)
      const store = sandyStore(base), key = "call-" + String(d.call || "").replace(/[^A-Za-z0-9]/g, "");
      const s = (await store.get(key, { type: "json" })) || { from: d.from, history: [] };
      let reply, hang = false, changes = [];
      try {
        const out = await chat({ base, from: d.from, text: d.text, history: s.history || [], voice: true });
        changes = out.changes;
        hang = /\[HANG ?UP\]/i.test(out.reply);
        reply = out.reply.replace(/\[HANG ?UP\]/gi, "").trim() || (hang ? "Bye!" : "Sorry, could you say that again?");
        s.history = out.history.map((m) => (m.role === "assistant" ? { ...m, content: String(m.content).replace(/\[HANG ?UP\]/gi, "").trim() || "Bye!" } : m));
      } catch (e) {
        await record(base, { kind: "error", body: "call: " + String(e.message || e) });
        reply = "Sorry, something went wrong on my end, so I didn't change anything. Please try again, or text me.";
      }
      s.answer = { turn: d.turn, reply, hang };
      await store.setJSON(key, s);
      await record(base, { kind: "call", from: d.from, heard: d.text, body: reply });
      // Text the caller a confirmation of every change that went through
      const done = changes.filter(changeWorked);
      if (done.length) {
        let data = null; try { data = await loadData(base); } catch (e) {}
        await deliver(base, d.from, "Sandy here, confirming what I changed on our call:\n" + done.map((c) => "- " + describeChange(c, data)).join("\n"), "call-confirm");
      }
    } else if (d.kind === "daily") {
      const out = await dailyCheckin({ base, history: await getHistory(base, MIRANDA) });
      if (!out) { await record(base, { kind: "daily-skip", body: "Nothing needed Miranda today" }); return; }
      await saveHistory(base, MIRANDA, out.history);
      await deliver(base, MIRANDA, out.reply, "daily");
    }
  } catch (e) {
    await record(base, { kind: "error", body: String(e.message || e) });
    if (d.kind === "text") await deliver(base, d.from, "Sandy here. Sorry, something went wrong on my end and I couldn't do that. Randy can check what happened.", "reply");
    if (d.kind === "customer") {
      await deliver(base, d.from, "Sorry, I'm having trouble on my end right now. Miranda will text you back soon!", "to-customer");
      await deliver(base, MIRANDA, "Sandy here: I had a problem answering a customer, " + d.from + ". They said:\n\"" + String(d.text || "").slice(0, 300) + "\"\nCould you text them back from your phone?", "forwarded");
    }
  }
};
