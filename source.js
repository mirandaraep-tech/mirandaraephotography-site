/* Lead source tracking (added Sept 30 2026; loaded on every page).
   Remembers where a visitor came from (Google Ad, Google search, ChatGPT, Facebook...)
   and adds it to every form, Text Miranda tap and link-click alert email. */
(function () {
  var KEY = 'mrp-src', DAYS = 30;
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function detect() {
    var p = new URLSearchParams(location.search), g = function (k) { return (p.get(k) || '').trim(); };
    var med = g('utm_medium').toLowerCase(), src = g('utm_source'), camp = g('utm_campaign'), term = g('utm_term');
    var clickId = g('gclid') || g('gbraid') || g('wbraid');
    var ref = host(document.referrer), me = location.hostname.replace(/^www\./, '');
    var label = '', extra = [];
    if (clickId || /^(cpc|ppc|paid|pmax)$/.test(med)) {
      label = 'Google Ad';
      if (camp) extra.push('campaign: ' + camp);
      if (term) extra.push('search: ' + term);
    } else if (src) {
      label = /chatgpt|openai/i.test(src) ? 'ChatGPT' : /gemini/i.test(src) ? 'Gemini' : /perplexity/i.test(src) ? 'Perplexity' : /copilot/i.test(src) ? 'Copilot' : src + (med ? ' (' + med + ')' : '');
      if (camp) extra.push('campaign: ' + camp);
    } else if (ref && ref !== me) {
      if (/^gemini\.google\./.test(ref)) label = 'Gemini';
      else if (/(^|\.)google\./.test(ref)) label = 'Google search (free)';
      else if (/bing\.com$/.test(ref)) label = 'Bing search (free)';
      else if (/(chatgpt\.com|openai\.com)$/.test(ref)) label = 'ChatGPT';
      else if (/copilot\.microsoft\.com$/.test(ref)) label = 'Copilot';
      else if (/claude\.ai$/.test(ref)) label = 'Claude';
      else if (/perplexity\.ai$/.test(ref)) label = 'Perplexity';
      else if (/(facebook\.com|fb\.com|fb\.me)$/.test(ref)) label = 'Facebook';
      else if (/instagram\.com$/.test(ref)) label = 'Instagram';
      else label = 'Link from ' + ref;
    }
    if (!label) return null; // direct visit or moving around the site: keep what we already know
    return { label: label, extra: extra.join(', '), landed: location.pathname, t: Date.now(),
      camp: camp, term: term, click: clickId, ref: ref };
  }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved && Date.now() - saved.t > DAYS * 864e5) saved = null;
  var now = detect();
  if (now) { saved = now; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  if (!saved) saved = { label: 'Direct or unknown', extra: '', landed: location.pathname, t: Date.now() };

  function summary() {
    var d = new Date(saved.t);
    return saved.label + (saved.extra ? ' - ' + saved.extra : '') +
      ' - first page ' + saved.landed + ' on ' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  window.mrpSource = summary;

  // 1) Tap / click alerts: add the source to the "page" field of every background ping
  var of = window.fetch;
  if (of) window.fetch = function (url, opts) {
    try {
      if (opts && typeof opts.body === 'string' && /(^|&)form-name=/.test(opts.body) && /(^|&)page=/.test(opts.body)) {
        opts.body = opts.body.replace(/(^|&)page=([^&]*)/, function (m, a, v) {
          return a + 'page=' + v + encodeURIComponent('  |  came from: ' + summary());
        });
      }
    } catch (e) {}
    return of.apply(this, arguments);
  };

  // 2) Booking forms: add the source to the bottom of the message
  document.addEventListener('submit', function (e) {
    var f = e.target, m = f && f.elements && f.elements['message'];
    var el = f && f.elements;
    if (el && el['came-from']) {
      var NP = 'not provided', d0 = new Date(saved.t), set = function (k, val) { if (el[k]) el[k].value = val || NP; };
      set('came-from', saved.label + ' (first visit ' + (d0.getMonth() + 1) + '/' + d0.getDate() + ')');
      set('campaign', saved.camp); set('search-phrase', saved.term); set('google-ads-click-id', saved.click);
      set('referring-site', saved.ref); set('first-page', saved.landed);
      return;
    }
    if (m && m.value.indexOf('Came from:') === -1) {
      m.value = (m.value ? m.value + '\n\n' : '') + 'Came from: ' + summary();
    }
  }, true);
})();

// 3) Google Analytics lead tracking (added Oct 4 2026).
//    Sends finished forms and Text/Call taps to Google Analytics so leads can be
//    compared across all three websites. Does not change the forms, alert emails or Google Ads tracking.
(function () {
  var GA = 'G-DXQ60XNC8Y', PEND = 'mrp-lead-pending', TAPS = /^(text-tap|call-tap|link-click)$/;
  function ga(name, params) {
    try {
      if (typeof window.gtag !== 'function') return;
      var p = { send_to: GA };
      for (var k in (params || {})) p[k] = params[k];
      window.gtag('event', name, p);
    } catch (e) {}
  }
  // Booking form sent: remember it so the thank-you page can record one lead
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.getAttribute) return;
    var n = f.getAttribute('name') || (f.elements && f.elements['form-name'] && f.elements['form-name'].value) || 'form';
    if (TAPS.test(n)) return;
    try { sessionStorage.setItem(PEND, JSON.stringify({ form: n, page: location.pathname })); } catch (err) {}
    ga('inquiry_form_submit', { form_name: n, inquiry_page: location.pathname });
  }, true);
  // Thank-you page after a real form send = a lead
  if (/thank/i.test(location.pathname)) {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(PEND) || 'null'); sessionStorage.removeItem(PEND); } catch (e) {}
    if (p) ga('generate_lead', { lead_type: p.form, inquiry_landing_page: p.page, lead_source: (window.mrpSource ? window.mrpSource().slice(0, 100) : '') });
  }
  // Text Miranda / Call taps
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/^sms:/i.test(h)) ga('text_message_click', { link_page: location.pathname });
    else if (/^tel:/i.test(h)) ga('phone_call_click', { link_page: location.pathname });
  }, true);
})();

