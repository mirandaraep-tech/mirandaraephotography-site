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
      label = src + (med ? ' (' + med + ')' : '');
      if (camp) extra.push('campaign: ' + camp);
    } else if (ref && ref !== me) {
      if (/(^|\.)google\./.test(ref)) label = 'Google search (free)';
      else if (/bing\.com$/.test(ref)) label = 'Bing search (free)';
      else if (/(chatgpt\.com|openai\.com)$/.test(ref)) label = 'ChatGPT';
      else if (/perplexity\.ai$/.test(ref)) label = 'Perplexity';
      else if (/(facebook\.com|fb\.com|fb\.me)$/.test(ref)) label = 'Facebook';
      else if (/instagram\.com$/.test(ref)) label = 'Instagram';
      else label = 'Link from ' + ref;
    }
    if (!label) return null; // direct visit or moving around the site: keep what we already know
    return { label: label, extra: extra.join(', '), landed: location.pathname, t: Date.now() };
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
