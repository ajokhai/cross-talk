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