// 4) Email subject lines (added Oct 7 2026).
//    Puts the lead's name, date, beach and price in the alert email's subject line,
//    e.g. "📩 NEW REQUEST: Jessica Smith — Oct 18 — Destin — $199".
(function () {
  var BEACH = { 'mexico-beach': 'Mexico Beach', 'port-st-joe': 'Port St. Joe', 'cape-san-blas': 'Cape San Blas',
    'panama-city-beach': 'Panama City Beach', 'st-george-island': 'St. George Island', '30a': '30A', 'destin': 'Destin' };
  var P130 = /^(Mexico Beach|Port St\. Joe|Cape San Blas|Panama City Beach)$/, P199 = /^(Destin|30A|St\. George Island)$/;
  window.mrpPrice = function (beach, wedding) {
    if (wedding) return '$499';
    if (P130.test(beach)) return '$130';
    if (P199.test(beach)) return '$199';
    return '';
  };
  window.mrpPriceLabel = function (p) { return p === '$130' ? '$130 Mini' : p === '$199' ? '$199 Beach Special' : p === '$499' ? '$499 Wedding' : p; };
  window.mrpDate = function (v, long) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      try { return new Date(v + 'T12:00:00').toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }); } catch (e) {}
    }
    return v;
  };
  document.addEventListener('submit', function (e) {
    try {
      var f = e.target, el = f && f.elements;
      var subj = el && (el['subject'] || el['_subject']);
      if (!subj) return;
      var v = function (k) { var x = el[k]; return x && x.value ? String(x.value).trim() : ''; };
      var path = location.pathname, beach = v('beach');
      var wedding = /wedding/i.test(path) || /wedding/i.test(beach) || /wedding/i.test(v('session'));
      if (/^(wedding|not sure yet|other)$/i.test(beach)) beach = '';
      if (!beach) { for (var k in BEACH) { if (path.indexOf('/' + k) === 0) { beach = BEACH[k]; break; } } }
      var parts = [v('name') || 'No name', v('date') ? window.mrpDate(v('date'), true) : 'no date yet', beach, window.mrpPriceLabel(window.mrpPrice(beach, wedding))].filter(Boolean);
      subj.value = '📩 NEW REQUEST: ' + parts.join(' · ');
    } catch (err) {}
  }, true);
})();

