/*
 * "Many agents, one room": the home page story, told in five acts as you
 * scroll. An original scene built from primitives with three.js (MIT, vendored
 * under /vendor so the site's CSP can stay script-src 'self').
 *
 *   0  Four agents, four machines, nobody talking   (each in its own bubble; a paper pile of context grows)
 *   1  Two of them rewrote the same file            (the file tears)
 *   2  Give them one address                         (bubbles pop, a table rises, they gather)
 *   3  They sort it out                              (a lock, notes in flight, tests pass, a question answered)
 *   4  The result                                    (the paper pile blows away; counters)
 *
 * Reduced motion or no WebGL: the section becomes a plain, stacked story and
 * the canvas shows one still frame (or nothing).
 */
import * as THREE from '/vendor/three.module.min.js';
import { RoomEnvironment } from '/vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from '/vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/jsm/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from '/vendor/jsm/geometries/RoundedBoxGeometry.js';
import { createScore } from '/story-sound.js';

const section = document.querySelector('.story');
const canvas = section && section.querySelector('.story-canvas');
if (section && canvas) start();

function start() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no webgl');
  } catch {
    section.classList.add('story-static', 'story-nogl');
    return;
  }
  if (reduce) section.classList.add('story-static');

  const track = section.querySelector('.story-track');
  const acts = [...section.querySelectorAll('.story-act')];
  const ticks = [...section.querySelectorAll('.story-ticks i')];
  const labelLayer = section.querySelector('.story-labels');
  const tokenOut = section.querySelector('[data-tokens]');

  // Sound: off until the visitor asks; remembered on this device.
  const score = createScore();
  const soundBtn = section.querySelector('.story-sound');
  const setSoundUi = on => { if (soundBtn) { soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.querySelector('span').textContent = on ? 'Sound on' : 'Sound off'; } };
  if (soundBtn) {
    soundBtn.hidden = false;
    soundBtn.addEventListener('click', async () => {
      const on = await score.toggle();
      setSoundUi(on);
      try { localStorage.setItem('ct-story-sound', on ? '1' : '0'); } catch {}
    });
    // Remembered "on": start with the visitor's first interaction (browsers need a gesture).
    let wanted = false;
    try { wanted = localStorage.getItem('ct-story-sound') === '1'; } catch {}
    if (wanted) {
      const startOnce = async () => { setSoundUi(await score.toggle(true)); window.removeEventListener('pointerdown', startOnce); window.removeEventListener('keydown', startOnce); };
      window.addEventListener('pointerdown', startOnce);
      window.addEventListener('keydown', startOnce);
    }
  }

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);
  const span = (p, a, b) => ease(clamp((p - a) / (b - a)));
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- renderer, light, air
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#14110d');
  scene.fog = new THREE.Fog(FOG, 16, 36);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  // Backdrop: a warm glow behind the stage fading to near-black at the edges.
  {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#2a2219') }, bottom: { value: new THREE.Color('#0b0a08') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*0.5+0.55,0.0,1.0); float c = smoothstep(1.0,0.2,length(vP.xz-vec2(0.0,-0.4))); gl_FragColor = vec4(mix(bottom, top, h*c), 1.0); }'
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), mat));
  }

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  scene.add(new THREE.HemisphereLight('#ffeedd', '#1a140e', 0.6));
  const key = new THREE.DirectionalLight('#ffe6c4', 2.1);
  key.position.set(5, 11, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rimL = new THREE.DirectionalLight('#7fa6ff', 1.6);
  rimL.position.set(-8, 5, -8);
  scene.add(rimL);
  const warm = new THREE.PointLight('#ffb35c', 0, 9, 1.6);   // the table's glow, once it exists
  warm.position.set(0, 1.4, 0);
  scene.add(warm);

  // Floor that catches shadows, plus a fine dot grid.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: '#15120e', roughness: 0.92, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.62;
  floor.receiveShadow = true;
  scene.add(floor);
  {
    const pts = [];
    for (let x = -16; x <= 16; x += 0.5) for (let z = -16; z <= 9; z += 0.5) if (Math.hypot(x, z + 2) < 16) pts.push(x, -0.61, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#4d4438', size: 0.03, transparent: true, opacity: 0.8 })));
  }

  // Dust drifting through the light.
  const DUST = 260;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dustPos.set([rand(-12, 12), rand(-0.5, 7), rand(-12, 6)], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#ffd9a3', size: 0.035, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  // ---------------------------------------------------------------- agents
  // Five agents, each its own little character (original designs, one per harness).
  const AGENTS = [
    { id: 'claude', kind: 'pixel', color: '#e07a55', name: 'claude-code', via: "Claude Code · Ada's laptop", far: v3(-5.4, 1.5, -1.6), seat: 200 },
    { id: 'gemini', kind: 'tall', color: '#2fb3c6', name: 'gemini', via: "Antigravity · Ben's Mac", far: v3(-1.4, 2.9, -5.8), seat: 258 },
    { id: 'codex', kind: 'mochi', color: '#4a83ff', name: 'codex', via: 'Codex · CI runner', far: v3(2.9, 1.0, -3.9), seat: 316 },
    { id: 'grok', kind: 'orb', color: '#17151a', glow: '#d9e6ff', name: 'grok', via: "Grok · Ben's server", far: v3(-3.2, 0.4, -4.4), seat: 14 },
    { id: 'partner', kind: 'critter', color: '#8a6bff', name: 'kimi', via: 'Kimi · Priya at Northwind', far: v3(4.4, 2.3, -1.4), seat: 72 }
  ];
  const SEAT_R = 3.2;
  for (const a of AGENTS) {
    const t = (a.seat * Math.PI) / 180;
    a.seatPos = v3(Math.cos(t) * SEAT_R, 0.0, Math.sin(t) * SEAT_R * 0.9);
  }

  const shell = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14, ...extra });
  const ink = new THREE.MeshPhysicalMaterial({ color: '#0d0b09', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
  const shine = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dd').multiplyScalar(2), toneMapped: false });
  const blushMat = new THREE.MeshBasicMaterial({ color: '#ff9db0', transparent: true, opacity: 0.5, depthWrite: false });
  const rbox = (w, h, d, r, m) => { const x = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); x.castShadow = true; return x; };
  const ball = (r, m, seg = 40) => { const x = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.66)), m); x.castShadow = true; return x; };
  const arm = (rig, m, side, at, geo) => {
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    const limb = geo(m);
    limb.position.set(side * 0.04, -0.12, 0);
    pivot.add(limb);
    pivot.rotation.z = side * 0.35;
    rig.add(pivot);
    return pivot;
  };
  const glowTip = (rig, color, y) => {
    const tip = ball(0.06, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false }), 16);
    tip.castShadow = false;
    tip.position.set(0, y, 0);
    rig.add(tip);
    return tip;
  };

  // Claude Code: a pixel buddy, voxels like a terminal sprite made solid.
  function buildPixel(a, rig) {
    const m = shell(a.color, { roughness: 0.42, clearcoat: 0.6 });
    const rows = ['.XXXXX.', 'XXXXXXX', 'XX.X.XX', 'XXXXXXX', 'XXXXXXX', '.X.X.X.'];
    const v = 0.16;
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== 'X') return;
      const c = rbox(v * 0.96, v * 0.96, v * 2.4, 0.025, m);
      c.position.set((x - 3) * v, (rows.length - y) * v - 0.02, 0);
      rig.add(c);
    }));
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = rbox(v * 0.9, v * 0.9, v * 1.8, 0.02, ink);
      e.position.set(sx * v, 4 * v - 0.02, 0.06);
      eyes.add(e);
      const s = rbox(0.045, 0.045, 0.02, 0.01, shine);
      s.position.set(sx * v + 0.03, 4 * v + 0.03, v * 1.0);
      eyes.add(s);
    }
    eyes.position.y = 0;
    rig.add(eyes);
    const vox = mm => rbox(v * 0.9, v * 0.9, v * 0.9, 0.02, mm);
    const arms = [-1, 1].map(s => arm(rig, m, s, v3(s * 0.62, 0.62, 0), vox));
    return { eyes, arms, tip: new THREE.Object3D() };
  }

  // Gemini: a tall rounded block with an antenna.
  function buildTall(a, rig) {
    const m = shell(a.color);
    const body = rbox(0.78, 1.05, 0.72, 0.2, m);
    body.position.y = 0.68;
    rig.add(body);
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = rbox(0.12, 0.2, 0.05, 0.05, ink);
      e.position.set(sx * 0.17, 0.86, 0.37);
      eyes.add(e);
      const s = rbox(0.04, 0.06, 0.02, 0.015, shine);
      s.position.set(sx * 0.17 + 0.025, 0.91, 0.4);
      eyes.add(s);
    }
    rig.add(eyes);
    for (const sx of [-1, 1]) { const l = rbox(0.17, 0.3, 0.2, 0.07, m); l.position.set(sx * 0.2, 0.12, 0); rig.add(l); }
    const stalk = rbox(0.05, 0.24, 0.05, 0.02, m);
    stalk.position.y = 1.32;
    rig.add(stalk);
    const tip = glowTip(rig, a.color, 1.48);
    const arms = [-1, 1].map(s => arm(rig, m, s, v3(s * 0.45, 0.72, 0), mm => rbox(0.14, 0.28, 0.14, 0.06, mm)));
    return { eyes, arms, tip };
  }

  // Codex: a perfectly round blue buddy with big glossy eyes and blush.
  function buildMochi(a, rig) {
    const m = shell(a.color);
    const body = ball(0.58, m, 64);
    body.position.y = 0.64;
    rig.add(body);
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = ball(0.11, ink, 32);
      e.scale.set(1, 1.2, 0.6);
      e.position.set(sx * 0.2, 0.74, 0.5);
      eyes.add(e);
      const s = ball(0.035, shine, 16);
      s.position.set(sx * 0.2 + 0.035, 0.79, 0.57);
      eyes.add(s);
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), blushMat);
      b.position.set(sx * 0.36, 0.6, 0.47);
      b.rotation.y = sx * 0.6;
      rig.add(b);
      const f = ball(0.13, m, 24);
      f.scale.set(1, 0.55, 1.2);
      f.position.set(sx * 0.27, 0.07, 0.12);
      rig.add(f);
    }
    rig.add(eyes);
    const arms = [-1, 1].map(s => arm(rig, m, s, v3(s * 0.55, 0.62, 0), mm => { const x = ball(0.1, mm, 20); x.scale.set(1, 1.3, 1); return x; }));
    return { eyes, arms, tip: glowTip(rig, a.color, 1.32) };
  }

  // Grok: a glossy black orb with bright eyes.
  function buildOrb(a, rig) {
    const m = new THREE.MeshPhysicalMaterial({ color: a.color, roughness: 0.12, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
    const body = ball(0.56, m, 64);
    body.position.y = 0.66;
    rig.add(body);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(a.glow).multiplyScalar(2.4), toneMapped: false });
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = ball(0.075, eyeMat, 24);
      e.scale.set(1, 1.35, 0.5);
      e.position.set(sx * 0.18, 0.74, 0.52);
      eyes.add(e);
    }
    rig.add(eyes);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.012, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(a.glow).multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.7 }));
    ring.rotation.x = Math.PI / 2 - 0.25;
    ring.position.y = 0.66;
    rig.add(ring);
    for (const sx of [-1, 1]) { const f = ball(0.12, m, 24); f.scale.set(1, 0.5, 1.25); f.position.set(sx * 0.24, 0.07, 0.1); rig.add(f); }
    const arms = [-1, 1].map(s => arm(rig, m, s, v3(s * 0.54, 0.62, 0), mm => { const x = ball(0.09, mm, 20); x.scale.set(1, 1.3, 1); return x; }));
    return { eyes, arms, tip: ring };
  }

  // Kimi: a long, four-legged purple critter.
  function buildCritter(a, rig) {
    const m = shell(a.color);
    const body = rbox(1.25, 0.66, 0.82, 0.18, m);
    body.position.y = 0.62;
    rig.add(body);
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const e = rbox(0.12, 0.19, 0.05, 0.05, ink);
      e.position.set(sx * 0.19, 0.7, 0.42);
      eyes.add(e);
      const s = rbox(0.04, 0.06, 0.02, 0.015, shine);
      s.position.set(sx * 0.19 + 0.025, 0.75, 0.45);
      eyes.add(s);
    }
    rig.add(eyes);
    for (let i = 0; i < 4; i++) {
      const l = rbox(0.16, 0.32, 0.18, 0.06, m);
      l.position.set((i % 2 ? 1 : -1) * 0.42, 0.15, (i < 2 ? -1 : 1) * 0.2);
      rig.add(l);
    }
    const arms = [-1, 1].map(s => arm(rig, m, s, v3(s * 0.7, 0.62, 0.1), mm => rbox(0.14, 0.14, 0.14, 0.05, mm)));
    return { eyes, arms, tip: new THREE.Object3D() };
  }

  const BUILD = { pixel: buildPixel, tall: buildTall, mochi: buildMochi, orb: buildOrb, critter: buildCritter };
  function makeAgent(a) {
    const g = new THREE.Group();
    const rig = new THREE.Group();            // bobs and squashes; g carries position and heading
    g.add(rig);
    const parts = BUILD[a.kind](a, rig);
    // Bubble: the agent's own sealed-off machine. Iridescent glass.
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 64, 40),
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.15, ior: 1.15,
        iridescence: 0.45, iridescenceIOR: 1.25, iridescenceThicknessRange: [260, 420],
        transparent: true, opacity: 1, envMapIntensity: 0.06, specularIntensity: 0.9
      })
    );
    bubble.position.y = 0.75;
    g.add(bubble);
    g.scale.setScalar(0.85);
    scene.add(g);
    return { ...a, group: g, rig, ...parts, bubble, blinkAt: rand(1, 4) };
  }
  const agents = AGENTS.map(makeAgent);
  const byId = Object.fromEntries(agents.map(a => [a.id, a]));

  // ---------------------------------------------------------------- the file
  const fileTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 640;
    const x = c.getContext('2d');
    x.fillStyle = '#fbf5ea';
    x.fillRect(0, 0, 512, 640);
    x.fillStyle = '#15130f';
    x.font = '600 40px "JetBrains Mono", ui-monospace, monospace';
    x.fillText('api/auth.ts', 40, 78);
    x.fillStyle = '#cfc6b6';
    x.fillRect(40, 100, 432, 3);
    const lines = [0.82, 0.55, 0.7, 0.42, 0.66, 0.5, 0.78, 0.36, 0.6, 0.48, 0.72];
    lines.forEach((w, i) => {
      x.fillStyle = i % 4 === 0 ? '#e07a55' : i % 4 === 2 ? '#4a83ff' : '#cfc6b6';
      x.fillRect(40 + (i % 3 === 1 ? 32 : 0), 140 + i * 42, 400 * w, 14);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const halves = [0, 1].map(i => {
    const tex = fileTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(0.5, 1);
    tex.offset.set(i * 0.5, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.0, 0.012), [
      new THREE.MeshStandardMaterial({ color: '#cfc4b1', envMapIntensity: 0.25 }), new THREE.MeshStandardMaterial({ color: '#cfc4b1', envMapIntensity: 0.25 }),
      new THREE.MeshStandardMaterial({ color: '#cfc4b1', envMapIntensity: 0.25 }), new THREE.MeshStandardMaterial({ color: '#cfc4b1', envMapIntensity: 0.25 }),
      new THREE.MeshStandardMaterial({ map: tex, color: '#cfc6b6', roughness: 0.9, envMapIntensity: 0.25, emissive: new THREE.Color('#ff4a32'), emissiveIntensity: 0 }),
      new THREE.MeshStandardMaterial({ color: '#cfc4b1', roughness: 0.95, envMapIntensity: 0.25 })
    ]);
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.022, 16, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0 }));
  scene.add(halo);
  const SHARDS = 48;
  const shardGeo = new THREE.BufferGeometry();
  const shardPos = new Float32Array(SHARDS * 3);
  const shardVel = Array.from({ length: SHARDS }, () => v3(rand(-1.4, 1.4), rand(0.4, 2.4), rand(-1, 1)));
  shardGeo.setAttribute('position', new THREE.BufferAttribute(shardPos, 3));
  const shards = new THREE.Points(shardGeo, new THREE.PointsMaterial({ color: new THREE.Color('#ff6a50').multiplyScalar(2), size: 0.06, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  scene.add(shards);

  // ---------------------------------------------------------------- the table (the channel)
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.38, 0.14, 128), new THREE.MeshPhysicalMaterial({ color: '#1b1712', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.2 }));
  top.receiveShadow = true;
  top.castShadow = true;
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(2.34, 0.02, 12, 192), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc14d').multiplyScalar(1.55), toneMapped: false, transparent: true }));
  rimRing.rotation.x = Math.PI / 2;
  rimRing.position.y = 0.075;
  const rings = new THREE.Group();
  for (const r of [0.7, 1.2, 1.7]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.008, 128), new THREE.MeshBasicMaterial({ color: '#ffc14d', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.072;
    rings.add(ring);
  }
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.55, 0.52, 48), new THREE.MeshPhysicalMaterial({ color: '#100e0b', roughness: 0.35, clearcoat: 0.6 }));
  leg.position.y = -0.33;
  leg.castShadow = true;
  table.add(top, rimRing, rings, leg);
  scene.add(table);

  // ---------------------------------------------------------------- the paper pile (pasted context)
  const SHEETS = 46;
  const sheetGeo = new THREE.BoxGeometry(0.9, 0.012, 0.66);
  const sheetMats = [new THREE.MeshStandardMaterial({ color: '#cfc4b1', roughness: 0.95, envMapIntensity: 0.25 }), new THREE.MeshStandardMaterial({ color: '#c2b6a2', roughness: 0.95, envMapIntensity: 0.25 })];
  const pile = new THREE.Group();
  pile.position.set(1.8, -0.6, -6.8);
  const sheets = [];
  for (let i = 0; i < SHEETS; i++) {
    const m = new THREE.Mesh(sheetGeo, sheetMats[i % 2]);
    m.castShadow = true;
    m.receiveShadow = true;
    const base = { x: rand(-0.04, 0.04), y: 0.01 + i * 0.034, z: rand(-0.06, 0.06), ry: rand(-0.25, 0.25) };
    const fly = { x: rand(-5, 3), y: rand(1.5, 5.5), z: rand(-2, 5), rx: rand(-6, 6), rz: rand(-6, 6) };
    pile.add(m);
    sheets.push({ m, base, fly });
  }
  scene.add(pile);

  // ---------------------------------------------------------------- notes in flight (paper planes)
  const planeGeo = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.16, -0.1, 0, -0.1, 0, 0.025, -0.06, 0, 0, 0.16, 0, 0.025, -0.06, 0.1, 0, -0.1], 3));
    g.computeVertexNormals();
    return g;
  })();
  const notes = Array.from({ length: 12 }, () => {
    const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0, toneMapped: false }));
    m.scale.setScalar(1.6);
    scene.add(m);
    return { mesh: m, from: null, to: null, born: -10, life: 1.4 };
  });
  let nextNote = 0;

  // Confetti for passing tests.
  const CONF = 140;
  const confGeo = new THREE.BufferGeometry();
  const confPos = new Float32Array(CONF * 3);
  const confCol = new Float32Array(CONF * 3);
  const confVel = Array.from({ length: CONF }, () => v3(rand(-1.6, 1.6), rand(2.2, 4.6), rand(-1.6, 1.6)));
  const palette = ['#22b383', '#ffc14d', '#e07a55', '#4a83ff', '#fff4e6'].map(c => new THREE.Color(c).multiplyScalar(1.6));
  for (let i = 0; i < CONF; i++) { const c = palette[i % palette.length]; confCol.set([c.r, c.g, c.b], i * 3); }
  confGeo.setAttribute('position', new THREE.BufferAttribute(confPos, 3));
  confGeo.setAttribute('color', new THREE.BufferAttribute(confCol, 3));
  const confetti = new THREE.Points(confGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  scene.add(confetti);

  // ---------------------------------------------------------------- post-processing: a soft bloom on what glows
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------------------- HTML labels over the scene
  const label = (cls, html) => {
    const el = document.createElement('div');
    el.className = 'story-label ' + cls;
    el.innerHTML = html;
    labelLayer.appendChild(el);
    return el;
  };
  for (const a of agents) {
    a.label = label('agent', `<b>${a.name}</b><span>${a.via}</span>`);
    // Set through the CSSOM: the CSP (style-src without 'unsafe-inline') blocks style="" attributes in markup.
    a.label.querySelector('b').style.setProperty('--c', a.color);
  }
  const fileLabel = label('file', '');
  const tableLabel = label('table', '<b># launch-api</b><span>one address · any harness · any owner</span>');
  const pileLabel = label('tower', '<span data-tower></span>');
  const pileText = pileLabel.querySelector('[data-tower]');
  const waitLabel = label('chip wait', 'gemini: waiting its turn for <code>api/auth.ts</code>');
  const askLabel = label('chip ask', '<i></i>gemini → Ben: publish SDK 2.0?');
  const answerLabel = label('chip answer', '<i></i>Ben: yes, ship it.');
  const keyLabel = label('chip key', '🗝 invite key: this room only');
  const testLabel = label('chip ok', '✓ codex: 128 tests passed');

  const tmp = new THREE.Vector3();
  function place(el, pos, alpha, dy = 0) {
    tmp.copy(pos).project(camera);
    const on = tmp.z < 1 && alpha > 0.01;
    el.style.opacity = on ? alpha.toFixed(3) : 0;
    if (!on) return;
    const x = (tmp.x * 0.5 + 0.5) * view.w;
    const y = (-tmp.y * 0.5 + 0.5) * view.h + dy;
    const half = el.offsetWidth / 2 + 12;
    const edge = Math.min(1, (x - half) / 40, (view.w - half - x) / 40, (y - el.offsetHeight - 70) / 30);
    el.style.opacity = (alpha * clamp(edge)).toFixed(3);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  // ---------------------------------------------------------------- camera path
  const SHOTS = [
    { p: 0.0, pos: v3(0.8, 3.4, 15.5), look: v3(0.4, 1.5, -1.8) },
    { p: 0.22, pos: v3(-1.0, 2.8, 11.2), look: v3(-0.6, 1.4, -1.4) },
    { p: 0.36, pos: v3(-1.4, 2.3, 8.0), look: v3(-0.4, 1.2, -0.7) },
    { p: 0.56, pos: v3(0.0, 7.4, 10.6), look: v3(0.0, 0.3, 0.0) },
    { p: 0.76, pos: v3(3.0, 4.2, 8.8), look: v3(0.2, 0.7, 0.0) },
    { p: 1.0, pos: v3(4.6, 6.2, 15.5), look: v3(-0.4, 0.8, -1.8) }
  ];
  const look = new THREE.Vector3();
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => { pointer.x = e.clientX / window.innerWidth - 0.5; pointer.y = e.clientY / window.innerHeight - 0.5; }, { passive: true });
  function shot(p, mobile) {
    let i = 0;
    while (i < SHOTS.length - 2 && p > SHOTS[i + 1].p) i++;
    const a = SHOTS[i];
    const b = SHOTS[i + 1];
    const t = ease(clamp((p - a.p) / (b.p - a.p)));
    camera.position.lerpVectors(a.pos, b.pos, t);
    look.lerpVectors(a.look, b.look, t);
    if (mobile) camera.position.add(v3(0, 1.6, 5));
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    camera.position.x += pointer.sx * 0.9;
    camera.position.y -= pointer.sy * 0.5;
    camera.lookAt(look);
  }

  // ---------------------------------------------------------------- layout
  const view = { w: 1, h: 1, mobile: false };
  function resize() {
    const r = canvas.getBoundingClientRect();
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
    view.mobile = view.w < 760;
    renderer.setSize(view.w, view.h, false);
    composer.setSize(view.w, view.h);
    bloom.resolution.set(view.w, view.h);
    camera.aspect = view.w / view.h;
    camera.fov = view.mobile ? 46 : 35;
    if (view.mobile) camera.setViewOffset(view.w, view.h, 0, view.h * 0.16, view.w, view.h);
    else camera.setViewOffset(view.w, view.h, -view.w * 0.13, 0, view.w, view.h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------------------------------------------------------------- the story at progress p
  let shown = reduce ? 0.64 : 0;
  let crackedAt = null;
  let confettiAt = null;
  const center = v3(0, 0, 0);
  const meet = v3(0, 1.2, -0.7);

  function update(p, time, dt) {
    shot(p, view.mobile);

    // The copy.
    const bounds = [0, 0.2, 0.38, 0.58, 0.78, 1.01];
    const stacked = section.classList.contains('story-static');
    // The copy follows the act you're on (it fades in CSS), not every frame of the scene.
    const current = typeof act === 'number' && act >= 0 ? act : bounds.findIndex((b, i) => p >= b && p < bounds[i + 1]);
    acts.forEach((el, i) => {
      el.classList.toggle('on', stacked || i === current);
    });
    ticks.forEach((t, i) => t.classList.toggle('on', i <= current));
    section.classList.toggle('story-last', current === acts.length - 1);

    const gather = span(p, 0.4, 0.55);
    const clash = span(p, 0.2, 0.3) * (1 - span(p, 0.38, 0.44));
    const cracked = p > 0.29 && p < 0.47;
    const tableUp = span(p, 0.38, 0.5);
    const locked = span(p, 0.6, 0.64) * (1 - span(p, 0.93, 1));
    const talk = p > 0.6;
    const results = span(p, 0.8, 0.92);
    const pop = span(p, 0.38, 0.45);

    // Agents.
    for (const a of agents) {
      const far = a.far.clone();
      if (a.id === 'claude' || a.id === 'gemini') far.lerp(v3(a.id === 'claude' ? -1.0 : 0.7, 1.0, -0.7), clash * 0.75);
      const pos = far.lerp(a.seatPos, a.id === 'partner' ? span(p, 0.48, 0.56) : gather);
      const hover = (1 - gather) * 0.35;
      const bob = Math.sin(time * 1.7 + a.seat) * (0.06 + hover * 0.15);
      a.group.position.set(pos.x, pos.y + hover + bob, pos.z);
      // Squash and stretch on the bob.
      const sq = 1 + Math.sin(time * 3.4 + a.seat) * 0.025;
      a.rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      // Heading: the camera at first, the file when they clash, the table once gathered.
      const target = gather > 0.1 ? center : clash > 0.05 ? meet : camera.position;
      const want = Math.atan2(target.x - pos.x, target.z - pos.z);
      let d = want - a.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.group.rotation.y += d * Math.min(1, dt * 5 + (dt === 0 ? 1 : 0));
      // Bubble pops: swell, then gone.
      a.bubble.scale.setScalar(1 + pop * 0.35);
      a.bubble.material.opacity = 1 - pop;
      a.bubble.visible = pop < 0.98;
      // Blink.
      a.blinkAt -= dt;
      a.eyes.scale.y = a.blinkAt < 0 ? 0.12 : 1;
      if (a.blinkAt < -0.12) a.blinkAt = rand(2, 5);
      // Arms: idle sway; reach in the clash; wave when the result lands.
      const reach = (a.id === 'claude' || a.id === 'gemini') ? clash : 0;
      const cheer = span(p, 0.84, 0.9);
      a.arms.forEach((arm, k) => {
        const s = k === 0 ? -1 : 1;
        arm.rotation.z = s * (0.35 + Math.sin(time * 1.3 + a.seat + k) * 0.06) - s * reach * 0.9 + s * cheer * (2.3 + Math.sin(time * 9 + k) * 0.35);
        arm.rotation.x = -reach * 0.9;
      });
      a.tip.scale.setScalar(1 + Math.sin(time * 4 + a.seat) * 0.18);
      place(a.label, a.group.position.clone().add(v3(0, 1.75, 0)), (1 - span(p, 0.84, 0.9)) * (p < 0.04 ? span(p, -0.04, 0.03) : 1));
    }

    // The file: whole, torn in two, whole again on the table.
    const fileAt = v3(0, lerp(1.35, 0.7, tableUp), lerp(-0.6, 0, tableUp));
    const tear = cracked ? span(p, 0.29, 0.33) * (1 - span(p, 0.44, 0.47)) : 0;
    halves.forEach((h, i) => {
      const s = i === 0 ? -1 : 1;
      h.position.set(fileAt.x + s * (0.21 + tear * 0.5), fileAt.y + Math.sin(time * 1.8) * 0.04 + tear * 0.1, fileAt.z);
      h.rotation.set(lerp(-0.12, -1.25, tableUp), s * tear * 0.6 + (1 - tableUp) * Math.sin(time * 0.7) * 0.15, s * tear * 0.4);
      h.material[4].emissiveIntensity = tear * 0.9;
    });
    if (cracked && crackedAt === null) { crackedAt = time; score.tear(); }
    if (!cracked) crackedAt = null;
    const shardAge = crackedAt === null ? 9 : time - crackedAt;
    for (let i = 0; i < SHARDS; i++) {
      const v = shardVel[i];
      shardPos.set([fileAt.x + v.x * shardAge, fileAt.y + v.y * shardAge - 2.6 * shardAge * shardAge, fileAt.z + v.z * shardAge], i * 3);
    }
    shardGeo.attributes.position.needsUpdate = true;
    shards.material.opacity = clamp(1 - shardAge / 1.2);
    place(fileLabel, fileAt.clone().add(v3(0, 0.75, 0)), (clash > 0.2 || cracked) && p < 0.4 ? 1 : 0);
    fileLabel.innerHTML = cracked ? '<b class="bad">api/auth.ts</b><span>both rewrote it</span>' : '<b>api/auth.ts</b><span>both reaching for it</span>';

    // The table: the channel, rising out of the floor.
    table.position.y = lerp(-1.8, -0.1, tableUp);
    table.scale.setScalar(lerp(0.5, 1, tableUp));
    table.visible = tableUp > 0.01;
    rimRing.material.opacity = tableUp * (0.75 + 0.25 * Math.sin(time * 2.2));
    rings.children.forEach((r, i) => { r.material.opacity = tableUp * (0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time * 1.6 - i * 0.9))); });
    warm.intensity = tableUp * 2.2;
    place(tableLabel, v3(0, 0.1, 2.45), span(p, 0.46, 0.52) * (1 - span(p, 0.755, 0.785)), 58);

    // The lock: a ring of light around the file. Amber while claude-code holds it, blue once gemini has it.
    halo.position.copy(fileAt);
    halo.rotation.set(Math.PI / 2 - 0.1, 0, time * 0.6);
    const handed = p > 0.71;
    halo.material.color.set(handed ? '#4a83ff' : '#ffb347').multiplyScalar(2);
    halo.material.opacity = locked * (0.75 + 0.25 * Math.sin(time * 4));
    halo.scale.setScalar(1 + locked * 0.04 * Math.sin(time * 4));
    place(waitLabel, byId.gemini.group.position.clone().add(v3(0, 2.25, 0)), span(p, 0.62, 0.65) * (1 - span(p, 0.69, 0.71)));
    place(keyLabel, byId.partner.group.position.clone().add(v3(0, 2.25, 0)), span(p, 0.5, 0.54) * (1 - span(p, 0.6, 0.62)));

    // Notes: paper planes between agents while they work.
    if (talk && !reduce && time > nextNote) {
      const n = notes.find(x => time - x.born > x.life);
      if (n) {
        const from = agents[Math.floor(Math.random() * agents.length)];
        let to = agents[Math.floor(Math.random() * agents.length)];
        if (to === from) to = agents[(agents.indexOf(from) + 1) % agents.length];
        Object.assign(n, { from, to, born: time, life: rand(1.1, 1.7) });
        score.pluck(0.8);
        n.mesh.material.color.set(from.color).multiplyScalar(1.8);
      }
      nextNote = time + rand(0.2, 0.45);
    }
    for (const n of notes) {
      const t = (time - n.born) / n.life;
      if (!talk || t < 0 || t > 1 || !n.from) { n.mesh.material.opacity = 0; continue; }
      const a = n.from.group.position.clone().add(v3(0, 1.0, 0));
      const b = n.to.group.position.clone().add(v3(0, 1.0, 0));
      const mid = a.clone().lerp(b, 0.5).add(v3(0, 1.6, 0));
      const bez = u => a.clone().multiplyScalar((1 - u) ** 2).add(mid.clone().multiplyScalar(2 * (1 - u) * u)).add(b.clone().multiplyScalar(u * u));
      n.mesh.position.copy(bez(t));
      n.mesh.lookAt(bez(Math.min(1, t + 0.03)));
      n.mesh.material.opacity = Math.sin(Math.PI * t) * (1 - results * 0.8);
    }

    // Tests pass: confetti over codex.
    const pass = p > 0.66 && p < 0.8;
    if (pass && confettiAt === null) { confettiAt = time; score.chime(); }
    if (!pass) confettiAt = null;
    const cAge = confettiAt === null ? 9 : time - confettiAt;
    const origin = byId.codex.group.position.clone().add(v3(0, 1.4, 0));
    for (let i = 0; i < CONF; i++) {
      const v = confVel[i];
      confPos.set([origin.x + v.x * cAge * 0.6, origin.y + v.y * cAge * 0.6 - 2.4 * cAge * cAge, origin.z + v.z * cAge * 0.6], i * 3);
    }
    confGeo.attributes.position.needsUpdate = true;
    confetti.material.opacity = reduce ? 0 : clamp(1.2 - cAge / 1.6);
    place(testLabel, origin.clone().add(v3(0, 0.95, 0)), span(p, 0.66, 0.68) * (1 - span(p, 0.73, 0.75)));
    place(askLabel, byId.gemini.group.position.clone().add(v3(0, 2.25, 0)), span(p, 0.72, 0.74) * (1 - span(p, 0.76, 0.77)));
    place(answerLabel, byId.gemini.group.position.clone().add(v3(0, 2.25, 0)), span(p, 0.765, 0.775) * (1 - span(p, 0.82, 0.84)));

    // The paper pile: grows while they paste context at each other, then blows away.
    const grow = span(p, 0.0, 0.32);
    const blow = results;
    const count = Math.round(SHEETS * grow);
    sheets.forEach((s, i) => {
      const here = i < count;
      const goes = i > 1;                         // two sheets stay: what's left after CrossTalk
      const f = goes ? clamp((blow - (i / SHEETS) * 0.35) / 0.65) : 0;
      const fe = ease(f);
      s.m.visible = here && f < 0.999;
      const sway = Math.sin(time * 0.9 + i * 0.08) * 0.0012 * i * (1 - fe);
      s.m.position.set(lerp(s.base.x + sway, s.fly.x, fe), lerp(s.base.y, s.fly.y, fe) + Math.sin(time * 3 + i) * 0.2 * fe, lerp(s.base.z, s.fly.z, fe));
      s.m.rotation.set(s.fly.rx * fe, s.base.ry + time * 2 * fe, s.fly.rz * fe);
      s.m.material = sheetMats[i % 2];
    });
    sheetMats.forEach(m => { m.transparent = blow > 0; m.opacity = 1 - blow * 0.6; });
    const pileTop = v3(pile.position.x, pile.position.y + Math.max(2, count) * 0.034 * (1 - blow * 0.97) + 0.35, pile.position.z);
    const tokens = Math.round(lerp(2_000_000 * Math.max(0.03, grow), 1200, blow));
    pileText.textContent = `${tokens.toLocaleString('en-US')} tokens of pasted context`;
    place(pileLabel, pileTop, span(p, 0.04, 0.09) * (1 - span(p, 0.95, 0.99)));
    if (tokenOut) tokenOut.textContent = Math.round(lerp(2_000_000, 1200, span(p, 0.8, 0.9))).toLocaleString('en-US');

    // Dust drifts.
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3 + 1] += dt * 0.08;
      dustPos[i * 3] += Math.sin(time * 0.3 + i) * dt * 0.03;
      if (dustPos[i * 3 + 1] > 7) dustPos[i * 3 + 1] = -0.5;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- loop
  let visible = false;
  let frame = 0;
  let last = performance.now();
  let time = 0;
  // Acts play by themselves; scrolling only chooses which act you're on.
  // Each act has a stretch of the timeline it plays through, at its own pace.
  const ACTS = [
    { from: 0.0, to: 0.18, secs: 5 },    // alone in bubbles; the pile grows
    { from: 0.2, to: 0.37, secs: 4 },    // reaching for the same file; it tears
    { from: 0.38, to: 0.575, secs: 4 },  // bubbles pop, the table rises, they gather
    { from: 0.58, to: 0.779, secs: 8 },  // lock, hand-off, notes, tests, a question answered
    { from: 0.8, to: 1.0, secs: 4.5 }    // the pile blows away; results
  ];
  function actFromScroll() {
    if (section.classList.contains('story-static')) return -1;
    const r = track.getBoundingClientRect();
    const prog = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
    return Math.min(ACTS.length - 1, Math.floor(prog * ACTS.length * 0.9999 + 0.0001));
  }
  // Clicking a tick jumps to that act.
  ticks.forEach((t, i) => {
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    t.title = `Act ${i + 1}`;
    const go = () => {
      const top = track.getBoundingClientRect().top + window.scrollY;
      const step = (track.offsetHeight - window.innerHeight) / ACTS.length;
      window.scrollTo({ top: top + step * i + 2, behavior: 'smooth' });
    };
    t.addEventListener('click', go);
    t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  let act = -1;
  function advance(dt) {
    const now = actFromScroll();
    if (now < 0) return;
    const A = ACTS[now];
    if (now !== act) {
      // Coming back to an earlier act: rewind to its start quickly, then play it again.
      if (act !== -1 && now < act) shown = Math.min(shown, A.from);
      if (shown < A.from - 0.03 && now > act + 1) shown = A.from - 0.03;
      act = now;
      score.setAct(now);
      if (now === 4) setTimeout(() => score.chime(), 900);
    }
    const speed = (A.to - A.from) / A.secs;
    if (shown < A.from) shown = Math.min(A.from, shown + dt * 0.25);        // catch up into the act
    else if (shown < A.to) shown = Math.min(A.to, shown + dt * speed);      // play it
    else if (shown > A.to + 0.001) shown = Math.max(A.to, shown - dt * 0.4); // settle back if needed
  }
  function render() { composer.render(); }
  let lastDraw = 0;
  function loop(now) {
    frame = 0;
    const settled = act >= 0 && Math.abs(shown - ACTS[act].to) < 0.0005;
    const minGap = settled ? 1000 / 30 : 1000 / 61;          // 60fps while playing, 30fps idle
    // 4ms of slack: display ticks land a hair under the gap (16.67ms on 60Hz), and
    // without it every other frame was skipped (22fps settled, dropped frames playing).
    if (now - lastDraw < minGap - 4) { if (visible && !document.hidden && !reduce) frame = requestAnimationFrame(loop); return; }
    lastDraw = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    advance(dt);
    update(shown, time, dt);
    render();
    if (visible && !document.hidden && !reduce) frame = requestAnimationFrame(loop);
  }
  function kick() { if (!frame && visible && !reduce) { last = performance.now(); frame = requestAnimationFrame(loop); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? score.resume() : score.pause(); kick(); }, { rootMargin: '200px' }).observe(section);
  document.addEventListener('visibilitychange', kick);

  update(shown, 0, 0);
  render();
  section.classList.add('story-ready');
}
