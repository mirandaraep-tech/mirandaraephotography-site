/* Beach headline swap for the Google Ads landing pages (Oct 30 2026).
   The ad link picks the beach: /gulf-coast-199?beach=destin  ->  headline shows Destin.
   No beach in the link (or one we don't know) = the page's normal all-beaches version.
   Optional ?for=... picks a headline option on pages that have them (couples, reunion, christmas...).

   What it does when a beach is picked:
   - the page swaps its headline words (each page says how, below its <script src="/beach-swap.js">)
   - the form's beach box is filled in, so the request email, the Bookings app and Sandy all see the beach
   - the Text Miranda message says the beach
   - tap/click alerts say the beach (PAGE gets " · Destin")
   - Photos / privacy / terms links keep the beach, so Back returns to the same version
   Each page has <link rel="canonical"> pointing at its plain address, so every ?beach= version
   counts as the same page for Google and AI search. */
(function () {
  // key: name, how it reads in a sentence, "[X] Beach" form (no "Beach Beach"), form dropdown value
  var B = {
    'destin':            { name: 'Destin',            at: 'in Destin',            wb: 'Destin Beach',            form: 'Destin' },
    'panama-city-beach': { name: 'Panama City Beach', at: 'in Panama City Beach', wb: 'Panama City Beach',       form: 'Panama City Beach' },
    '30a':               { name: '30A',               at: 'on 30A',               wb: '30A Beach',               form: '30A' },
    'santa-rosa-beach':  { name: 'Santa Rosa Beach',  at: 'in Santa Rosa Beach',  wb: 'Santa Rosa Beach',        form: 'Santa Rosa Beach (30A)' },
    'seaside':           { name: 'Seaside',           at: 'in Seaside',           wb: 'Seaside Beach',           form: 'Seaside (30A)' },
    'miramar-beach':     { name: 'Miramar Beach',     at: 'in Miramar Beach',     wb: 'Miramar Beach',           form: 'Miramar Beach (Destin)' },
    'rosemary-beach':    { name: 'Rosemary Beach',    at: 'in Rosemary Beach',    wb: 'Rosemary Beach',          form: 'Rosemary Beach (30A)' },
    'port-st-joe':       { name: 'Port St. Joe',      at: 'in Port St. Joe',      wb: 'Port St. Joe Beach',      form: 'Port St. Joe' },
    'cape-san-blas':     { name: 'Cape San Blas',     at: 'on Cape San Blas',     wb: 'Cape San Blas Beach',     form: 'Cape San Blas' },
    'st-george-island':  { name: 'St. George Island', at: 'on St. George Island', wb: 'St. George Island Beach', form: 'St. George Island' },
    'mexico-beach':      { name: 'Mexico Beach',      at: 'in Mexico Beach',      wb: 'Mexico Beach',            form: 'Mexico Beach' }
  };
  // Other ways an ad link might spell a beach (letters and numbers only)
  var ALIAS = { pcb: 'panama-city-beach', panamacity: 'panama-city-beach', santarosa: 'santa-rosa-beach', srb: 'santa-rosa-beach',
    miramar: 'miramar-beach', rosemary: 'rosemary-beach', portsaintjoe: 'port-st-joe', psj: 'port-st-joe', csb: 'cape-san-blas',
    saintgeorgeisland: 'st-george-island', stgeorge: 'st-george-island', sgi: 'st-george-island', mb: 'mexico-beach' };
  var squash = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  function find(raw) {
    var s = squash(raw);
    if (!s) return null;
    for (var k in B) if (squash(k) === s) return k;
    return ALIAS[s] || null;
  }

  window.mrpBeachSwap = function (cfg) {
    var q = new URLSearchParams(location.search);
    var key = find(q.get('beach'));
    var opt = squash(q.get('for'));
    var b = key ? Object.assign({ key: key }, B[key]) : null;
    var v = (cfg.variants && (cfg.variants[opt] || cfg.variants[''])) || null;
    var out = v ? v(b) : null;
    out = out || {};

    // Headline words: { 'css selector': 'new html' }
    var set = out.set || {};
    Object.keys(set).forEach(function (sel) { var el = document.querySelector(sel); if (el && set[sel] != null) el.innerHTML = set[sel]; });
    // Word swaps inside a bigger piece: [['css selector', 'old words', 'new words'], ...]
    (out.swap || []).forEach(function (r) { [].forEach.call(document.querySelectorAll(r[0]), function (el) { el.innerHTML = el.innerHTML.split(r[1]).join(r[2]); }); });
    if (out.title) document.title = out.title;
    if (out.session) { var st = document.getElementById('session-type'); if (st && st.tagName === 'INPUT') st.value = out.session; }
    if (!b) return;

    // Form: pick the beach (add it to the list if it's a town inside 30A/Destin)
    var sel = document.getElementById('beach');
    if (sel) {
      var hit = [].filter.call(sel.options, function (o) { return (o.value || o.text) === b.form; })[0];
      if (!hit) {
        hit = document.createElement('option'); hit.text = b.form;
        var before = [].filter.call(sel.options, function (o) { return /not sure|other/i.test(o.text); })[0];
        sel.insertBefore(hit, before || null);
      }
      hit.selected = true;
    }

    // Text message mentions the beach
    [].forEach.call(document.querySelectorAll('a[href^="sms:"]'), function (a) {
      var h = a.getAttribute('href'), i = h.indexOf('body=');
      if (i < 0) return;
      var body = decodeURIComponent(h.slice(i + 5));
      if (/beach and dates are: ?$/i.test(body)) body = body.replace(/(My|Our) beach and dates are: ?$/i, 'Beach: ' + b.name + '. $1 dates are: ');
      else { var j = body.lastIndexOf('. '); body = j > 0 ? body.slice(0, j + 2) + 'Beach: ' + b.name + '. ' + body.slice(j + 2) : 'Beach: ' + b.name + '. ' + body; }
      a.setAttribute('href', h.slice(0, i + 5) + encodeURIComponent(body));
    });

    // Alerts and links keep the beach
    try { if (typeof window.PAGE === 'string') window.PAGE = window.PAGE + ' · ' + b.name; } catch (e) {}
    [].forEach.call(document.querySelectorAll('a[href^="/photos?from="], a[href^="/privacy?from="], a[href^="/terms?from="]'), function (a) {
      a.setAttribute('href', a.getAttribute('href') + '&beach=' + key + (opt ? '&for=' + opt : ''));
    });
  };
})();