// 5) Contact preference (added Oct 8 2026): phone is always required; email is also
//    required when the visitor picks Email.
(function () {
  function pickOf(f) {
    var r = f.querySelector('input[name="reply"]:checked');
    if (r) return r.value;
    var s = f.elements && f.elements['contact-pref'];
    return s ? s.value : '';
  }
  function sync(f) {
    var el = f.elements, ph = el && el['phone'], em = el && el['email'];
    if (!ph || !em) return;
    var byEmail = /email/i.test(pickOf(f));
    em.required = byEmail;
    ph.required = true; // phone always required so Miranda can always text (Oct 8 2026)
  }
  function isBooking(f) { return f && /^booking-/.test(f.getAttribute('name') || ''); }
  function all() { [].forEach.call(document.querySelectorAll('form[name^="booking-"]'), sync); }
  document.addEventListener('change', function (e) { var f = e.target && e.target.form; if (isBooking(f)) sync(f); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
})();

// 6) Keep what visitors typed if a send fails (added Oct 8 2026). Saved only in this browser tab,
//    cleared once the thank-you page loads.
(function () {
  var KEYS = ['name', 'phone', 'email', 'date', 'beach', 'who', 'people', 'message', 'contact-pref', 'heard-from'];
  function key(f) { return 'mrp-draft-' + (f.getAttribute('name') || ''); }
  function isBooking(f) { return f && /^booking-/.test(f.getAttribute('name') || ''); }
  function save(f) {
    try {
      var el = f.elements, o = {};
      KEYS.forEach(function (k) { var x = el[k]; if (x && typeof x.value === 'string' && x.type !== 'radio') o[k] = x.value; });
      var r = f.querySelector('input[name="reply"]:checked'); if (r) o.reply = r.value;
      sessionStorage.setItem(key(f), JSON.stringify(o));
      var pick = o.reply || o['contact-pref'] || '';
      if (pick) sessionStorage.setItem('mrp-reply', pick);
      sessionStorage.setItem('mrp-contact', JSON.stringify({ phone: o.phone || '', email: o.email || '' }));
    } catch (e) {}
  }
  function restore(f) {
    try {
      var o = JSON.parse(sessionStorage.getItem(key(f)) || 'null'); if (!o) return;
      var el = f.elements;
      KEYS.forEach(function (k) { var x = el[k]; if (o[k] && x && !x.value && x.type !== 'radio') x.value = o[k]; });
      var r = o.reply ? f.querySelector('input[name="reply"][value="' + o.reply + '"]') : null;
      if (r) r.checked = true;
      var t = r || el['contact-pref']; if (t) t.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }
  function start() {
    if (/\/thank-you/.test(location.pathname)) {
      try { for (var i = sessionStorage.length - 1; i >= 0; i--) { var k = sessionStorage.key(i); if (k && k.indexOf('mrp-draft-') === 0) sessionStorage.removeItem(k); } } catch (e) {}
      return;
    }
    [].forEach.call(document.querySelectorAll('form[name^="booking-"]'), restore);
  }
  document.addEventListener('input', function (e) { var f = e.target && e.target.form; if (isBooking(f)) save(f); }, true);
  document.addEventListener('change', function (e) { var f = e.target && e.target.form; if (isBooking(f)) save(f); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();


// 7) Typo checks (added Oct 8 2026): phone must have 10 digits, email must look like an address.
(function () {
  function digits(v) { var d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1); return d; }
  function check(f) {
    var el = f.elements, ph = el && el['phone'], em = el && el['email'];
    if (ph && ph.setCustomValidity) {
      ph.setCustomValidity(ph.value && digits(ph.value).length !== 10 ? 'Please enter a 10-digit phone number, like 850-555-0142.' : '');
    }
    if (em && em.setCustomValidity) {
      em.setCustomValidity(em.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim()) ? 'Please check your email address, like name@gmail.com.' : '');
    }
  }
  function isBooking(f) { return f && /^booking-/.test(f.getAttribute('name') || ''); }
  document.addEventListener('input', function (e) { var f = e.target && e.target.form; if (isBooking(f)) check(f); }, true);
  document.addEventListener('submit', function (e) { if (isBooking(e.target)) check(e.target); }, true);
  document.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('button, input[type="submit"]'); var f = b && b.form; if (isBooking(f)) check(f); }, true);
})();


// 8) Visit count (added Oct 10 2026). Counts how many separate times this person has
//    come to the site (in this browser) and adds e.g. "3 visits · first 10/10 · latest 10/12"
//    to the bottom of every lead email, with the other tracking details.
(function () {
  var KEY = 'mrp-visits', v = null;
  function md(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }
  try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!v || !v.n) v = { n: 0, first: Date.now(), last: Date.now() };
  var counted = false;
  try { counted = !!sessionStorage.getItem('mrp-visit-counted'); } catch (e) {}
  if (!counted) {
    v.n += 1; v.last = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(v)); sessionStorage.setItem('mrp-visit-counted', '1'); } catch (e) {}
  }
  window.mrpVisits = function () {
    return v.n + (v.n === 1 ? ' visit' : ' visits') + ' · first ' + md(v.first) + ' · latest ' + md(v.last);
  };
  document.addEventListener('submit', function (e) {
    try {
      var f = e.target;
      if (!f || !/formsubmit\.co/.test(f.getAttribute('action') || '')) return;
      var el = f.elements['visits'];
      if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = 'visits'; f.appendChild(el); }
      el.value = window.mrpVisits();
    } catch (err) {}
  }, true);
})();
