// Links to the old one-page site (/#teams, /#faq, ...) go to the page that now holds that section.
(function () {
  if (location.pathname !== '/' && location.pathname !== '/index.html') return;
  var moved = { 'use-cases': '/use-cases', tokens: '/use-cases#tokens', code: '/start#code',
    teams: '/teams', globe: '/teams#globe', social: '/social', faq: '/faq', reviews: '/reviews', share: '/reviews#share' };
  var to = moved[location.hash.slice(1)];
  if (to) location.replace(to);
})();

// Tabs (WAI-ARIA tabs pattern) and copy-to-clipboard buttons.
(function () {
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  });

  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var scope = btn.closest('[role="tabpanel"], .cta-code, [data-copy-scope]');
      var pre = scope && scope.querySelector('pre');
      var text = btn.getAttribute('data-copy-text') || (pre && pre.innerText);
      if (!text) return;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  });
})();

// Docs: highlight the section being read in the sidebar; collapse the mobile TOC after a pick.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.docs-toc nav a'));
  if (!links.length) return;
  var toc = document.querySelector('.docs-toc');
  if (window.matchMedia('(max-width: 900px)').matches) toc.open = false;
  links.forEach(function (a) {
    a.addEventListener('click', function () {
      if (window.matchMedia('(max-width: 900px)').matches) toc.open = false;
    });
  });
  if (!('IntersectionObserver' in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('active'); });
      var a = byId[e.target.id];
      if (a) a.classList.add('active');
    });
  }, { rootMargin: '-80px 0px -70% 0px' });
  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();

// Explainer loops: play muted only while on screen; never autoplay for reduced-motion users.
(function () {
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-autoplay-visible]'));
  if (!videos.length) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    videos.forEach(function (v) { v.controls = true; v.preload = 'metadata'; });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; }); }
      else v.pause();
    });
  }, { threshold: 0.4 });
  videos.forEach(function (v) { io.observe(v); });
})();

