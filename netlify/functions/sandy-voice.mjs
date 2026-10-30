// Sandy's phone line (added Oct 28 2026): call (448) 217-3502 and talk to Sandy out loud.
// Twilio answers the call, turns what you say into words, and sends it here; Sandy answers with Twilio's
// speaking voice. She uses the same Bookings app and the same brain as her texting (netlify/sandy/brain.mjs).
// Rules Randy asked for: Sandy repeats back any change and asks before doing it, then texts a confirmation.
//
// Twilio setting (done automatically by /api/twilio-voice-hook): (448) 217-3502 → Voice → "A call comes in" →
// https://mirandaraephotography.com/api/sandy-voice (HTTP POST).
//
// Twilio waits at most 15 seconds for an answer, and Sandy can take longer when she's making changes.
// So her thinking runs in the background (same queue as her texts) while this page keeps the caller on
// the line ("One moment…") and picks her answer up as soon as it's ready.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PEOPLE, MIRANDA, digits, env, deliver, record, sandyKey, sandyStore } from "../sandy/brain.mjs";
import { livePass } from "./sandy-live.mjs";

// Live conversations (Oct 28 2026): when SANDY_LIVE_CALLS is "on", Randy's and Miranda's calls go to
// sandy-live.mjs (talk naturally, cut in anytime). If that ever fails to start, the call drops back to
// the turn-by-turn version below, so the line always works.
const liveOn = () => env("SANDY_LIVE_CALLS").toLowerCase() === "on";

