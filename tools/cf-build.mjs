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
