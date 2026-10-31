// Miranda's photo swaps (added Oct 31 2026).
// On the private /my-photos page Miranda (or Randy) signs in with a passcode and can change the photos
// on the website's pages to any photo from her Pixieset portfolio. That's ALL that page can change:
// no wording, prices, buttons or layout.
//
// How it works: every photo on the site's pages already goes through one link,
// /.netlify/images?url=<photo>&w=..., so each page's photos are easy to spot. Her picks are saved here
// (page + original photo -> new photo), and when someone opens a page, this program swaps the photo
// link before the page is sent. Google and AI search see the new photo too, with an alt description
// that names the beach she tagged on /tag-photos. The page files in GitHub never change, so
// "Put back original" always works.
//
// GET  /api/photo-swaps            (x-pass)  -> { role, pages:[{stem,name,group,photos:[...]}], swaps, history, picks }
// POST /api/photo-swaps            (x-pass)  {pages:[stem...], orig, src, pos}  -> swap a photo on those pages
//                                            {pages:[stem...], orig, reset:true} -> put the original back
//                                            {pages:[stem...], orig, pos}        -> just move which part shows
//                                            {setPass:"1234"}  (Bookings passcode only) -> Miranda's own passcode
// Live site uses the "photo-swaps" store; test copies use "photo-swaps-test".
import { getStore } from "./blobs.mjs";

const LIVE_HOST = "mirandaraephotography.com";
const BOOKINGS_PASS_SHA256 = "37ba3881108bf3e48180350246c5959b9481633d0cb1d8694fb141dc74e5fe79"; // same as /log
const PIX = "https://images-pw.pixieset.com/site/B8woOD/";
const headers = { "Cache-Control": "no-store" };

// Pages that are private, retired, or are the full portfolio (those already show every photo)
const SKIP = new Set(["gallery", "photos", "favorites", "tag-photos", "book", "confirm", "new", "add-on", "deposit", "log",
  "move", "sandy", "thank-you", "privacy", "terms", "prices", "mexico-beach-sunrise-special", "my-photos"]);
const NAMES = {
  index: "Home page", "30a-photographer": "30A page", "affordable-beach-photographer": "Affordable page",
  "beach-wedding-photographer": "Wedding page", "beach-elopement-photographer": "Elopement page",
  "mini-elopement-photographer": "Mini Elopement page", "beach-proposal-photographer": "Proposal page",
  "maternity-beach-photographer": "Maternity page", "senior-portrait-photographer": "Senior page",
  "last-minute-beach-photographer": "Last-Minute page", "family-beach-photographer": "Family page",
  "holiday-family-beach-photos": "Holiday page", "beach-mini-session": "Beach Mini page",
  "panama-city-beach-photographer": "Panama City Beach page", "mexico-beach-photographer": "Mexico Beach page",
  "port-st-joe-photographer": "Port St. Joe page", "cape-san-blas-photographer": "Cape San Blas page",
  "st-george-island-photographer": "St. George Island page",
  // hidden ad pages
  elopement: "Elopement ad page", proposal: "Proposal ad page", maternity: "Maternity ad page", senior: "Senior ad page",
  "last-minute": "Last-Minute ad page", "holiday-family": "Holiday family ad page", "holiday-family-photos": "Thanksgiving ad page",
  "gulf-coast-199": "$199 Gulf Coast ad page", "destin-199": "$199 Destin ad page", "panama-city-beach-199": "$199 Panama City Beach ad page",
  "mexico-beach-199": "$199 Mexico Beach ad page", "port-st-joe-199": "$199 Port St. Joe ad page", "cape-san-blas-199": "$199 Cape San Blas ad page",
};

const isLive = (url) => new URL(url).hostname.replace(/^www\./, "") === LIVE_HOST;
const store = (live) => getStore({ name: live ? "photo-swaps" : "photo-swaps-test", consistency: "strong" });
const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- Saved swaps (kept in memory for a short while so pages stay fast) ----------
const CACHE = { live: null, test: null }, CACHE_AT = { live: 0, test: 0 };
async function loadState(live, fresh) {
  const k = live ? "live" : "test";
  if (!fresh && CACHE[k] && Date.now() - CACHE_AT[k] < 20000) return CACHE[k];
  let s = null;
  try { s = await store(live).get("state", { type: "json" }); } catch (e) { return CACHE[k] || { pages: {}, history: [] }; }
  s = s || { pages: {}, history: [] };
  s.pages = s.pages || {}; s.history = s.history || [];
  // her Pixieset photo list as of the last hourly check (see refreshPixieset)
  try { const px = await store(live).get("pix", { type: "json" }); s.pix = px && Array.isArray(px.ids) ? new Set(px.ids) : null; } catch (e) { s.pix = null; }
  CACHE[k] = s; CACHE_AT[k] = Date.now();
  return s;
}
async function saveState(live, s) {
  const { pix, ...keep } = s;
  await store(live).setJSON("state", keep);
  CACHE[live ? "live" : "test"] = s; CACHE_AT[live ? "live" : "test"] = Date.now();
}