const VOICE = "Polly.Joanna-Neural";
// Live calls (Oct 28 2026): Twilio's default live voice is a man's. Sandy is a woman, so use the same
// woman's voice (Joanna) as the older phone line.
const LIVE_VOICE = "Joanna-Neural";
const HINTS = "Sandy, Miranda, Randy, Kallie, Bradyn, booking, deposit, paid in full, Venmo, Cash App, PayPal, Zelle, Pixieset, " +
  "sunrise, sunset, Mexico Beach, Port St. Joe, Cape San Blas, Panama City Beach, St. George Island, Destin, 30A, inquiry, extra, cancel";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = (body) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + body + "</Response>", { headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" } });
const say = (t) => '<Say voice="' + VOICE + '">' + esc(t) + "</Say>";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Proves the call really came through Miranda's Twilio account (same check as texting)
function fromTwilio(req, url, params) {
  const tok = env("TWILIO_AUTH_TOKEN"), sig = req.headers.get("x-twilio-signature") || "";
  if (!tok || !sig) return false;
  const s = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const mine = createHmac("sha1", tok).update(s).digest("base64");
  return mine.length === sig.length && timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Sandy's phone line.", { status: 200 });
  const url = new URL(req.url);
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const site = (env("URL") || "https://mirandaraephotography.com").replace(/\/$/, "");
  const urls = [req.url, site + url.pathname + url.search];
  if (!urls.some((u) => fromTwilio(req, u, params))) return new Response("Forbidden", { status: 403 });

  const base = url.origin;
  const here = base + "/api/sandy-voice";
  const call = String(params.CallSid || "").replace(/[^A-Za-z0-9]/g, "");
  const from = digits(params.From);
  const step = url.searchParams.get("step") || "start";
  const store = sandyStore(base);
  const key = "call-" + call;

  const listen = (miss = 0) => '<Gather input="speech" method="POST" action="' + esc(here + "?step=heard&miss=" + miss) + '" speechTimeout="auto" ' +
    'speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true" hints="' + esc(HINTS) + '"></Gather>';

  // Sandy's answer for this turn, if it's ready. Waits up to `ms` for it.
  const answerFor = async (turn, ms) => {
    const until = Date.now() + ms;
    for (;;) {
      const s = (await store.get(key, { type: "json" })) || {};
      if (s.answer && s.answer.turn === turn) return s.answer;
      if (Date.now() > until) return null;
      await sleep(400);
    }
  };
  const speak = (a) => say(a.reply) + (a.hang ? "<Hangup/>" : listen());

  // ----- A new call -----
  if (step === "start") {
    const person = PEOPLE[from];
    if (!person || !call) {
      // Anyone else (a customer). Sandy only talks with Randy and Miranda for now: tell Miranda someone called.
      await record(base, { kind: "call-other", from });
      await deliver(base, MIRANDA, "Sandy here: " + (params.From || "an unknown number") + " just called my number. I asked them to text instead, and I'll pass along anything they text. You may want to call them back.", "forwarded");
      return xml(say("Hi, you've reached the assistant line for Miranda Rae Photography. I can't take calls from this number yet. Please send a text to this number instead, and Miranda will get back to you. Thanks for calling!") + "<Hangup/>");
    }
    await store.setJSON(key, { from, turn: 0, history: [], started: new Date().toISOString() });
    const hello = "Hi " + person.name + ", it's Sandy. What can I do for you?";
    if (liveOn()) {
      const wss = base.replace(/^http/, "ws") + "/api/sandy-live?p=" + encodeURIComponent(livePass(call, from));
      return xml('<Connect action="' + esc(here + "?step=after") + '"><ConversationRelay url="' + esc(wss) + '" ttsProvider="Amazon" voice="' + LIVE_VOICE + '" welcomeGreeting="' + esc(hello) +
        '" interruptible="any" interruptSensitivity="medium" welcomeGreetingInterruptible="any" hints="' + esc(HINTS) + '"/></Connect>');
    }
    await record(base, { kind: "call-start", from });
    return xml(say(hello) + listen());
  }

  const s = (await store.get(key, { type: "json" })) || null;
  if (!s || s.from !== from) return xml(say("Sorry, I lost track of our call. Please call me back.") + "<Hangup/>");

  // ----- The live conversation ended -----
  if (step === "after") {
    let h = {}; try { h = JSON.parse(params.HandoffData || "{}"); } catch (e) {}
    if (h.done || params.SessionStatus === "completed" && !params.ErrorCode) return xml("<Hangup/>");
    // It didn't start or broke partway: note why, and carry on the old turn-by-turn way
    await record(base, { kind: "error", body: "live call ended early: " + [params.SessionStatus, params.ErrorCode, params.ErrorMessage, params.HandoffData].filter(Boolean).join(" · ") });
    return xml(say("Sorry about that. I'm still here. What can I do for you?") + listen());
  }

  // ----- They said something (or nothing) -----
  if (step === "heard") {
    const heard = String(params.SpeechResult || "").trim().slice(0, 1000);
    const miss = parseInt(url.searchParams.get("miss") || "0", 10) || 0;
    if (!heard) {
      if (miss >= 1) return xml(say("I didn't hear anything, so I'll let you go. Call me anytime. Bye!") + "<Hangup/>");
      return xml(say("Sorry, I didn't catch that. Go ahead.") + listen(miss + 1));
    }
    const turn = (s.turn || 0) + 1;
    await store.setJSON(key, { ...s, turn });
    // Sandy thinks in the background (her own queue, separate from texts)
    await fetch(base + "/.netlify/functions/sandy-reply-background", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sandy-key": await sandyKey(), "x-sandy-queue": "voice" },
      body: JSON.stringify({ kind: "voice", call, turn, from, text: heard, base }),
    });
    const a = await answerFor(turn, 9000);
    if (a) return xml(speak(a));
    return xml(say("One moment.") + '<Redirect method="POST">' + esc(here + "?step=wait&turn=" + turn + "&n=1") + "</Redirect>");
  }

  // ----- Still waiting on Sandy's answer -----
  if (step === "wait") {
    const turn = parseInt(url.searchParams.get("turn") || "0", 10);
    const n = parseInt(url.searchParams.get("n") || "1", 10) || 1;
    const a = await answerFor(turn, 10000);
    if (a) return xml(speak(a));
    if (n >= 6) return xml(say("Sorry, this is taking me too long. If I made a change, I'll still text you about it. Please call or text me again.") + "<Hangup/>");
    return xml((n === 2 ? say("Still working on it.") : "") + '<Redirect method="POST">' + esc(here + "?step=wait&turn=" + turn + "&n=" + (n + 1)) + "</Redirect>");
  }

  return xml(listen());
};

export const config = { path: "/api/sandy-voice" };
