/*
 * The story's score: an original ambient piece generated live with Web Audio
 * (no audio files). Off until the visitor turns it on (browsers require a
 * gesture anyway); the choice is remembered on this device.
 *
 *   act 0  sparse, a little lonely      (A minor add9, slow)
 *   act 1  uneasy                       (a cluster that rubs, low pulse)
 *   act 2  resolving                    (F major 7 opening up)
 *   act 3  warm, busy                   (C major 9, soft plucks as notes fly)
 *   act 4  bright, settled              (G 6/9 swell, then quiet)
 */
const CHORDS = [
  [45, 57, 60, 64, 71],        // A2 A3 C4 E4 B4
  [44, 56, 59, 60, 63],        // G#2 G#3 B3 C4 D#4 (rubbing)
  [41, 53, 57, 60, 64, 69],    // F2 F3 A3 C4 E4 A4
  [48, 55, 59, 62, 64, 67],    // C3 G3 B3 D4 E4 G4
  [43, 55, 59, 62, 64, 69]     // G2 G3 B3 D4 E4 A4
];
const PLUCK_SCALES = [
  [69, 72, 76, 79], [68, 71, 75], [69, 72, 76, 81], [72, 74, 76, 79, 81, 84], [74, 76, 79, 81, 83, 86]
];
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export function createScore() {
  let ctx = null;
  let master, pad, padFilter, delay, voices = [];
  let act = 0;
  let on = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // A soft room: feedback delay with a darkened tail.
    delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    delay.connect(tone).connect(fb).connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    tone.connect(wet).connect(master);
    // Pad bus.
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.6;
    pad = ctx.createGain();
    pad.gain.value = 0.16;
    padFilter.connect(pad).connect(master);
    pad.connect(delay);
    // Slow filter breathing.
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoAmt.gain.value = 380;
    lfo.connect(lfoAmt).connect(padFilter.frequency);
    lfo.start();
    setChord(act, 0.01);
  }

  function setChord(i, glide = 3) {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Fade old voices out, new ones in: two detuned soft oscillators per note.
    for (const v of voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + glide);
      v.oscs.forEach(o => o.stop(t + glide + 0.1));
    }
    voices = CHORDS[i].map((m, k) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime((k === 0 ? 0.5 : 0.22) / Math.sqrt(CHORDS[i].length), t + glide);
      g.connect(padFilter);
      const oscs = [-6, 6].map(cents => {
        const o = ctx.createOscillator();
        o.type = k === 0 ? 'sine' : 'triangle';
        o.frequency.value = hz(m);
        o.detune.value = cents + (Math.random() - 0.5) * 4;
        o.connect(g);
        o.start(t);
        return o;
      });
      return { g, oscs };
    });
    padFilter.frequency.setTargetAtTime([700, 520, 1100, 1500, 1900][i], t, glide / 2);
    delay.delayTime.setTargetAtTime(i === 1 ? 0.31 : 0.42, t, 0.5);
  }

  /** A soft bell for each note that flies, in the act's scale. */
  function pluck(strength = 1) {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    const scale = PLUCK_SCALES[act];
    const m = scale[Math.floor(Math.random() * scale.length)];
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o2.type = 'sine';
    o.frequency.value = hz(m);
    o2.frequency.value = hz(m) * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * strength, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(master);
    g.connect(delay);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.5);
    o2.stop(t + 1.5);
  }

  /** A low thud and a high crack: the file tearing. */
  function tear() {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(bp).connect(g).connect(master);
    g.connect(delay);
    src.start(t);
  }

  /** A rising shimmer: tests passing, results landing. */
  function chime() {
    if (!ctx || !on) return;
    [0, 0.09, 0.18, 0.27].forEach((dt, i) => setTimeout(() => pluck(1.4 - i * 0.15), dt * 1000));
  }

  return {
    get on() { return on; },
    async toggle(want = !on) {
      on = want;
      if (on && !ctx) build();
      if (!ctx) return on;
      if (on && ctx.state === 'suspended') await ctx.resume();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(on ? 0.9 : 0, t + (on ? 1.6 : 0.5));
      return on;
    },
    setAct(i) {
      if (i === act) return;
      act = i;
      setChord(i, i === 1 ? 1.2 : 3);
    },
    pluck, tear, chime,
    pause() { if (ctx && on) ctx.suspend(); },
    resume() { if (ctx && on) ctx.resume(); }
  };
}
