// mirandaraephotography.com on Cloudflare (added Oct 27 2026; replaces Netlify).
// One small program in front of the site's files that does what Netlify did for us:
//   - the old-page redirects in _redirects (same file, same rules)
//   - the /api/... programs (Bookings, Sandy, favorites, photo tags) — the same files in netlify/functions,
//     unchanged; their storage now lives in Cloudflare (see src/blobs.mjs)
//   - photo resizing at /.netlify/images?url=...&w=... (same links the pages already use)
//   - the quiet "Text Miranda tapped" / "link clicked" alert emails (Netlify Forms -> FormSubmit)
//   - Sandy's 9 AM check-in and her background replies
import { DurableObject } from "cloudflare:workers";
import { setEnv, getStore } from "./blobs.mjs";
import REDIRECTS from "../_redirects";
import bookingCounter from "../netlify/functions/booking-counter.mjs";
import photoFavorites from "../netlify/functions/photo-favorites.mjs";
import photoTags from "../netlify/functions/photo-tags.mjs";
import pixiesetPhotos from "../netlify/functions/pixieset-photos.mjs";
import sandyChat from "../netlify/functions/sandy-chat.mjs";
import sandySms from "../netlify/functions/sandy-sms.mjs";
import sandyDaily from "../netlify/functions/sandy-daily.mjs";
import sandyReply from "../netlify/functions/sandy-reply-background.mjs";

const LIVE_HOST = "mirandaraephotography.com";
const PASS_SHA256 = "37ba3881108bf3e48180350246c5959b9481633d0cb1d8694fb141dc74e5fe79"; // same as /log
const BACKGROUND = "/.netlify/functions/sandy-reply-background";

const API = {
  "/api/booking-counter": bookingCounter,
  "/api/photo-favorites": photoFavorites,
  "/api/photo-tags": photoTags,
  "/api/pixieset-photos": pixiesetPhotos,
  "/api/sandy": sandyChat,
  "/api/sandy-sms": sandySms,
};

// ---------- Sandy's background work ----------
// On Netlify, Sandy's replies ran as a "background function" (up to 15 min). Here they're handed to the
// SiteStore and run from its alarm, which can also take minutes. sandy-sms and sandy-daily still call
// the old address; this catches that call instead of going out to the internet.
let CTX_ENV = null;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  let u = null;
  try { u = new URL(typeof input === "string" ? input : input.url); } catch (e) {}
  if (u && u.pathname === BACKGROUND && CTX_ENV) {
    const h = new Headers(init.headers || {});
    const job = { key: h.get("x-sandy-key") || "", body: typeof init.body === "string" ? init.body : "" };
    await CTX_ENV.STORE.get(CTX_ENV.STORE.idFromName("jobs")).enqueue(job);
    return new Response("queued", { status: 202 });
  }
  return realFetch(input, init);
};

export class SiteStore extends DurableObject {
  constructor(ctx, env) { super(ctx, env); setEnv(env); CTX_ENV = env; }
  async getItem(k) { const v = await this.ctx.storage.get(k); return v === undefined ? null : v; }
  async setItem(k, v) { await this.ctx.storage.put(k, v); }
  async delItem(k) { await this.ctx.storage.delete(k); }
  async listKeys(prefix) { return [...(await this.ctx.storage.list({ prefix })).keys()]; }
  async enqueue(job) {
    const q = (await this.ctx.storage.get("jobs")) || [];
    q.push(job);
    await this.ctx.storage.put("jobs", q.slice(-50));
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 50);
  }
  async alarm() {
    const q = (await this.ctx.storage.get("jobs")) || [];
    await this.ctx.storage.put("jobs", []);
    for (const job of q) {
      try {
        await sandyReply(new Request("https://" + LIVE_HOST + BACKGROUND, {
          method: "POST", headers: { "Content-Type": "application/json", "x-sandy-key": job.key }, body: job.body,
        }));
      } catch (e) { console.log("sandy job failed", String(e)); }
    }
  }
}

// ---------- Redirects (the same _redirects file Netlify used) ----------
const RULES = String(REDIRECTS).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
  const [from, to, st] = l.split(/\s+/);
  const status = parseInt(st || "301", 10);
  const names = [];
  const rx = new RegExp("^" + from.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(?<splat>.*)")
    .replace(/:([a-z]+)/gi, (_, n) => { names.push(n); return "(?<" + n + ">[^/]+)"; }) + "/?$");
  return { rx, to, status, names };
}).filter((r) => r.to);

function redirectFor(url) {
  for (const r of RULES) {
    const m = url.pathname.match(r.rx);
    if (!m) continue;
    let to = r.to.replace(/:([a-z]+)/gi, (all, n) => (m.groups && m.groups[n] != null ? m.groups[n] : all));
    return { to, status: r.status };
  }
  return null;
}

