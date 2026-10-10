/*
 * Usage globe: where CrossTalk hubs check in from (GET /api/usage).
 *
 * Markup (any page):
 *   <canvas id="usage-globe" aria-label="Globe of CrossTalk usage"></canvas>
 *   <p id="usage-globe-summary"></p>          optional, gets the totals as text
 *   <script src="/globe.js" defer></script>
 *
 * Self-contained canvas renderer (CSP script-src 'self'): orthographic
 * projection, land drawn as dots from /data/land-dots.json, one beacon per
 * country sized by distinct hubs over the last 30 days. Drag to spin. Respects
 * prefers-reduced-motion, follows the site's light/dark tokens, and stops
 * drawing while off screen.
 */
(() => {
  const canvas = document.getElementById('usage-globe');
  if (!canvas || !canvas.getContext) return;
  const summary = document.getElementById('usage-globe-summary');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const RAD = Math.PI / 180;
  const TILT = 18 * RAD;               // look slightly down on the northern hemisphere
  const AUTO_SPIN = 4 * RAD;           // radians per second when idle

  let land = new Float32Array(0);      // [lon, lat, ...] in radians
  let markers = [];                    // { code, name, count, lon, lat, r }
  let rotation = 20 * RAD;             // longitude at the centre of the view
  let tilt = TILT;
  let velocity = 0;
  let dragging = null;
  let hover = null;
  let colors = {};
  let size = { w: 0, h: 0, r: 0, cx: 0, cy: 0, dpr: 1 };
  let visible = true;
  let last = performance.now();
  let frame = 0;

  // --- tooltip (positioned over the canvas) -----------------------------------
  const tip = document.createElement('div');
  tip.setAttribute('role', 'status');
  Object.assign(tip.style, {
    position: 'absolute', pointerEvents: 'none', padding: '6px 10px', borderRadius: '8px',
    font: '500 13px/1.3 var(--sans, system-ui)', whiteSpace: 'nowrap', opacity: '0',
    transition: 'opacity .15s', transform: 'translate(-50%, calc(-100% - 12px))', zIndex: '1'
  });
  const host = canvas.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(tip);

  // --- theme ------------------------------------------------------------------
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    colors = {
      dot: v('--muted', '#6b7280'),
      rim: v('--border-strong', '#d1d5db'),
      glow: v('--green', '#16a34a'),
      text: v('--text', '#111'),
      surface: v('--surface', '#fff'),
      border: v('--border', '#e5e7eb')
    };
    Object.assign(tip.style, { background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` });
  }

  // --- projection ---------------------------------------------------------------
  // Returns [x, y, z]; z > 0 is the visible hemisphere.
  function project(lon, lat) {
    const l = lon + rotation;
    const cosLat = Math.cos(lat);
    const x = cosLat * Math.sin(l);
    const y = Math.sin(lat);
    const z = cosLat * Math.cos(l);
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [size.cx + x * size.r, size.cy - y2 * size.r, z2];
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    size = { w: rect.width, h: rect.height, dpr, cx: rect.width / 2, cy: rect.height / 2, r: Math.min(rect.width, rect.height) / 2 / 1.16 };
    draw(performance.now());
  }

  // --- drawing ------------------------------------------------------------------
  function withAlpha(color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
  }

  function draw(now) {
    const { r, cx, cy, dpr } = size;
    if (r <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // Atmosphere: a ring just outside the disc, plus a faint inner shade at the limb.
    const halo = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 1.14);
    halo.addColorStop(0, colors.glow + '40');
    halo.addColorStop(1, colors.glow + '00');
    ctx.globalAlpha = 1;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill();
    const limb = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);
    limb.addColorStop(0, colors.glow + '00');
    limb.addColorStop(1, colors.glow + '14');
    ctx.fillStyle = limb;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    withAlpha(colors.rim, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Land dots, fading toward the limb.
    const dot = Math.max(1.2, r / 160);
    ctx.fillStyle = colors.dot;
    for (let i = 0; i < land.length; i += 2) {
      const [x, y, z] = project(land[i], land[i + 1]);
      if (z <= 0.02) continue;
      ctx.globalAlpha = 0.15 + 0.55 * z;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }

    // Beacons.
    const pulse = reduceMotion.matches ? 0 : (now / 1600) % 1;
    for (const m of markers) {
      const [x, y, z] = project(m.lon, m.lat);
      m.screen = z > 0.05 ? [x, y] : null;
      if (!m.screen) continue;
      const fade = Math.min(1, z * 2.5);
      if (pulse) {
        withAlpha(colors.glow, (1 - pulse) * 0.5 * fade);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, m.r + pulse * m.r * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      withAlpha(colors.glow, 0.25 * fade);
      ctx.beginPath();
      ctx.arc(x, y, m.r * 2, 0, Math.PI * 2);
      ctx.fill();
      withAlpha(colors.glow, fade);
      ctx.beginPath();
      ctx.arc(x, y, m === hover ? m.r * 1.35 : m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    placeTip();
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dragging) {
      if (Math.abs(velocity) > 0.0005) {
        rotation += velocity * dt;
        velocity *= Math.pow(0.04, dt);  // inertia after a fling
      } else if (!reduceMotion.matches) {
        rotation += AUTO_SPIN * dt;
      }
    }
    draw(now);
    schedule();
  }

  function schedule() {
    const animating = !reduceMotion.matches || dragging || Math.abs(velocity) > 0.0005;
    if (!frame && visible && !document.hidden && animating) frame = requestAnimationFrame(tick);
  }

  // --- interaction ----------------------------------------------------------------
  function placeTip() {
    if (!hover || !hover.screen) {
      tip.style.opacity = '0';
      return;
    }
    tip.textContent = `${hover.name} · ${hover.count} hub${hover.count === 1 ? '' : 's'}`;
    tip.style.left = `${canvas.offsetLeft + hover.screen[0]}px`;
    tip.style.top = `${canvas.offsetTop + hover.screen[1]}px`;
    tip.style.opacity = '1';
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    let best = null, bestDist = 14;
    for (const m of markers) {
      if (!m.screen) continue;
      const d = Math.hypot(m.screen[0] - px, m.screen[1] - py) - m.r;
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  }

  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', e => {
    dragging = { x: e.clientX, y: e.clientY, t: performance.now() };
    velocity = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    schedule();
  });
  canvas.addEventListener('pointermove', e => {
    if (dragging) {
      const now = performance.now();
      const dx = (e.clientX - dragging.x) / size.r;
      const dy = (e.clientY - dragging.y) / size.r;
      rotation += dx;
      tilt = Math.max(-60 * RAD, Math.min(60 * RAD, tilt - dy));
      velocity = dx / Math.max(0.008, (now - dragging.t) / 1000);
      dragging = { x: e.clientX, y: e.clientY, t: now };
      draw(now);
    } else {
      const m = pick(e);
      if (m !== hover) {
        hover = m;
        canvas.style.cursor = m ? 'pointer' : 'grab';
        draw(performance.now());
      }
    }
  });
  const release = () => {
    if (!dragging) return;
    if (performance.now() - dragging.t > 80) velocity = 0;
    dragging = null;
    canvas.style.cursor = 'grab';
    schedule();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (!dragging && hover) { hover = null; draw(performance.now()); }
  });

  // --- data -----------------------------------------------------------------------
  function describe(usage, countries) {
    const entries = Object.entries(usage.countries || {});
    const total = usage.total || 0;
    if (!usage.configured || total === 0) {
      return 'No hubs have checked in yet. Run crosstalk serve to put your country on the map.';
    }
    const top = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, n]) => `${countries[code] ? countries[code][2] : code} (${n})`)
      .join(', ');
    return `${total} hub${total === 1 ? '' : 's'} in ${entries.length} countr${entries.length === 1 ? 'y' : 'ies'} over the last ${usage.windowDays} days. Most active: ${top}.`;
  }

  async function load() {
    const json = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(url))));
    const [dots, countries, usage] = await Promise.all([
      json('/data/land-dots.json'),
      json('/data/countries.json'),
      json('/api/usage').catch(() => ({ configured: false, total: 0, countries: {} }))
    ]);

    land = new Float32Array(dots.points.length);
    for (let i = 0; i < dots.points.length; i++) land[i] = (dots.points[i] / dots.scale) * RAD;

    const counts = Object.entries(usage.countries || {}).filter(([code]) => countries[code]);
    const max = Math.max(1, ...counts.map(([, n]) => n));
    markers = counts.map(([code, count]) => ({
      code, count, name: countries[code][2],
      lon: countries[code][0] * RAD, lat: countries[code][1] * RAD,
      r: 2.5 + 4.5 * Math.sqrt(count / max)
    }));
    // Start with the busiest country facing the viewer.
    const busiest = markers.slice().sort((a, b) => b.count - a.count)[0];
    if (busiest) rotation = -busiest.lon;

    const text = describe(usage, countries);
    if (summary) summary.textContent = text;
    canvas.setAttribute('aria-label', `Globe of CrossTalk usage. ${text}`);
    canvas.setAttribute('role', 'img');
    draw(performance.now());
    schedule();
  }

  // --- lifecycle ------------------------------------------------------------------
  readColors();
  new ResizeObserver(resize).observe(canvas);
  new MutationObserver(() => { readColors(); draw(performance.now()); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(performance.now()); });
  reduceMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => { last = performance.now(); schedule(); });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    last = performance.now();
    schedule();
  }).observe(canvas);

  load().catch(() => {
    if (summary) summary.textContent = 'The usage map could not be loaded.';
  });
})();
