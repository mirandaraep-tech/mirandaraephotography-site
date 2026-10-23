#!/usr/bin/env node
// Master price list → every page.
//
//   node tools/prices.mjs          rewrite pages from prices.json
//   node tools/prices.mjs --check  only report pages that are out of date (exit 1 if any)
//
// Pages stay plain HTML (so Google and AI search tools read the real prices);
// this script just rewrites the marked spots:
//   <span data-p="special.photos">30–35</span>          one value (data-f="upper" for capitals)
//   <meta ... data-tpl="… {special.time} …" content="…"> an attribute built from a template
//   <!--prices:NAME args--> … <!--/prices:NAME-->         a generated block (HTML, llms.txt)
//   /*prices:NAME args*/ … /*/prices:NAME*/              a generated block inside a script
// Prices inside page titles and URLs (e.g. /destin-199) are NOT changed automatically.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'prices.json'), 'utf8'));
const CHECK = process.argv.includes('--check');

const money = n => '$' + Number(n).toLocaleString('en-US');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = s => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '→').replace(/\s+/g, ' ').trim();

// "30 minutes" → "30-minute"; "45–60 minutes" → "45–60 minute"
const adj = w => /^\d+ minutes$/.test(w) ? w.replace(' minutes', '-minute') : w.replace(/ minutes$/, ' minute').replace(/ hours$/, ' hour');

function pkg(id) { const p = P.packages[id]; if (!p) throw new Error('No package "' + id + '" in prices.json'); return p; }

// Short line: "45–60 min · 30–35 edited photos · up to 11 people · 1 location · 1 outfit change"
function summary(p, o = {}) {
  const bits = [];
  if (p.time) bits.push(p.time);
  if (p.photos) bits.push(p.photos + ' edited photos');
  if (p.people) bits.push('up to ' + p.people + ' people');
  if (!o.short) bits.push(...p.details);
  if (p.summaryExtra) bits.push(p.summaryExtra);
  return bits.join(' · ');
}

// Bullet list for the Prices page, mirroring Pixieset
function includes(p) {
  const out = [];
  const w = p.timeWords, cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (w) out.push(/hour/.test(w) && /wedding/i.test(p.name) ? cap(w) + ' of coverage' : /minutes$/.test(w) ? cap(adj(w)) + ' session' : cap(w));
  if (p.people) out.push('Up to ' + p.people + ' people');
  out.push(...p.details.map(d => d.charAt(0).toUpperCase() + d.slice(1)));
  if (p.photos) out.push(p.photos + ' professionally edited photos');
  out.push(...(p.more || []));
  out.push('Private online gallery to view and download');
  return out;
}

function value(key) {
  if (key === 'deposit') return money(P.deposit);
  const [a, b, c] = key.split('.');
  if (a === 'extras') { const x = P.extras[b]; if (!x) throw new Error('No extra "' + b + '"'); return c === 'unit' ? x.unit : money(x.price); }
  if (a === 'travel') { const t = P.travel[key.slice(7).replace(/_/g, ' ')]; if (t == null) throw new Error('No travel fee for "' + b + '"'); return money(t); }
  const p = pkg(a);
  switch (b) {
    case 'price': return money(p.price);
    case 'name': return p.name;
    case 'time': return p.time;
    case 'timeWords': return p.timeWords;
    case 'timeAdj': return adj(p.timeWords);
    case 'photos': return p.photos;
    case 'people': return String(p.people);
    case 'summary': return summary(p);
    case 'summaryShort': return summary(p, { short: true });
    case 'details': return p.details.join(' · ');
    default: throw new Error('Unknown field "' + key + '"');
  }
}

function filt(v, f) {
  if (!f) return v;
  for (const one of f.split('|')) {
    if (one === 'upper') v = v.toUpperCase();
    else if (one === 'lower') v = v.toLowerCase();
    else if (one === 'cap') v = v.charAt(0).toUpperCase() + v.slice(1);
    else throw new Error('Unknown filter "' + one + '"');
  }
  return v;
}

const tpl = s => s.replace(/\{([\w.]+)(?:\|([\w|]+))?\}/g, (_, k, f) => filt(value(k), f));

const travelLine = () => {
  const groups = {};
  for (const [b, fee] of Object.entries(P.travel)) (groups[fee] = groups[fee] || []).push(b);
  return Object.entries(groups).map(([fee, bs]) => money(fee) + ' travel fee for ' + bs.join(', ').replace(/, ([^,]*)$/, ' & $1')).join('; ');
};

// ---------- generated blocks ----------
const offer = id => { const p = pkg(id); return { '@type': 'Offer', name: p.name + (p.where ? ' — ' + p.where.replace(/ · /g, ', ') : ''), price: String(p.price), priceCurrency: 'USD', description: summary(p).replace(/ · /g, ', ') + '.' }; };
const ids = a => (a.ids || '').split(',').filter(Boolean);

