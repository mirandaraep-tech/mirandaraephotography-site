// Cloudflare publish step (added Oct 27 2026): copies the site's pages and photos into .cf-public/
// for Cloudflare, leaving out code, settings and Netlify's _redirects (Cloudflare can't read Netlify's
// redirect format; src/worker.mjs handles those redirects itself).
import { cpSync, rmSync, mkdirSync, readdirSync } from "node:fs";

const OUT = ".cf-public";
const SKIP = new Set([".git", ".github", ".gitignore", ".assetsignore", OUT, ".wrangler", "node_modules", "src", "netlify", "tools",
  "wrangler.jsonc", "wrangler.toml", "package.json", "package-lock.json", "netlify.toml", "_redirects", "_headers"]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
let n = 0;
for (const name of readdirSync(".")) {
  if (SKIP.has(name) || name.endsWith(".mjs") || name.endsWith(".md")) continue;
  cpSync(name, OUT + "/" + name, { recursive: true });
  n++;
}
console.log("Copied " + n + " site items into " + OUT);

// Every page's photos, for Miranda's /my-photos page (Oct 31 2026, see src/photo-swaps.mjs)
import { writeFileSync, readFileSync } from "node:fs";
const { pageInfo, sortPages } = await import("../src/photo-swaps.mjs");
const pages = sortPages(readdirSync(OUT).filter((f) => f.endsWith(".html"))
  .map((f) => pageInfo(f.replace(/\.html$/, ""), readFileSync(OUT + "/" + f, "utf8"))).filter(Boolean));
writeFileSync(OUT + "/photo-pages.json", JSON.stringify(pages));
console.log("Listed " + pages.length + " pages with photos for /my-photos: " + pages.map((p) => p.stem).join(", "));