// Which page file a request is for: "/" -> "index", "/family-beach-photographer/" -> "family-beach-photographer"
export function stemOf(pathname) {
  const s = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
  return s === "" || s === "index" ? "index" : s;
}
export const isSwappable = (stem) => !!stem && !SKIP.has(stem) && !stem.includes("/");

// ---------- Finding the photos on a page ----------
// Returns [{raw, src, kind, alt, count}] in page order. raw = the photo link exactly as written in the page.
export function findPhotos(html) {
  const out = new Map();
  const styles = [];
  for (const m of html.matchAll(/<style[\s\S]*?<\/style>/gi)) styles.push([m.index, m.index + m[0].length]);
  const inStyle = (i) => styles.some(([a, b]) => i >= a && i < b);
  for (const m of html.matchAll(/\/\.netlify\/images\?url=([^&"'\s)]+)/g)) {
    const raw = m[1];
    let src; try { src = decodeURIComponent(raw); } catch (e) { continue; }
    if (!/^(\/images\/|https:\/\/images-pw\.pixieset\.com\/)/.test(src)) continue;
    const tagStart = html.lastIndexOf("<", m.index);
    const tag = html.slice(tagStart, html.indexOf(">", m.index) + 1);
    const kind = inStyle(m.index) ? "background" : /^<source/i.test(tag) ? "phone" : /^<link/i.test(tag) ? "preload" : "photo";
    const altM = /^<img/i.test(tag) && tag.match(/\salt="([^"]*)"/);
    if (!out.has(raw)) out.set(raw, { raw, src, kind, alt: "", count: 0 });
    const p = out.get(raw);
    p.count++;
    if (kind !== "preload" && (p.kind === "preload")) p.kind = kind;
    if (kind === "background") p.kind = "background";
    if (altM && !p.alt) p.alt = altM[1];
  }
  return [...out.values()];
}

// The alt description for a swapped-in photo: the beach Miranda tagged on /tag-photos, if any
function altFor(src, tags) {
  const m = String(src).match(/pixieset\.com\/site\/B8woOD\/([A-Za-z0-9]+)\//);
  const beach = m && tags && tags[m[1]];
  return beach && !/^(Not sure|Not at a beach)$/.test(beach) ? `Beach photo in ${beach}, Florida, by Miranda Rae Photography` : "Florida Gulf Coast beach photo by Miranda Rae Photography";
}

// ---------- Swapping the photos on a page as it's sent ----------
export function applySwaps(html, swaps, tags) {
  // Step 1: mark each swapped photo's spots with a placeholder, so a new photo that's also used elsewhere
  // on the page (or two spots getting the same new photo) never mixes up which spot is which
  const jobs = [];
  for (const [raw, sw] of Object.entries(swaps || {})) {
    if (!sw || !sw.src) continue;
    let orig; try { orig = decodeURIComponent(raw); } catch (e) { continue; }
    const key = "__mrpswap" + jobs.length + "__";
    if (!html.includes("url=" + raw)) continue;
    html = html.split("url=" + raw).join("url=" + key);
    // full links in the page's search info (Google / AI search image fields)
    const abs = orig.startsWith("/") ? "https://" + LIVE_HOST + orig : orig;
    html = html.split(abs).join(key + "abs");
    jobs.push({ key, sw });
  }
  // Step 2: descriptions and "which part shows", then put the new photo links in
  for (const { key, sw } of jobs) {
    const alt = esc(altFor(sw.src, tags));
    const pos = /^\d{1,3}$/.test(String(sw.pos ?? "")) ? Math.min(100, +sw.pos) : null;
    html = html.replace(/<img\b[^>]*>/gi, (tag) => {
      if (!tag.includes("url=" + key)) return tag;
      tag = /\salt="[^"]*"/.test(tag) ? tag.replace(/\salt="[^"]*"/, ` alt="${alt}"`) : tag.replace(/<img/i, `<img alt="${alt}"`);
      if (pos != null) tag = /\sstyle="/.test(tag) ? tag.replace(/\sstyle="/, ` style="object-position:50% ${pos}%;`) : tag.replace(/<img/i, `<img style="object-position:50% ${pos}%"`);
      return tag;
    });
    if (pos != null) {
      // big background photos: the spot right after the photo link in the page's styles, e.g. "70% 60%/cover"
      const re = new RegExp("(url\\(['\"]?/\\.netlify/images\\?url=" + key + "[^)]*\\)\\s*)([^/;{}]*?)(\\s*/\\s*cover)", "g");
      html = html.replace(re, (all, a, b, c) => a + `50% ${pos}%` + c);
    }
    html = html.split(key + "abs").join(sw.src).split("url=" + key).join("url=" + encodeURIComponent(sw.src));
  }
  return html;
}

// A picked photo that's no longer in her Pixieset (she deleted it): the original goes back automatically
const idOfSrc = (src) => { const m = String(src || "").match(/pixieset\.com\/site\/B8woOD\/([A-Za-z0-9]+)\//); return m ? m[1] : null; };
const isGone = (sw, pix) => !!(pix && sw && sw.src && idOfSrc(sw.src) && !pix.has(idOfSrc(sw.src)));
const liveSwaps = (swaps, pix) => Object.fromEntries(Object.entries(swaps || {}).filter(([, sw]) => !isGone(sw, pix)));

// Hourly (from the site's every-minute timer): re-read her Pixieset photo list. Only trusted when the
// check finds most of her photos, so a Pixieset hiccup never sends every pick back to the original.
export async function refreshPixieset(live, getList) {
  const st = store(live);
  const old = (await st.get("pix", { type: "json" })) || { ids: [], at: 0 };
  if (Date.now() - (old.at || 0) < 55 * 60000) return;
  let ids = [];
  try { ids = ((await getList()).photos || []).map((p) => String(p).split("/")[0]).filter(Boolean); } catch (e) { return; }
  if (ids.length < 20 || ids.length < (old.ids || []).length * 0.6) { await st.setJSON("pix", { ...old, at: Date.now(), skipped: ids.length }); return; }
  await st.setJSON("pix", { ids, at: Date.now() });
  const k = live ? "live" : "test"; CACHE_AT[k] = 0; // pages pick it up right away
}

// Called by src/worker.mjs for every page it serves
export async function swapPage(res, stem, reqUrl) {
  if (!isSwappable(stem) || !res.ok || !/text\/html/.test(res.headers.get("content-type") || "")) return res;
  const live = isLive(reqUrl);
  const state = await loadState(live);
  const swaps = liveSwaps(state.pages[stem], state.pix);
  if (!Object.keys(swaps).length) {
    const out = new Response(res.body, res);
    out.headers.delete("ETag"); // the page can now change without its file changing
    return out;
  }
  const tags = await getTags(live);
  const html = applySwaps(await res.text(), swaps, tags);
  const r = new Response(html, { status: res.status, headers: res.headers });
  r.headers.delete("ETag"); r.headers.delete("Content-Length");
  return r;
}

let TAGS = null, TAGS_AT = 0;
async function getTags(live) {
  if (TAGS && Date.now() - TAGS_AT < 600000) return TAGS;
  try { const s = await getStore({ name: live ? "photo-tags" : "photo-tags-test" }).get("state", { type: "json" }); TAGS = (s && s.tags) || {}; } catch (e) { TAGS = TAGS || {}; }
  TAGS_AT = Date.now();
  return TAGS;
}

// ---------- The /my-photos page's program ----------
let INV = null;
async function inventory(env, origin) {
  if (INV) return INV;
  let stems = [];
  try { stems = await (await env.ASSETS.fetch(new Request(origin + "/photo-pages.json"))).json(); } catch (e) {}
  const pages = [];
  await Promise.all(stems.filter(isSwappable).map(async (stem) => {
    try {
      const r = await env.ASSETS.fetch(new Request(origin + "/" + (stem === "index" ? "" : stem)));
      if (!r.ok) return;
      const html = await r.text();
      const photos = findPhotos(html).filter((p) => p.kind !== "preload");
      if (!photos.length) return;
      const hidden = /<meta[^>]+noindex/i.test(html) || /-199$/.test(stem);
      const name = NAMES[stem] || stem.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " page";
      pages.push({ stem, name, group: hidden ? "ads" : "site", photos });
    } catch (e) {}
  }));
  const order = Object.keys(NAMES);
  pages.sort((a, b) => (a.group === b.group ? 0 : a.group === "site" ? -1 : 1) || ((order.indexOf(a.stem) + 1 || 999) - (order.indexOf(b.stem) + 1 || 999)) || a.name.localeCompare(b.name));
  INV = pages;
  return pages;
}

async function roleOf(req, live) {
  const pass = String(req.headers.get("x-pass") || "").trim().toLowerCase();
  if (!pass) return null;
  const h = await sha(pass);
  if (h === BOOKINGS_PASS_SHA256) return "bookings";
  const s = await loadState(live, true);
  if (s.pass && s.pass.hash === (await sha(s.pass.salt + pass))) return "miranda";
  return null;
}

// slow down guessing: after 8 wrong tries in 15 minutes, wait
async function tooManyTries(live, wrong) {
  const st = store(live);
  let t = (await st.get("tries", { type: "json" })) || { n: 0, at: 0 };
  if (Date.now() - t.at > 15 * 60000) t = { n: 0, at: Date.now() };
  if (wrong) { t.n++; await st.setJSON("tries", t); }
  return t.n >= 8;
}

export async function photoSwapsApi(req, env) {
  const url = new URL(req.url);
  const live = isLive(req.url);
  const j = (o, s = 200) => Response.json(o, { status: s, headers });
  if (await tooManyTries(live, false)) return j({ error: "wait" }, 429);
  const role = await roleOf(req, live);
  if (!role) { await tooManyTries(live, true); return j({ error: "passcode" }, 403); }

  const pages = await inventory(env, url.origin);
  if (req.method === "GET") {
    const s = await loadState(live, true);
    let picks = { favs: [], top: [] };
    try { picks = (await getStore({ name: live ? "photo-favorites" : "photo-favorites-test" }).get("state", { type: "json" })) || picks; } catch (e) {}
    return j({ role, pages, swaps: s.pages, history: s.history.slice(-30).reverse(), picks: { favs: picks.favs || [], top: picks.top || [] }, hasOwnPass: !!s.pass, test: !live,
      gone: Object.entries(s.pages).flatMap(([stem, pg]) => Object.entries(pg).filter(([, sw]) => isGone(sw, s.pix)).map(([orig]) => ({ stem, orig }))) });
  }
  if (req.method !== "POST") return j({ error: "not found" }, 404);
  let d = {}; try { d = await req.json(); } catch (e) {}
  const s = await loadState(live, true);
  const who = role === "miranda" ? "Miranda" : String(d.who || "").slice(0, 20) || "Bookings passcode";

  if (d.setPass != null) {
    if (role !== "bookings") return j({ error: "only with the Bookings passcode" }, 403);
    const p = String(d.setPass).trim().toLowerCase();
    if (p.length < 4) return j({ error: "Make it at least 4 characters" }, 400);
    if ((await sha(p)) === BOOKINGS_PASS_SHA256) return j({ error: "Pick something different from the Bookings passcode" }, 400);
    const salt = crypto.randomUUID();
    s.pass = { salt, hash: await sha(salt + p), at: new Date().toISOString() };
    await saveState(live, s);
    return j({ ok: true });
  }

  const known = new Map(pages.map((p) => [p.stem, p]));
  const targets = (Array.isArray(d.pages) ? d.pages : []).map(String).filter((x) => known.has(x));
  const orig = String(d.orig || "");
  if (!targets.length || !targets.every((x) => known.get(x).photos.some((p) => p.raw === orig))) return j({ error: "That photo isn't on that page" }, 400);
  const src = d.src == null ? null : String(d.src);
  if (src && !(src.startsWith(PIX) && /^[A-Za-z0-9._%\/-]+$/.test(src.slice(PIX.length)))) return j({ error: "Only photos from Miranda's Pixieset" }, 400);
  const pos = d.pos == null || d.pos === "" ? undefined : Math.max(0, Math.min(100, parseInt(d.pos, 10) || 0));

  const before = {};
  for (const stem of targets) {
    const pg = (s.pages[stem] = s.pages[stem] || {});
    before[stem] = pg[orig] ? { ...pg[orig] } : null;
    if (d.reset) delete pg[orig];
    else if (src) pg[orig] = { src, ...(pos != null ? { pos } : {}), at: new Date().toISOString(), by: who };
    else if (pg[orig] && pos !== undefined) pg[orig].pos = pos; // which part of her new photo shows
    if (!Object.keys(pg).length) delete s.pages[stem];
  }
  s.history.push({ at: new Date().toISOString(), by: who, pages: targets, orig, src: src || null, reset: !!d.reset, pos: pos ?? null, before });
  s.history = s.history.slice(-200);
  await saveState(live, s);
  return j({ ok: true, swaps: s.pages });
}
