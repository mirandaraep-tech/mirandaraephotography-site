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