const BLOCKS = {
  // Home page price list (li rows)
  'home-list': (a, old) => ids(a).map(id => {
    const p = pkg(id), nm = /^wedding/.test(id) ? '<a href="/beach-wedding-photographer">' + esc(p.name) + '</a>' : esc(p.name);
    return '\n      <li><div><b>' + nm + '</b><small>' + esc(summary(p)) + '</small>' + (p.where ? '<small class="where">' + esc(p.where) + '</small>' : '') + '</div><strong>' + money(p.price) + '</strong></li>';
  }).join('') + '\n      ',

  // /book plain list
  'book-list': a => ids(a).map(id => {
    const p = pkg(id);
    return '\n    <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid rgba(0,0,0,.08)"><span><b>' + esc(p.name) + '</b><br><small>' + esc(summary(p)) + '</small></span><b>' + money(p.price) + '</b></div>';
  }).join('') + '\n    ',

  // Prices page: package cards
  'prices-cards': a => ids(a).map(id => {
    const p = pkg(id);
    return '\n      <article class="pkg" id="' + id + '"><div class="pkg-top"><h3>' + esc(p.name) + '</h3><strong>' + money(p.price) + '</strong></div>' +
      (p.where ? '<p class="where">' + esc(p.where) + '</p>' : '') + '<p>' + esc(p.blurb) + '</p><ul>' + includes(p).map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></article>';
  }).join('') + '\n    ',

  // Prices page: extras + travel table
  'prices-extras': () => Object.values(P.extras).map(x =>
    '\n        <li><span>' + esc(x.name) + '</span><b>' + money(x.price) + (x.unit ? ' <small>' + esc(x.unit) + '</small>' : '') + '</b></li>').join('') +
    Object.entries(P.travel).map(([b, fee]) => '\n        <li><span>Travel fee: ' + esc(b) + '</span><b>' + money(fee) + '</b></li>').join('') + '\n      ',

  // one JSON-LD script: replace a key with offers built from prices.json
  'json-offers': (a, old) => {
    const m = old.match(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/);
    const obj = JSON.parse(m[2]);
    obj[a.key] = ids(a).map(offer);
    return '\n' + m[1] + '\n' + JSON.stringify(obj, null, 2) + '\n' + m[3] + '\n';
  },

  // FAQ JSON-LD rebuilt from the page's own visible FAQ (so they can never disagree)
  'faq-jsonld': (a, old, page) => {
    const qa = [...page.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/details>/g)].map(m => ({ q: plain(m[1]), a: plain(m[2]) }));
    if (!qa.length) throw new Error('faq-jsonld: no visible FAQ found');
    const obj = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
    return '\n<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n</script>\n';
  },

  // New Booking (/new) and /log package menus: [name, price, length, people, photos]
  'booking-pk': a => {
    const pre = a.dollar === 'yes';
    return '\n' + ids(a).map(id => {
      const p = pkg(id);
      const nm = (pre && (id === 'mini' || id === 'special') ? money(p.price) + ' ' : '') + p.booking;
      const len = [p.timeWords && p.timeWords.charAt(0).toUpperCase() + p.timeWords.slice(1), ...p.details.filter(d => /outfit|location/.test(d))].filter(Boolean).join(' · ');
      const ppl = p.bookingPeople || (p.people ? 'Up to ' + p.people : '');
      const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      return (a.indent === 'no' ? '' : '    ') + '[' + [q(nm), p.price, q(len), q(ppl), q(p.photos || (/wedding/.test(id) ? 'Full gallery' : ''))].join(', ') + '],';
    }).join('\n') + '\n    ';
  },

  // llms.txt price section
  'llms': () => '\n' + Object.entries(P.packages).map(([id, p]) => '- ' + p.name + (p.where ? ' (' + p.where.replace(/ · /g, ', ') + ')' : '') + ' — ' + money(p.price) + ': ' + summary(p).replace(/ · /g, ', ') + '.').join('\n') +
    '\n- Extras: ' + Object.values(P.extras).map(x => x.name.toLowerCase() + ' ' + money(x.price) + (x.unit ? ' ' + x.unit : '')).join('; ') + '.' +
    '\n- Travel: ' + travelLine() + '.' +
    '\n- A ' + money(P.deposit) + ' non-refundable deposit holds your date and comes off the session price.\n',

  'travel-line': () => esc(travelLine()),
};

function parseArgs(s) { const o = {}; (s || '').trim().split(/\s+/).filter(Boolean).forEach(kv => { const i = kv.indexOf('='); o[kv.slice(0, i)] = kv.slice(i + 1); }); return o; }

function render(src) {
  let out = src;
  // blocks (HTML comment style and JS comment style)
  for (const [open, close] of [[/<!--prices:([\w-]+)([^>]*?)-->([\s\S]*?)<!--\/prices:\1-->/g, null], [/\/\*prices:([\w-]+)([^*]*?)\*\/([\s\S]*?)\/\*\/prices:\1\*\//g, null]]) {
    out = out.replace(open, (all, name, args, inner) => {
      const fn = BLOCKS[name]; if (!fn) throw new Error('Unknown block "' + name + '"');
      const body = fn(parseArgs(args), inner, out);
      return all.startsWith('<!--') ? '<!--prices:' + name + args + '-->' + body + '<!--/prices:' + name + '-->' : '/*prices:' + name + args + '*/' + body + '/*/prices:' + name + '*/';
    });
  }
  // single values
  out = out.replace(/(<(span|data) data-p="([\w.]+)"(?: data-f="([\w|]+)")?>)([^<]*)(<\/\2>)/g, (_, a, tag, k, f, __, z) => a + esc(filt(value(k), f)) + z);
  // attribute templates
  out = out.replace(/data-tpl="([^"]*)" content="[^"]*"/g, (_, t) => 'data-tpl="' + t + '" content="' + esc(tpl(t.replace(/&amp;/g, '&'))) + '"');
  return out;
}

// FAQ JSON-LD is built from the page after its spans are filled, so run twice.
const files = fs.readdirSync(ROOT).filter(f => /\.(html|txt)$/.test(f));
let changed = [];
for (const f of files) {
  const fp = path.join(ROOT, f), src = fs.readFileSync(fp, 'utf8');
  if (!/data-p="|data-tpl="|prices:/.test(src)) continue;
  const out = render(render(src));
  if (out !== src) { changed.push(f); if (!CHECK) fs.writeFileSync(fp, out); }
}
console.log(changed.length ? (CHECK ? 'Out of date: ' : 'Updated: ') + changed.join(', ') : 'All pages already match prices.json');
if (CHECK && changed.length) process.exit(1);
