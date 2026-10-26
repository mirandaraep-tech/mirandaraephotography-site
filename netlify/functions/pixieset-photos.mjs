// Live list of Miranda's Pixieset portfolio photos (added Oct 25 2026).
// The hidden /favorites page calls this so any photos Miranda adds to her Pixieset
// show up there automatically (marked NEW) without anyone updating the site.
// GET /api/pixieset-photos        -> { photos: ["Id/file-1000.jpeg", ...], updated }
// GET /api/pixieset-photos?debug=1 -> also lists which Pixieset pages were read
const SITE = "https://mirandaraesphotography.mypixieset.com";
const IMG = /images-pw\.pixieset\.com\/site\/B8woOD\/([A-Za-z0-9]+)\/([A-Za-z0-9._%-]+?)-(\d{3,4})\.(jpe?g|png|webp)/gi;
let cache = null, cacheAt = 0;

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (mirandaraephotography.com favorites page)" } });
  if (!r.ok) throw new Error(url + " " + r.status);
  return await r.text();
}

async function collect() {
  const pages = new Map(), found = new Map();
  const queue = [SITE + "/", SITE + "/gallery-1/"];
  const seen = new Set();
  while (queue.length && seen.size < 30) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let html;
    try { html = await getText(url); } catch (e) { pages.set(url, "error"); continue; }
    html = html.replace(/\\\//g, "/");
    let n = 0;
    for (const m of html.matchAll(IMG)) {
      const id = m[1], name = m[2];
      if (/logo/i.test(name)) continue;
      const path = id + "/" + name + "-" + m[3] + "." + m[4];
      // keep Pixieset's exact link (the code in each file name differs by size); prefer the 1000px one
      if (!found.has(id)) { found.set(id, path); n++; }
      else if (m[3] === "1000") found.set(id, path);
    }
    pages.set(url, n);
    // follow links to other pages on her Pixieset site (galleries)
    for (const m of html.matchAll(/href="(\/[a-z0-9-]+\/?)"/gi)) {
      let u = SITE + m[1];
      if (!u.endsWith("/")) u += "/";
      if (!seen.has(u) && !/\/(contact|about|client|blog|store|services|real-estate|terms)/i.test(u)) queue.push(u);
    }
  }
  return { photos: [...found.values()], pages: Object.fromEntries(pages), updated: new Date().toISOString() };
}

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");
  try {
    if (!cache || Date.now() - cacheAt > 10 * 60 * 1000) { cache = await collect(); cacheAt = Date.now(); }
    const body = debug ? cache : { photos: cache.photos, updated: cache.updated };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ photos: [], error: String(e) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};

export const config = { path: "/api/pixieset-photos" };
