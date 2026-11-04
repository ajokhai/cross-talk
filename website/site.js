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
      var scope = btn.closest('[role="tabpanel"], .cta-code');
      var pre = scope && scope.querySelector('pre');
      if (!pre) return;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pre.innerText).then(done, function () {});
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
