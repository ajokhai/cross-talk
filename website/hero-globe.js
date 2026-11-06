/*
 * Hero globe: a large, faint dotted Earth behind the home page hero, turning
 * slowly, with messages arcing between the places CrossTalk hubs run
 * (GET /api/usage), in the agent colours. Decorative only (aria-hidden, no
 * pointer events). Draws one still frame under prefers-reduced-motion and
 * stops while off screen or the tab is hidden.
 *
 * Markup: <canvas class="hero-globe" aria-hidden="true"></canvas> inside .hero
 */
(() => {
  const canvas = document.querySelector('canvas.hero-globe');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const RAD = Math.PI / 180;
  const TILT = 16 * RAD;
  const SPIN = 3.2 * RAD;               // radians per second
  const AGENT = ['--a-claude', '--a-gemini', '--a-you', '--a-codex'];

  let land = new Float32Array(0);
  let places = [];                      // [{ lon, lat }] in radians
  let arcs = [];                        // live message arcs
  let rotation = 70 * RAD;
  let size = { w: 0, h: 0, r: 0, cx: 0, cy: 0, dpr: 1 };
  let colors = { dot: '#7d766c', rim: '#cec6b7', agents: ['#d97757', '#3d7bf5', '#e0b320', '#1fa37a'] };
  let visible = true;
  let frame = 0;
  let last = performance.now();
  let nextArc = 0;

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    colors = {
      dot: v('--text', '#15130f'),
      rim: v('--border-strong', '#cec6b7'),
      agents: AGENT.map((n, i) => v(n, colors.agents[i]))
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const r = Math.min(rect.width, rect.height) * 0.46;
    size = { w: rect.width, h: rect.height, r, cx: rect.width / 2, cy: rect.height / 2, dpr };
    draw(performance.now());
  }

  /** Unit vector for a lon/lat after spin and tilt; z > 0 faces the viewer. */
  function vec(lon, lat) {
    const l = lon + rotation;
    const x = Math.cos(lat) * Math.sin(l);
    const y0 = Math.sin(lat);
    const z0 = Math.cos(lat) * Math.cos(l);
    return [x, y0 * Math.cos(TILT) - z0 * Math.sin(TILT), y0 * Math.sin(TILT) + z0 * Math.cos(TILT)];
  }
  const screen = ([x, y, z], lift = 1) => [size.cx + x * size.r * lift, size.cy - y * size.r * lift, z];

  /** Point t (0..1) along the great circle from a to b, lifted off the surface mid-way. */
  function along(a, b, t) {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const w = Math.acos(dot);
    if (w < 1e-4) return { p: a, lift: 1 };
    const s = Math.sin(w);
    const k1 = Math.sin((1 - t) * w) / s;
    const k2 = Math.sin(t * w) / s;
    const p = [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
    return { p, lift: 1 + 0.32 * Math.sin(Math.PI * t) * Math.min(1, w / 1.2) };
  }

  function spawn(now) {
    if (places.length < 2) return;
    const i = Math.floor(Math.random() * places.length);
    let j = Math.floor(Math.random() * (places.length - 1));
    if (j >= i) j++;
    arcs.push({ from: places[i], to: places[j], born: now, life: 2600 + Math.random() * 1600, color: colors.agents[arcs.length % colors.agents.length] });
    if (arcs.length > 14) arcs.shift();
  }

  function draw(now) {
    const { r, cx, cy, dpr } = size;
    if (r <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // Rim and a soft shade so the sphere reads as round.
    ctx.globalAlpha = 1;
    const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    shade.addColorStop(0, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Graticule: a few meridians and parallels, very faint.
    ctx.strokeStyle = colors.rim;
    ctx.globalAlpha = 0.5;
    for (let lon = 0; lon < 180; lon += 30) {
      ctx.beginPath();
      let pen = false;
      for (let lat = -90; lat <= 90; lat += 4) {
        const [x, y, z] = screen(vec(lon * RAD, lat * RAD));
        if (z < 0) { pen = false; continue; }
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
      for (let lat = 90; lat >= -90; lat -= 4) {
        const [x, y, z] = screen(vec((lon + 180) * RAD, lat * RAD));
        if (z < 0) { pen = false; continue; }
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    }

    // Land as dots, fading toward the limb.
    const dot = Math.max(1.3, r / 210);
    ctx.fillStyle = colors.dot;
    for (let i = 0; i < land.length; i += 2) {
      const [x, y, z] = screen(vec(land[i], land[i + 1]));
      if (z <= 0.04) continue;
      ctx.globalAlpha = 0.06 + 0.3 * z;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }

    // Hubs: small rings.
    for (const p of places) {
      const [x, y, z] = screen(vec(p.lon, p.lat));
      if (z <= 0.05) continue;
      ctx.globalAlpha = 0.9 * z;
      ctx.strokeStyle = colors.agents[1];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Messages: an arc draws itself, a bright head travels it, then the trail fades.
    for (const a of arcs) {
      const age = (now - a.born) / a.life;
      if (age >= 1.35) continue;
      const A = vec(a.from.lon, a.from.lat);
      const B = vec(a.to.lon, a.to.lat);
      const head = Math.min(1, age);
      const tail = Math.max(0, age - 0.35);
      const steps = 48;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = a.color;
      ctx.beginPath();
      let pen = false;
      for (let s = 0; s <= steps; s++) {
        const t = tail + (head - tail) * (s / steps);
        const { p, lift } = along(A, B, t);
        const [x, y, z] = screen(p, lift);
        // Hidden behind the globe when it dips below the limb on the far side.
        if (z < 0 && Math.hypot(x - cx, y - cy) < r) { pen = false; continue; }
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
      ctx.globalAlpha = age > 1 ? Math.max(0, 1 - (age - 1) / 0.35) * 0.9 : 0.9;
      ctx.stroke();
      if (age < 1) {
        const { p, lift } = along(A, B, head);
        const [x, y, z] = screen(p, lift);
        if (!(z < 0 && Math.hypot(x - cx, y - cy) < r)) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = a.color;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    rotation += SPIN * dt;
    if (now >= nextArc) { spawn(now); nextArc = now + 550 + Math.random() * 700; }
    arcs = arcs.filter(a => (now - a.born) / a.life < 1.35);
    draw(now);
    schedule();
  }

  function schedule() {
    if (!frame && visible && !document.hidden && !reduceMotion.matches) frame = requestAnimationFrame(tick);
  }

  async function load() {
    const json = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(url))));
    const [dots, countries, usage] = await Promise.all([
      json('/data/land-dots.json'),
      json('/data/countries.json'),
      json('/api/usage').catch(() => ({ countries: {}, places: [] }))
    ]);
    land = new Float32Array(dots.points.length);
    for (let i = 0; i < dots.points.length; i++) land[i] = (dots.points[i] / dots.scale) * RAD;

    const seen = new Set();
    const add = (lon, lat) => {
      const key = `${Math.round(lon)}:${Math.round(lat)}`;
      if (seen.has(key)) return;
      seen.add(key);
      places.push({ lon: lon * RAD, lat: lat * RAD });
    };
    for (const p of usage.places || []) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) add(p.lon, p.lat);
    for (const code of Object.keys(usage.countries || {})) if (countries[code]) add(countries[code][0], countries[code][1]);
    // Too few real hubs for a lively sky: add a handful of well-spread cities so
    // messages always have somewhere to go. These are decoration, not data.
    if (places.length < 6) for (const [lon, lat] of [[-0.1, 51.5], [139.7, 35.7], [77.2, 28.6], [-46.6, -23.5], [151.2, -33.9], [-122.4, 37.8]]) add(lon, lat);
    if (places.length) rotation = -places[0].lon + 30 * RAD;

    // Seed a few arcs mid-flight so the first frame isn't empty.
    const now = performance.now();
    for (let k = 0; k < 5; k++) { spawn(now - k * 600); }
    draw(now);
    schedule();
  }

  readColors();
  new ResizeObserver(resize).observe(canvas);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(performance.now()); });
  reduceMotion.addEventListener('change', () => { last = performance.now(); schedule(); });
  document.addEventListener('visibilitychange', () => { last = performance.now(); schedule(); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); schedule(); }).observe(canvas);
  load().catch(() => {});
})();