// ---------- Photo resizing (same /.netlify/images links the pages use) ----------
async function image(req, url, env) {
  const src = url.searchParams.get("url") || "";
  const w = Math.min(3000, parseInt(url.searchParams.get("w") || "0", 10) || 0);
  const q = Math.min(100, parseInt(url.searchParams.get("q") || "80", 10) || 80);
  // The site's own photos are already web-sized: send them as they are
  if (src.startsWith("/") && !src.startsWith("//")) return withCache(await env.ASSETS.fetch(new Request(new URL(src, url.origin))));
  if (!/^https:\/\/images-pw\.pixieset\.com\//.test(src)) return new Response("Not found", { status: 404 });
  const webp = url.searchParams.get("fm") === "webp" && /image\/webp/.test(req.headers.get("accept") || "");
  // Miranda's Pixieset photos: Cloudflare's resizer (works on the real domain); if it isn't available, send the original photo
  try {
    const r = await realFetch(src, { cf: { image: { width: w || undefined, quality: q, fit: "scale-down", format: webp ? "webp" : undefined }, cacheEverything: true, cacheTtl: 2592000 } });
    if (r.ok && /^image\//.test(r.headers.get("content-type") || "")) return withCache(r);
  } catch (e) {}
  return withCache(await realFetch(src, { cf: { cacheEverything: true, cacheTtl: 2592000 } }));
}
function withCache(r) {
  const out = new Response(r.body, r);
  if (r.ok) out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return out;
}

// ---------- Old tap/click pings ----------
// Pages now email tap/click alerts straight to FormSubmit from the visitor's browser (FormSubmit doesn't
// answer Cloudflare's servers). A page still open from before the move may post here; just say ok.
async function pingAlert() { return new Response("ok"); }

// ---------- Moving the data over from Netlify (used by the private /move page) ----------
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const LIVE_STORES = ["booking-counter", "sandy", "photo-favorites", "photo-tags", "sandy-secret"];
async function moveImport(req) {
  const j = (o, s = 200) => Response.json(o, { status: s, headers: { "Cache-Control": "no-store" } });
  if ((await sha(String(req.headers.get("x-pass") || "").trim().toLowerCase())) !== PASS_SHA256) return j({ error: "passcode" }, 403);
  if (req.method === "GET") {
    const out = {};
    for (const n of LIVE_STORES.flatMap((s) => (s === "sandy-secret" ? [s] : [s, s + "-test"]))) {
      const st = getStore({ name: n }), { blobs } = await st.list();
      out[n] = {};
      for (const b of blobs) {
        const v = await st.get(b.key);
        let d = (v || "").length + " chars";
        try { const x = JSON.parse(v); if (Array.isArray(x)) d = x.length + " entries"; else if (x && typeof x === "object" && n.startsWith("booking-counter") && b.key === "state") d = "#" + x.last + " · $" + x.total; } catch (e) {}
        out[n][b.key] = d;
      }
    }
    return j({ stores: out });
  }
  let d; try { d = await req.json(); } catch (e) { return j({ error: "bad data" }, 400); }
  const mode = d.mode, stores = d.stores || {};
  if (!["test", "final", "merge"].includes(mode)) return j({ error: "mode" }, 400);
  const done = [];
  for (const name of LIVE_STORES) {
    const items = stores[name];
    if (!items || typeof items !== "object") continue;
    if (mode === "test" && name === "sandy-secret") continue;
    const st = getStore({ name: mode === "test" ? name + "-test" : name });
    for (const [key, val] of Object.entries(items)) {
      if (typeof val !== "string") continue;
      if (mode !== "merge") { await st.set(key, val); done.push(name + "/" + key); continue; }
      // merge: only add booking entries/log lines that came in on Netlify after the switch
      if (name !== "booking-counter" || !["bookings", "log"].includes(key)) continue;
      let theirs = []; try { theirs = JSON.parse(val) || []; } catch (e) {}
      const mine = (await st.get(key, { type: "json" })) || [];
      const id = key === "bookings" ? (x) => String(x.num) : (x) => (x.at || "") + "|" + (x.kind || "") + "|" + (x.name || "");
      const have = new Set(mine.map(id)), add = theirs.filter((x) => !have.has(id(x)));
      if (!add.length) continue;
      const all = mine.concat(add);
      if (key === "bookings") all.sort((x, y) => (x.num || 0) - (y.num || 0));
      else all.sort((x, y) => String(x.at).localeCompare(String(y.at)));
      await st.setJSON(key, key === "bookings" ? all.slice(-500) : all.slice(-1000));
      done.push(name + "/" + key + " +" + add.length + " (" + add.map((x) => x.name || x.kind).join(", ") + ")");
    }
  }
  return j({ ok: true, mode, done });
}

export default {
  async fetch(req, env, ctx) {
    setEnv(env); CTX_ENV = env;
    const url = new URL(req.url);
    const path = url.pathname;

    // www -> plain address (Netlify did this too)
    if (url.hostname === "www." + LIVE_HOST) { url.hostname = LIVE_HOST; return Response.redirect(url.toString(), 301); }

    if (API[path]) return API[path](req, {});
    if (path === "/api/move-import") return moveImport(req);
    if (path === BACKGROUND) return new Response("Not found", { status: 404 }); // only Sandy calls this, internally
    if (path === "/.netlify/images") return image(req, url, env);
    if (req.method === "POST" && path === "/") return pingAlert();

    const r = redirectFor(url);
    if (r) {
      if (r.status === 200) {
        if (/^https?:\/\//.test(r.to)) {
          const up = await realFetch(r.to, { cf: { cacheEverything: true, cacheTtl: 2592000 } });
          return withCache(up);
        }
        const t = new URL(r.to.replace(/\.html$/, ""), url.origin);
        t.search = url.search;
        return env.ASSETS.fetch(new Request(t, req));
      }
      const t = new URL(r.to, url.origin);
      if (!t.search && url.search) t.search = url.search; // keep ?gclid etc. like Netlify
      return Response.redirect(t.toString(), r.status === 302 ? 302 : 301);
    }
    return env.ASSETS.fetch(req);
  },

  // Sandy's morning check-in (9 AM Central). Only on the real site, never on the test copy.
  async scheduled(event, env, ctx) {
    setEnv(env); CTX_ENV = env;
    if (env.LIVE !== "yes") return;
    ctx.waitUntil(sandyDaily());
  },
};