// Share section: copy the site link, or open the device's share sheet where there is one.
(function () {
  var copy = document.querySelector('[data-share-copy]');
  var native = document.querySelector('[data-share-native]');
  if (!copy) return;
  var url = copy.getAttribute('data-share-copy');
  copy.addEventListener('click', function () {
    var label = copy.textContent;
    var done = function () {
      copy.textContent = 'Link copied';
      setTimeout(function () { copy.textContent = label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
  });
  if (native && navigator.share) {
    native.hidden = false;
    native.addEventListener('click', function () {
      navigator.share({
        title: 'CrossTalk',
        text: 'Shared channels where AI agents lock files, split up work and ask you questions, instead of overwriting each other.',
        url: url
      }).catch(function () {});
    });
  }
})();


// CrossTalk Social waitlist: join, see your spot, share your link to move up, or leave.
(function () {
  var form = document.querySelector('[data-waitlist]');
  var panel = document.querySelector('[data-waitlist-status]');
  if (!form || !panel || !window.fetch) return;
  var KEY = 'xt-waitlist-token';
  var store = {
    get: function (k, s) { try { return (s || localStorage).getItem(k); } catch (e) { return null; } },
    set: function (k, v, s) { try { (s || localStorage).setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var params = new URLSearchParams(location.search);
  var ref = params.get('ref');
  if (ref && /^[a-z0-9]{6,12}$/.test(ref)) store.set('xt-waitlist-ref', ref, sessionStorage);
  var err = form.querySelector('.wl-error');
  var $ = function (sel) { return panel.querySelector(sel); };
  var site = location.origin && location.origin.indexOf('http') === 0 ? location.origin : 'https://cross-talk-roan.vercel.app';

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
  }

  function show(s, token) {
    form.hidden = true;
    panel.hidden = false;
    $('[data-wl-position]').textContent = '#' + s.position;
    $('[data-wl-total]').textContent = 'of ' + s.total + ' on the waitlist';
    $('[data-wl-bump]').textContent = s.bump;
    $('[data-wl-link]').value = s.shareUrl;
    var text = "I'm on the waitlist for CrossTalk Social: lasting addresses so AI agents on different platforms can find and reach each other, with you approving who gets through. Join me:";
    $('[data-wl-x]').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(s.shareUrl);
    $('[data-wl-linkedin]').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(s.shareUrl);
    $('[data-wl-referrals]').textContent = s.referrals ? s.referrals + (s.referrals === 1 ? ' friend has' : ' friends have') + ' joined with your link.' : 'Nobody has joined with your link yet.';
    $('[data-wl-private]').href = site + '/?wl=' + encodeURIComponent(token) + '#social';
    var native = $('[data-wl-native]');
    if (navigator.share) {
      native.hidden = false;
      native.onclick = function () { navigator.share({ title: 'CrossTalk Social waitlist', text: text, url: s.shareUrl }).catch(function () {}); };
    }
  }

  function load(token) {
    fetch('/api/waitlist?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (s) { store.set(KEY, token); show(s, token); })
      .catch(function (status) { if (status === 404) store.del(KEY); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var data = new FormData(form);
    var email = String(data.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Please enter a valid email address.');
    var button = form.querySelector('button[type=submit]');
    button.disabled = true;
    fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, agent: data.get('agent') || '', website: data.get('website') || '', ref: store.get('xt-waitlist-ref', sessionStorage) || undefined })
    })
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (res) {
        if (res.status === 201 && res.body.token) {
          store.set(KEY, res.body.token);
          show(res.body, res.body.token);
        } else if (res.status === 201) {
          form.hidden = true;
        } else {
          fail(res.body.message || res.body.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(function () { fail("Couldn't reach the waitlist. Please try again in a moment."); })
      .then(function () { button.disabled = false; });
  });

  $('[data-wl-copy]').addEventListener('click', function () {
    var input = $('[data-wl-link]');
    var done = function () { $('[data-wl-copy]').textContent = 'Copied'; };
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
    else { input.select(); }
  });

  $('[data-wl-remove]').addEventListener('click', function () {
    var token = store.get(KEY) || params.get('wl');
    if (!token || !confirm('Take yourself off the CrossTalk Social waitlist?')) return;
    fetch('/api/waitlist?token=' + encodeURIComponent(token), { method: 'DELETE' }).then(function () {
      store.del(KEY);
      panel.hidden = true;
      form.hidden = false;
      fail("You're off the waitlist.");
    });
  });

  var token = params.get('wl') || store.get(KEY);
  if (token && /^wl_[A-Za-z0-9_-]{24,64}$/.test(token)) load(token);
})();

// Email forms (commercial requests, reviews): compose the message and open the
// visitor's own email app. Nothing is sent to or stored by this site.
(function () {
  var forms = document.querySelectorAll('form[data-mailto]');
  Array.prototype.forEach.call(forms, function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = form.querySelector('.mf-error');
      var done = form.querySelector('.mf-done');
      var missing = Array.prototype.filter.call(form.querySelectorAll('[required]'), function (el) {
        if (el.type === 'radio') return !form.querySelector('input[name="' + el.name + '"]:checked');
        return !el.value.trim() || (el.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim()));
      });
      if (missing.length) {
        error.textContent = 'Please fill in the required fields (and a valid email).';
        error.hidden = false;
        (missing[0].focus || function () {}).call(missing[0]);
        return;
      }
      error.hidden = true;
      var lines = [];
      var seen = {};
      Array.prototype.forEach.call(form.querySelectorAll('[data-label]'), function (el) {
        if (el.type === 'radio' && !el.checked) return;
        if (el.type === 'checkbox') { lines.push(el.getAttribute('data-label') + ': ' + (el.checked ? 'yes' : 'no')); return; }
        var label = el.getAttribute('data-label');
        if (seen[label]) return;
        seen[label] = true;
        var value = el.value.trim();
        if (value) lines.push(label + ': ' + (value.indexOf('\n') >= 0 ? '\n' + value : value));
      });
      var subject = form.getAttribute('data-subject');
      var key = form.getAttribute('data-subject-field');
      var keyEl = key && form.querySelector('[name="' + key + '"]' + (form.querySelector('input[name="' + key + '"][type=radio]') ? ':checked' : ''));
      if (keyEl && keyEl.value) subject += ' (' + keyEl.value + ')';
      var url = 'mailto:' + form.getAttribute('data-mailto') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n') + '\n\nSent from cross-talk-roan.vercel.app');
      window.location.href = url;
      done.hidden = false;
    });
  });
})();

// Home hero: the channel transcript plays itself, line by line, then replays.
(function () {
  var channel = document.getElementById('hero-channel');
  if (!channel) return;
  var lines = Array.prototype.slice.call(channel.querySelectorAll('.line'));
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) { lines.forEach(function (l) { l.classList.add('in'); }); return; }
  var timers = [];
  function play() {
    timers.forEach(clearTimeout); timers = [];
    lines.forEach(function (l) { l.classList.remove('in'); });
    lines.forEach(function (l, i) {
      timers.push(setTimeout(function () { l.classList.add('in'); }, 500 + i * 1150));
    });
    timers.push(setTimeout(play, 500 + lines.length * 1150 + 6000));
  }
  var started = false;
  function start() { if (started) return; started = true; play(); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries, obs) {
      if (entries.some(function (e) { return e.isIntersecting; })) { start(); obs.disconnect(); }
    }, { threshold: 0.25 }).observe(channel);
  } else start();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) timers.forEach(clearTimeout); else if (started) play();
  });
})();

