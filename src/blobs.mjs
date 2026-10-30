// Cloudflare stand-in for Netlify's "@netlify/blobs" (added Oct 27 2026 for the Netlify -> Cloudflare move).
// wrangler.jsonc points every `import { getStore } from "@netlify/blobs"` here, so the Bookings, Sandy,
// favorites and photo-tag programs run unchanged. Everything is kept in one Cloudflare Durable Object
// ("SiteStore" in src/worker.mjs), which always reads the very latest value (same as Netlify's
// "strong" consistency), so two quick entries can't overwrite each other's numbers.
let ENV = null;

export function setEnv(env) {
  ENV = env;
  // brain.mjs reads secrets through Netlify.env.get(); give it the Cloudflare settings instead
  globalThis.Netlify = { env: { get: (k) => (ENV && typeof ENV[k] === "string" ? ENV[k] : undefined) } };
}

const stub = () => {
  if (!ENV || !ENV.STORE) throw new Error("site storage not ready");
  return ENV.STORE.get(ENV.STORE.idFromName("site"));
};
const SEP = "\u0000"; // store name + key, e.g. "booking-counter\u0000bookings"

export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts && opts.name;
  if (!name) throw new Error("store name missing");
  const k = (key) => name + SEP + String(key);
  return {
    async get(key, o) {
      const v = await stub().getItem(k(key));
      if (v == null) return null;
      if (o && o.type === "json") { try { return JSON.parse(v); } catch (e) { return null; } }
      return v;
    },
    async set(key, value) { await stub().setItem(k(key), String(value)); },
    async setJSON(key, value) { await stub().setItem(k(key), JSON.stringify(value)); },
    async delete(key) { await stub().delItem(k(key)); },
    async list() {
      const keys = await stub().listKeys(name + SEP);
      return { blobs: keys.map((x) => ({ key: x.slice(name.length + 1), etag: "" })), directories: [] };
    },
  };
}
