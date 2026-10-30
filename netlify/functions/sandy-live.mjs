// Sandy's live phone conversations (added Oct 28 2026). Cloudflare only (uses its WebSocket support).
//
// The first phone line (sandy-voice.mjs) took turns: you talk, it goes quiet, "One moment...", Sandy answers.
// This version keeps an open connection to the call (Twilio "ConversationRelay"), so it feels like a real
// conversation:
//   - Sandy starts talking as soon as her first words are ready (her answer streams out as she thinks it)
//   - you can cut in while she's talking; she stops, listens, and knows what she'd already said
//   - a more natural speaking voice, and better hearing of what you say
// The rules stay the same as the first phone line: same bookings and brain as texting, she reads back any
// change and asks first (a change only goes through right after a yes), then texts a confirmation.
//
// sandy-voice.mjs answers the call and points Twilio here with a one-call pass (see livePass below), so only
// a call Sandy herself just answered for Randy or Miranda can connect.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PEOPLE, digits, env, chatLive, deliver, record, loadData, describeChange, changeWorked } from "../sandy/brain.mjs";

// ---------- The one-call pass ----------
const sign = (s) => createHmac("sha256", env("TWILIO_AUTH_TOKEN") + ":sandy-live").update(s).digest("base64url");
export function livePass(call, from) {
  const body = [call, digits(from), Date.now() + 2 * 60 * 1000].join(".");
  return body + "." + sign(body);
}
function checkPass(pass) {
  const p = String(pass || "").split(".");
  if (p.length !== 4 || !env("TWILIO_AUTH_TOKEN")) return null;
  const body = p.slice(0, 3).join("."), mine = sign(body);
  if (mine.length !== p[3].length || !timingSafeEqual(Buffer.from(mine), Buffer.from(p[3]))) return null;
  if (Number(p[2]) < Date.now()) return null;
  return { call: p[0], from: p[1] };
}

// ---------- The call ----------
export default function sandyLive(req) {
  if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response("Sandy's live line.", { status: 426 });
  const url = new URL(req.url);
  const pass = checkPass(url.searchParams.get("p"));
  if (!pass || !PEOPLE[pass.from]) return new Response("Forbidden", { status: 403 });
  const base = (env("URL") || url.origin).replace(/\/$/, "");

  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();
  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  const speak = (token, last = false) => send({ type: "text", token, last });

  let ready = false, history = [], turn = null, ended = false;

  const hangUp = (afterText) => {
    if (ended) return;
    ended = true;
    // Let the goodbye finish playing before handing the call back (about 15 letters a second, plus a beat)
    const wait = Math.min(8000, 1200 + (String(afterText || "").length / 15) * 1000);
    setTimeout(() => { send({ type: "end", handoffData: JSON.stringify({ done: true }) }); }, wait);
  };

  // Text the caller what changed (only changes that really went through)
  async function confirm(changes) {
    const done = changes.filter(changeWorked);
    if (!done.length) return;
    let data = null; try { data = await loadData(base); } catch (e) {}
    await deliver(base, pass.from, "Sandy here, confirming what I changed on our call:\n" + done.map((c) => "- " + describeChange(c, data)).join("\n"), "call-confirm");
  }

  // One thing the caller said → Sandy's answer, spoken as it comes
  async function answer(heard) {
    if (turn) {
      // They kept talking before she said anything: treat it as one longer thought
      const old = turn; old.ctrl.abort(); turn = null;
      if (!old.said.trim()) heard = old.heard + " " + heard;
    }
    const me = { ctrl: new AbortController(), said: "", heard, changes: [] };
    turn = me;
    // Hold back "[HANG UP]" (and anything in square brackets) so it's never spoken
    let hold = "", hang = false;
    const out = (t) => {
      if (turn !== me) return;
      hold += t;
      for (;;) {
        const a = hold.indexOf("[");
        if (a < 0) { if (hold) { me.said += hold; speak(hold); } hold = ""; return; }
        if (a > 0) { me.said += hold.slice(0, a); speak(hold.slice(0, a)); hold = hold.slice(a); }
        const b = hold.indexOf("]");
        if (b < 0) { if (hold.length > 30) { me.said += hold; speak(hold); hold = ""; } return; }
        if (/^\[\s*HANG ?UP\s*\]$/i.test(hold.slice(0, b + 1))) hang = true;
        hold = hold.slice(b + 1);
      }
    };
    try {
      await chatLive({
        base, from: pass.from, text: heard, history, signal: me.ctrl.signal, onText: out, changes: me.changes,
        onWorking: () => { if (turn === me && !me.said.trim()) { me.said += "One sec. "; speak("One sec. "); } },
      });
      if (turn !== me) return;
      if (hold && !/^\[/.test(hold)) { me.said += hold; speak(hold); }
      let said = me.said.trim();
      if (!said) { said = hang ? "Okay, bye!" : "Sorry, could you say that again?"; speak(said); }
      speak("", true);
      history = history.concat({ role: "user", content: heard }, { role: "assistant", content: said }).slice(-24);
      turn = null;
      await record(base, { kind: "call", from: pass.from, heard, body: said, live: true });
      if (hang) hangUp(said);
    } catch (e) {
      if (!me.ctrl.signal.aborted && turn === me) {
        turn = null;
        await record(base, { kind: "error", body: "live call: " + String(e.message || e) });
        speak("Sorry, something went wrong on my end. Could you say that again?", true);
      }
    } finally {
      // Even if she was cut off, anything she already changed gets its confirmation text
      try { await confirm(me.changes); } catch (e) {}
    }
  }

  ws.addEventListener("message", (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "setup") {
      // Must be the same call (and caller) the pass was made for
      if (String(m.callSid || "") !== pass.call || digits(m.from) !== pass.from) { send({ type: "end", handoffData: JSON.stringify({ error: "mismatch" }) }); return; }
      ready = true;
      record(base, { kind: "call-start", from: pass.from, live: true }).catch(() => {});
    } else if (!ready || ended) {
      return;
    } else if (m.type === "prompt" && m.last !== false) {
      const heard = String(m.voicePrompt || "").trim().slice(0, 1000);
      if (heard) answer(heard);
    } else if (m.type === "interrupt") {
      // They talked over her. Stop, and remember only what she actually got to say.
      if (turn) {
        const t = turn; turn = null; t.ctrl.abort();
        const part = String(m.utteranceUntilInterrupt || "").trim();
        if (part) history = history.concat({ role: "user", content: t.heard }, { role: "assistant", content: part + " (cut off)" }).slice(-24);
      } else if (m.utteranceUntilInterrupt && history.length && history[history.length - 1].role === "assistant") {
        history[history.length - 1] = { role: "assistant", content: String(m.utteranceUntilInterrupt).trim() + " (cut off)" };
      }
    } else if (m.type === "error") {
      record(base, { kind: "error", body: "live call (Twilio): " + String(m.description || "") }).catch(() => {});
    }
  });
  ws.addEventListener("close", () => { if (turn) turn.ctrl.abort(); turn = null; ended = true; });

  return new Response(null, { status: 101, webSocket: client });
}