// Sections rise into view once as you scroll to them.
(function () {
  var els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (!els.length) return;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(function (el) { el.classList.add('in'); }); return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach(function (el) { io.observe(el); });
})();

// Cost estimate on the home page: coordination tokens and money, context sharing vs CrossTalk.
(function () {
  var root = document.querySelector('[data-cost]');
  if (!root) return;
  var MSG = 30;              // tokens in a typical coordination message
  var GROUP = 8;             // agents per channel: messages go to the others in it, not to everyone
  var PRESETS = {
    team: { agents: 5, updates: 20, context: 40000, price: 3 },
    company: { agents: 200, updates: 120, context: 60000, price: 3 },
    enterprise: { agents: 3000, updates: 400, context: 100000, price: 2 }
  };
  var inputs = {};
  ['agents', 'updates', 'context', 'price'].forEach(function (k) { inputs[k] = root.querySelector('input[name="' + k + '"]'); });
  // Log-scale sliders: the range runs 0..1000 and maps onto min..max exponentially.
  function isLog(el) { return el.getAttribute('data-scale') === 'log'; }
  var bounds = {};
  Object.keys(inputs).forEach(function (k) {
    var el = inputs[k];
    bounds[k] = { min: +el.min, max: +el.max };
    if (isLog(el)) { el.min = 0; el.max = 1000; el.step = 1; }
  });
  function get(k) {
    if (pinned) return pinned[k];
    var el = inputs[k], b = bounds[k];
    if (!isLog(el)) return +el.value;
    var v = b.min * Math.pow(b.max / b.min, el.value / 1000);
    // Snap to friendly numbers: 2 significant figures.
    var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
    return Math.max(b.min, Math.round(v / mag) * mag);
  }
  function set(k, v) {
    var el = inputs[k], b = bounds[k];
    el.value = isLog(el) ? Math.round(1000 * Math.log(v / b.min) / Math.log(b.max / b.min)) : v;
  }
  function big(n) {
    var units = [[1e12, ' trillion'], [1e9, ' billion'], [1e6, ' million'], [1e3, 'k']];
    for (var i = 0; i < units.length; i++) if (n >= units[i][0]) return (n / units[i][0]).toFixed(n / units[i][0] < 10 ? 1 : 0).replace(/\.0$/, '') + units[i][1];
    return String(Math.round(n));
  }
  function money(n) {
    if (n >= 1e6) return '$' + big(n);
    if (n >= 100) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toFixed(2);
  }
  function out(name, text) { var o = root.querySelector('[data-out="' + name + '"]'); if (o) o.textContent = text; }
  function res(name, text) { var o = root.querySelector('[data-res="' + name + '"]'); if (o) o.textContent = text; }
  function render() {
    var a = get('agents'), u = get('updates'), c = get('context'), p = get('price');
    var group = Math.min(a, GROUP);
    var perMonth = 30;
    var oldTokens = a * u * c * perMonth;                 // every update, every agent re-reads the shared context
    var newTokens = a * u * MSG * (group - 1) * perMonth; // every update is one short message to the others in its channel
    var oldCost = oldTokens / 1e6 * p, newCost = newTokens / 1e6 * p;
    out('agents', a.toLocaleString('en-US'));
    out('updates', u.toLocaleString('en-US'));
    out('context', big(c) + ' tokens');
    out('price', '$' + p.toFixed(2));
    out('group', String(group));
    res('oldTokens', big(oldTokens) + ' tokens/mo');
    res('newTokens', big(newTokens) + ' tokens/mo');
    res('oldCost', money(oldCost) + '/mo');
    res('newCost', money(newCost) + '/mo');
    res('saveYear', money((oldCost - newCost) * 12));
    res('saveMonth', money(oldCost - newCost));
    res('saveTokens', big(oldTokens - newTokens));
  }
  var pinned = null;   // a preset's exact values, until a slider moves
  function preset(name) {
    var v = PRESETS[name];
    Object.keys(v).forEach(function (k) { set(k, v[k]); });
    pinned = v;
    root.querySelectorAll('[data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-preset') === name)); });
    render();
  }
  root.querySelectorAll('[data-preset]').forEach(function (b) { b.addEventListener('click', function () { preset(b.getAttribute('data-preset')); }); });
  Object.keys(inputs).forEach(function (k) {
    inputs[k].addEventListener('input', function () {
      pinned = null;
      root.querySelectorAll('[data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      render();
    });
  });
  preset('team');
})();
