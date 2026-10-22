// Synth voices + SFX for the WebAudio engine. Everything is synthesized here
// (no samples). Voices take an engine E (from createEngine), an output node,
// a start time and musical parameters; they schedule their own envelopes and
// stop their oscillators, so they are fire-and-forget and work identically in
// an AudioContext or an OfflineAudioContext (used for headless analysis).

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createEngine(ctx) {
  const E = { ctx };
  E.master = ctx.createGain();
  E.master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  // soft clip after the compressor guarantees we never exceed full scale
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = '2x';
  E.out = ctx.createGain();
  E.out.gain.value = 1;
  E.master.connect(comp);
  comp.connect(clip);
  clip.connect(E.out);
  E.out.connect(ctx.destination);
  E.comp = comp;

  E.music = ctx.createGain();
  E.music.gain.value = 0.42;
  // music low-pass used for the STUN duck / filter sweep
  E.musicLP = ctx.createBiquadFilter();
  E.musicLP.type = 'lowpass';
  E.musicLP.frequency.value = 20000;
  E.musicLP.Q.value = 0.9;
  E.music.connect(E.musicLP);
  E.musicLP.connect(E.master);
  E.sfx = ctx.createGain();
  E.sfx.gain.value = 0.8;
  E.sfx.connect(E.master);

  // shared reverb (generated impulse) and tempo-synced echo
  E.rev = ctx.createConvolver();
  E.rev.buffer = impulse(ctx, 2.4, 2.6);
  E.revOut = ctx.createGain();
  E.revOut.gain.value = 0.32;
  E.rev.connect(E.revOut);
  E.revOut.connect(E.master);
  E.revIn = ctx.createGain();
  E.revIn.gain.value = 1;
  E.revIn.connect(E.rev);

  E.delay = ctx.createDelay(2);
  E.delay.delayTime.value = 0.3;
  E.delayFb = ctx.createGain();
  E.delayFb.gain.value = 0.34;
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 2600;
  E.delayIn = ctx.createGain();
  E.delayIn.connect(E.delay);
  E.delay.connect(dlp);
  dlp.connect(E.delayFb);
  E.delayFb.connect(E.delay);
  const dOut = ctx.createGain();
  dOut.gain.value = 0.45;
  dlp.connect(dOut);
  dOut.connect(E.music);
  dOut.connect(E.revIn);

  E.noise = noiseBuffer(ctx, 2);
  E.dist = distCurve(3);
  E.noiseSeed = 1;
  return E;
}

function softClipCurve() {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.abs(x) < 0.7 ? x : Math.sign(x) * (0.7 + 0.29 * Math.tanh((Math.abs(x) - 0.7) / 0.29));
  }
  return c;
}
function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
// Deterministic LCG noise so offline renders are reproducible.
function noiseBuffer(ctx, secs) {
  const len = Math.floor(ctx.sampleRate * secs);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  return b;
}
function impulse(ctx, secs, decay) {
  const len = Math.floor(ctx.sampleRate * secs);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 777;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const t = i / len;
      // slight pre-delay + early reflections, then exponential tail
      const er = i < ctx.sampleRate * 0.012 ? 0 : 1;
      d[i] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - t, decay) * er * 0.5;
    }
  }
  return b;
}

// ---------- tiny helpers ----------
const osc = (E, type, f, t0, t1) => {
  const o = E.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  o.start(t0);
  o.stop(t1 + 0.05);
  return o;
};
const gain = (E, v = 0) => { const g = E.ctx.createGain(); g.gain.value = v; return g; };
const filt = (E, type, f, q = 0.7) => { const b = E.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const noise = (E, t0, t1) => {
  const s = E.ctx.createBufferSource();
  s.buffer = E.noise;
  s.loop = true;
  E.noiseSeed = (E.noiseSeed * 7 + 3) % 97;
  s.start(t0, (E.noiseSeed / 97) * 1.5);
  s.stop(t1 + 0.05);
  return s;
};
// ADSR on a gain param. Returns end time.
function env(p, t, a, d, s, r, peak, dur) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3);
  const off = Math.max(t + a, t + dur);
  p.setTargetAtTime(0, off, r / 4);
  return off + r;
}
// Panned sub-buses are cached per output node (one StereoPanner per side, not per note).
const panTo = (E, out, pan) => {
  if (!pan || !E.ctx.createStereoPanner) return out;
  const key = pan > 0 ? 'R' : 'L';
  out._pan = out._pan || {};
  if (!out._pan[key]) {
    const p = E.ctx.createStereoPanner();
    p.pan.value = pan > 0 ? 0.45 : -0.45;
    p.connect(out);
    out._pan[key] = p;
  }
  return out._pan[key];
};
const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) if (nodes[i] && nodes[i + 1]) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
// Effect sends are cached per (engine, amount) so notes don't each allocate send gains.
function sendNode(E, dest, amt) {
  E._sends = E._sends || new Map();
  const key = (dest === E.revIn ? 'r' : 'd') + amt;
  let g = E._sends.get(key);
  if (!g) { g = gain(E, amt); g.connect(dest); E._sends.set(key, g); }
  return g;
}
function send(E, node, rev = 0, dly = 0) {
  if (rev > 0) node.connect(sendNode(E, E.revIn, rev));
  if (dly > 0) node.connect(sendNode(E, E.delayIn, dly));
}

// ---------- music voices (dur in seconds, vel 0..1) ----------
export const VOICES = {
  // 2-operator FM bass: punchy, slightly growly
  bass(E, out, t, m, dur, vel) {
    const f = mtof(m), end = t + dur + 0.12;
    const car = osc(E, 'sine', f, t, end);
    const mod = osc(E, 'sine', f, t, end);
    const mg = gain(E, 0);
    mg.gain.setValueAtTime(f * 4.2 * vel, t);
    mg.gain.setTargetAtTime(f * 1.1, t, 0.05);
    chain(mod, mg);
    mg.connect(car.frequency);
    const sq = osc(E, 'triangle', f / 2, t, end);
    const sg = gain(E, 0.3);
    chain(sq, sg);
    const g = gain(E);
    env(g.gain, t, 0.004, 0.18, 0.55, 0.06, 0.42 * vel, dur);
    car.connect(g);
    sg.connect(g);
    g.connect(out);
  },
  // brass section: 3 detuned saws per note into an enveloped resonant lowpass
  brass(E, out, t, notes, dur, vel) {
    const end = t + dur + 0.3;
    const lp = filt(E, 'lowpass', 300, 2.2);
    const peak = 900 + 2600 * vel;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(peak, t + 0.035);
    lp.frequency.setTargetAtTime(peak * 0.45, t + 0.035, 0.12);
    lp.frequency.setTargetAtTime(240, t + dur, 0.06);
    const g = gain(E);
    env(g.gain, t, 0.012, 0.2, 0.7, 0.14, 0.19 * vel / Math.sqrt(notes.length), dur);
    for (const m of notes) {
      for (const dt of [-8, 7]) {
        const o = osc(E, 'sawtooth', mtof(m), t, end);
        o.detune.value = dt;
        o.connect(lp);
      }
    }
    chain(lp, g, out);
    send(E, g, 0.35);
  },
  // warm pad: detuned saws + sub triangle, slow attack, long release
  pad(E, out, t, notes, dur, vel) {
    const end = t + dur + 1.4;
    const lp = filt(E, 'lowpass', 1100, 0.5);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.6);
    const g = gain(E);
    env(g.gain, t, Math.min(0.6, dur * 0.4), 0.5, 0.85, 1.2, 0.09 * vel / Math.sqrt(notes.length), dur);
    for (const m of notes) {
      for (const dt of [-12, 11]) { const o = osc(E, 'sawtooth', mtof(m), t, end); o.detune.value = dt; o.connect(lp); }
      const tr = osc(E, 'triangle', mtof(m - 12), t, end);
      const tg = gain(E, 0.5);
      chain(tr, tg, lp);
    }
    chain(lp, g, out);
    send(E, g, 0.6);
  },
  // lead: square+saw with delayed vibrato, a touch of portamento, echo send
  lead(E, out, t, m, dur, vel) {
    const f = mtof(m), end = t + dur + 0.25;
    const lfo = osc(E, 'sine', 5.6, t, end);
    const lg = gain(E, 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.2, dur * 0.5));
    lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.2, dur * 0.5) + 0.25);
    chain(lfo, lg);
    const a = osc(E, 'square', f, t, end);
    const b = osc(E, 'sawtooth', f, t, end);
    b.detune.value = 6;
    a.frequency.setValueAtTime(f * 0.985, t);
    a.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    lg.connect(a.frequency);
    lg.connect(b.frequency);
    const ag = gain(E, 0.5), bg = gain(E, 0.6);
    const lp = filt(E, 'lowpass', 3400, 1.2);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.setTargetAtTime(2600, t, 0.15);
    chain(a, ag, lp);
    chain(b, bg, lp);
    const g = gain(E);
    env(g.gain, t, 0.008, 0.25, 0.8, 0.09, 0.12 * vel, dur);
    chain(lp, g, out);
    send(E, g, 0.28, 0.35);
  },
  // FM bell / glassy arpeggio
  bell(E, out, t, m, dur, vel, pan) {
    const f = mtof(m), end = t + Math.max(dur, 0.25) + 0.5;
    const car = osc(E, 'sine', f, t, end);
    const mod = osc(E, 'sine', f * 3.5, t, end);
    const mg = gain(E, 0);
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.setTargetAtTime(f * 0.15, t, 0.08);
    chain(mod, mg);
    mg.connect(car.frequency);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, 0.16);
    chain(car, g, panTo(E, out, pan));
    send(E, g, 0.4, 0.5);
  },
  // soft pluck for the title melody
  pluck(E, out, t, m, dur, vel) {
    const f = mtof(m), end = t + dur + 0.8;
    const o = osc(E, 'triangle', f, t, end);
    const o2 = osc(E, 'sine', f * 2, t, end);
    const g2 = gain(E, 0.3);
    chain(o2, g2);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.006);
    g.gain.setTargetAtTime(0.06 * vel, t + 0.006, 0.18);
    g.gain.setTargetAtTime(0, t + dur, 0.2);
    o.connect(g);
    g2.connect(g);
    g.connect(out);
    send(E, g, 0.5, 0.45);
  },
  // choir-like "ah" pad: detuned saws through two vowel formant bands, slow swell + vibrato
  choir(E, out, t, notes, dur, vel) {
    const end = t + dur + 1.0;
    const f1 = filt(E, 'bandpass', 720, 5), f2 = filt(E, 'bandpass', 1150, 6), f3 = filt(E, 'bandpass', 2600, 8);
    const mix = gain(E, 1);
    const g3 = gain(E, 0.35);
    f1.connect(mix); f2.connect(mix); f3.connect(g3); g3.connect(mix);
    const vib = osc(E, 'sine', 5.2, t, end);
    for (const m of notes) {
      for (const dt of [-11, 9]) {
        const o = osc(E, 'sawtooth', mtof(m), t, end);
        o.detune.value = dt;
        const vg = gain(E, mtof(m) * 0.006);
        vib.connect(vg); vg.connect(o.frequency);
        o.connect(f1); o.connect(f2); o.connect(f3);
      }
    }
    const g = gain(E);
    env(g.gain, t, Math.min(0.5, dur * 0.3), 0.6, 0.9, 0.9, 0.26 * vel / Math.sqrt(notes.length), dur);
    chain(mix, g, out);
    send(E, g, 0.7);
  },
  // 90s "orchestra hit": brass chord + filtered noise + low thump
  ohit(E, out, t, notes, dur, vel) {
    VOICES.brass(E, out, t, notes, Math.max(dur, 0.18), vel);
    VOICES.brass(E, out, t, notes.map((n) => n + 12), Math.max(dur, 0.18), vel * 0.6);
    const n = noise(E, t, t + 0.4);
    const bp = filt(E, 'bandpass', 1400, 0.8);
    const g = gain(E);
    g.gain.setValueAtTime(0.25 * vel, t);
    g.gain.setTargetAtTime(0, t, 0.06);
    chain(n, bp, g, out);
    send(E, g, 0.5);
    VOICES.timp(E, out, t, notes[0] - 12, 0.4, vel);
  },
  // ---------- drums ----------
  kick(E, out, t, m, dur, vel) {
    const o = osc(E, 'sine', 170, t, t + 0.45);
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    const g = gain(E);
    g.gain.setValueAtTime(0.95 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.02, 0.09);
    const ws = E.ctx.createWaveShaper();
    ws.curve = E.dist;
    chain(o, g, ws, out);
    const n = noise(E, t, t + 0.02);
    const hp = filt(E, 'highpass', 3000);
    const ng = gain(E);
    ng.gain.setValueAtTime(0.25 * vel, t);
    ng.gain.setTargetAtTime(0, t, 0.006);
    chain(n, hp, ng, out);
  },
  snare(E, out, t, m, dur, vel) {
    const n = noise(E, t, t + 0.3);
    const bp = filt(E, 'bandpass', 2200, 0.6);
    const hp = filt(E, 'highpass', 700);
    const g = gain(E);
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.01, 0.055);
    chain(n, bp, hp, g, out);
    send(E, g, 0.25);
    const o = osc(E, 'triangle', 200, t, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = gain(E);
    og.gain.setValueAtTime(0.4 * vel, t);
    og.gain.setTargetAtTime(0, t, 0.035);
    chain(o, og, out);
  },
  hat(E, out, t, m, dur, vel, pan) {
    const open = m === 1;
    const n = noise(E, t, t + (open ? 0.35 : 0.08));
    const hp = filt(E, 'highpass', 7600);
    const g = gain(E);
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.002, open ? 0.08 : 0.014);
    chain(n, hp, g, panTo(E, out, pan === undefined ? 0.25 : pan));
  },
  crash(E, out, t, m, dur, vel) {
    const n = noise(E, t, t + 2.2);
    const hp = filt(E, 'highpass', 4200);
    const bp = filt(E, 'peaking', 8000, 0.8);
    bp.gain.value = 6;
    const g = gain(E);
    g.gain.setValueAtTime(0.22 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.01, 0.5);
    chain(n, hp, bp, g, out);
    send(E, g, 0.4);
  },
  tom(E, out, t, m, dur, vel) {
    const f = mtof(m || 45);
    const o = osc(E, 'sine', f * 1.6, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = gain(E);
    g.gain.setValueAtTime(0.6 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.01, 0.1);
    chain(o, g, out);
    send(E, g, 0.3);
  },
  timp(E, out, t, m, dur, vel) {
    const f = mtof(m);
    const o = osc(E, 'sine', f * 1.08, t, t + 1.2);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const o2 = osc(E, 'triangle', f * 1.5, t, t + 0.6);
    const g = gain(E), g2 = gain(E);
    g.gain.setValueAtTime(0.55 * vel, t);
    g.gain.setTargetAtTime(0, t + 0.02, 0.28);
    g2.gain.setValueAtTime(0.15 * vel, t);
    g2.gain.setTargetAtTime(0, t, 0.08);
    chain(o, g, out);
    chain(o2, g2, out);
    send(E, g, 0.4);
  },
};

// ---------- SFX (fire-and-forget, into E.sfx) ----------
// Each entry: [minIntervalSeconds, fn(E, out, t)]
export const SFX = {
  shot: [0.07, (E, out, t) => {
    // soft "pew": short filtered triangle chirp, low level, slight alternation
    E.shotAlt = (E.shotAlt || 0) ^ 1;
    const f0 = E.shotAlt ? 1500 : 1380;
    const o = osc(E, 'triangle', f0, t, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.06);
    const lp = filt(E, 'lowpass', 3500);
    const g = gain(E);
    g.gain.setValueAtTime(0.22, t);
    g.gain.setTargetAtTime(0, t + 0.005, 0.018);
    chain(o, lp, g, out);
  }],
  missile: [0.09, (E, out, t) => {
    const n = noise(E, t, t + 0.2);
    const bp = filt(E, 'bandpass', 900, 1.5);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.15);
    const g = gain(E);
    g.gain.setValueAtTime(0.4, t);
    g.gain.setTargetAtTime(0, t + 0.04, 0.04);
    chain(n, bp, g, out);
    const o = osc(E, 'square', 220, t, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.1);
    const og = gain(E);
    og.gain.setValueAtTime(0.05, t);
    og.gain.setTargetAtTime(0, t, 0.03);
    chain(o, filt(E, 'lowpass', 900), og, out);
  }],
  hit: [0.045, (E, out, t) => {
    const n = noise(E, t, t + 0.06);
    const bp = filt(E, 'bandpass', 2400, 1.2);
    const g = gain(E);
    g.gain.setValueAtTime(0.42, t);
    g.gain.setTargetAtTime(0, t, 0.012);
    chain(n, bp, g, out);
    const o = osc(E, 'square', 330, t, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.04);
    const og = gain(E);
    og.gain.setValueAtTime(0.12, t);
    og.gain.setTargetAtTime(0, t, 0.012);
    chain(o, og, out);
  }],
  armHit: [0.06, (E, out, t) => {
    // metallic tink: inharmonic FM
    const f = 2100;
    const car = osc(E, 'sine', f, t, t + 0.4);
    const mod = osc(E, 'sine', f * 1.41, t, t + 0.4);
    const mg = gain(E, f * 1.6);
    mg.gain.setTargetAtTime(0, t, 0.06);
    chain(mod, mg);
    mg.connect(car.frequency);
    const g = gain(E);
    g.gain.setValueAtTime(0.3, t);
    g.gain.setTargetAtTime(0, t, 0.07);
    chain(car, g, out);
    send(E, g, 0.3);
  }],
  explodeS: [0.05, (E, out, t) => boom(E, out, t, 0.32, 1400, 120, 0.4)],
  explodeL: [0.12, (E, out, t) => boom(E, out, t, 1.3, 700, 70, 0.9)],
  death: [0.3, (E, out, t) => {
    boom(E, out, t, 1.2, 900, 80, 0.8);
    const o = osc(E, 'square', 880, t, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.85);
    const g = gain(E);
    g.gain.setValueAtTime(0.09, t);
    g.gain.linearRampToValueAtTime(0, t + 0.85);
    chain(o, filt(E, 'lowpass', 2000), g, out);
  }],
  bossRoar: [1.0, (E, out, t) => {
    // eerie growl: low detuned saws, amplitude-modulated, through a sweeping resonant band
    const dur = 1.9;
    const bp = filt(E, 'bandpass', 300, 6);
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(880, t + 0.6);
    bp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const am = gain(E, 0.6);
    const lfo = osc(E, 'square', 28, t, t + dur);
    const lfoG = gain(E, 0.4);
    chain(lfo, lfoG);
    lfoG.connect(am.gain);
    for (const [f, dt] of [[55, 0], [58.3, 0], [82, 7], [41, 0]]) {
      const o = osc(E, 'sawtooth', f, t, t + dur);
      o.detune.value = dt;
      o.frequency.setValueAtTime(f * 1.25, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.4);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, t + dur);
      o.connect(bp);
    }
    const n = noise(E, t, t + dur);
    const ng = gain(E, 0.25);
    chain(n, filt(E, 'bandpass', 600, 3), ng, bp);
    const ws = E.ctx.createWaveShaper();
    ws.curve = E.dist;
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.25);
    g.gain.setTargetAtTime(0, t + dur - 0.6, 0.2);
    chain(bp, am, ws, g, out);
    send(E, g, 0.7);
  }],
  warning: [4.0, (E, out, t) => {
    // two-tone alarm siren with a low drone underneath, ~5.2 s
    const dur = 5.2;
    const a = osc(E, 'sawtooth', 620, t, t + dur);
    const b = osc(E, 'square', 622, t, t + dur);
    for (let k = 0; k < Math.floor(dur / 0.65); k++) {
      const tk = t + k * 0.65;
      a.frequency.setValueAtTime(620, tk);
      a.frequency.linearRampToValueAtTime(930, tk + 0.3);
      a.frequency.setValueAtTime(930, tk + 0.33);
      a.frequency.linearRampToValueAtTime(620, tk + 0.62);
      b.frequency.setValueAtTime(311, tk);
      b.frequency.linearRampToValueAtTime(466, tk + 0.3);
      b.frequency.setValueAtTime(466, tk + 0.33);
      b.frequency.linearRampToValueAtTime(311, tk + 0.62);
    }
    const lp = filt(E, 'lowpass', 2200, 3);
    const bg = gain(E, 0.5);
    chain(b, bg, lp);
    a.connect(lp);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.08);
    g.gain.setValueAtTime(0.13, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    chain(lp, g, out);
    send(E, g, 0.5);
    const d = osc(E, 'sawtooth', 36.7, t, t + dur);
    const d2 = osc(E, 'sawtooth', 37.2, t, t + dur);
    const dl = filt(E, 'lowpass', 160, 2);
    const dg = gain(E);
    dg.gain.setValueAtTime(0, t);
    dg.gain.linearRampToValueAtTime(0.32, t + 1.2);
    dg.gain.linearRampToValueAtTime(0, t + dur);
    d.connect(dl); d2.connect(dl);
    chain(dl, dg, out);
    VOICES.timp(E, out, t, 38, 1, 0.9);
  }],
  bomb: [0.5, (E, out, t) => {
    // black hole: deep descending sweep + inward-rushing noise
    const o = osc(E, 'sawtooth', 220, t, t + 1.8);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
    const lp = filt(E, 'lowpass', 900, 8);
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const g = gain(E);
    g.gain.setValueAtTime(0.35, t);
    g.gain.linearRampToValueAtTime(0, t + 1.7);
    chain(o, lp, g, out);
    const n = noise(E, t, t + 1.8);
    const bp = filt(E, 'bandpass', 300, 2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 1.4);
    const ng = gain(E);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.22, t + 1.2);
    ng.gain.linearRampToValueAtTime(0, t + 1.6);
    chain(n, bp, ng, out);
    send(E, g, 0.5);
    VOICES.timp(E, out, t, 31, 1, 1);
  }],
  powerup: [0.15, (E, out, t) => {
    [74, 78, 81, 86, 90].forEach((m, i) => VOICES.bell(E, out, t + i * 0.055, m, 0.2, 1.4));
  }],
  laserCharge: [0.6, (E, out, t) => {
    const dur = 1.3;
    const o = osc(E, 'sine', 180, t, t + dur);
    o.frequency.exponentialRampToValueAtTime(1500, t + dur);
    const o2 = osc(E, 'triangle', 182, t, t + dur);
    o2.frequency.exponentialRampToValueAtTime(1520, t + dur);
    const trem = osc(E, 'sine', 9, t, t + dur);
    trem.frequency.linearRampToValueAtTime(32, t + dur);
    const tg = gain(E, 0.5);
    const am = gain(E, 0.5);
    chain(trem, tg);
    tg.connect(am.gain);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.connect(am); o2.connect(am);
    chain(am, g, out);
    send(E, g, 0.4);
  }],
  laserFire: [0.4, (E, out, t) => {
    const dur = 0.9;
    const lp = filt(E, 'lowpass', 2400, 4);
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    for (const [f, dt] of [[110, 0], [111.5, 0], [220, 9]]) {
      const o = osc(E, 'sawtooth', f, t, t + dur);
      o.detune.value = dt;
      o.connect(lp);
    }
    const n = noise(E, t, t + dur);
    const ng = gain(E, 0.6);
    chain(n, filt(E, 'highpass', 1500), ng, lp);
    const ws = E.ctx.createWaveShaper();
    ws.curve = E.dist;
    const g = gain(E);
    g.gain.setValueAtTime(0.32, t);
    g.gain.setValueAtTime(0.32, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    chain(lp, ws, g, out);
    send(E, g, 0.4);
  }],
  // ---- fun-pass event SFX
  pop: [0.035, (E, out, t, chain = 1) => {
    // fish kill: short bubbly "pop", pitch rises with the chain (cap +1 octave)
    const semi = Math.min(12, Math.max(0, (chain | 0) - 1));
    const f = 620 * Math.pow(2, semi / 12);
    const o = osc(E, 'sine', f * 1.6, t, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.025);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.08);
    const g = gain(E);
    g.gain.setValueAtTime(0.2, t);
    g.gain.setTargetAtTime(0, t + 0.01, 0.025);
    chain_(o, g, out);
    const n = noise(E, t, t + 0.03);
    const ng = gain(E);
    ng.gain.setValueAtTime(0.08, t);
    ng.gain.setTargetAtTime(0, t, 0.006);
    chain_(n, filt(E, 'bandpass', 3000, 1.5), ng, out);
  }],
  popBurst: [0.03, (E, out, t, a = {}) => {
    const c = Math.max(1, a.chain | 0), n = Math.min(3, Math.max(0, (a.n | 0) - 1));
    SFX.pop[1](E, out, t, c);
    for (let k = 1; k <= n; k++) {
      // quick quieter ticks above the main pop
      const f = 620 * Math.pow(2, Math.min(14, c - 1 + 2 * k) / 12);
      const o = osc(E, 'sine', f * 1.5, t + k * 0.028, t + k * 0.028 + 0.05);
      o.frequency.exponentialRampToValueAtTime(f, t + k * 0.028 + 0.02);
      const g = gain(E);
      g.gain.setValueAtTime(0.09, t + k * 0.028);
      g.gain.setTargetAtTime(0, t + k * 0.028 + 0.005, 0.015);
      chain_(o, g, out);
    }
  }],
  wipe: [0.25, (E, out, t) => {
    [74, 78, 81, 86, 90, 93].forEach((m, i) => VOICES.bell(E, out, t + i * 0.045, m, 0.25, 1.5, i % 2 ? 0.5 : -0.5));
    VOICES.brass(E, out, t + 0.27, [74, 78, 81], 0.35, 1);
    VOICES.crash(E, out, t + 0.27, 0, 0.3, 0.6);
  }],
  gillTear: [0.08, (E, out, t) => {
    // wet crunch (low band noise burst) + metallic rip (detuned square sweep down)
    const n = noise(E, t, t + 0.3);
    const bp = filt(E, 'bandpass', 500, 1.2);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.25);
    const ws = E.ctx.createWaveShaper();
    ws.curve = E.dist;
    const g = gain(E);
    g.gain.setValueAtTime(0.55, t);
    g.gain.setTargetAtTime(0, t + 0.03, 0.06);
    chain_(n, bp, ws, g, out);
    for (const [f, dt] of [[1900, 0], [2010, 0], [1300, 15]]) {
      const o = osc(E, 'square', f, t, t + 0.22);
      o.detune.value = dt;
      o.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.2);
      const og = gain(E);
      og.gain.setValueAtTime(0.045, t);
      og.gain.setTargetAtTime(0, t + 0.04, 0.05);
      chain_(o, filt(E, 'highpass', 600), og, out);
    }
    VOICES.timp(E, out, t, 36, 0.5, 0.6);
  }],
  stun: [0.8, (E, out, t) => {
    // main impact right on the stunStart frame
    VOICES.ohit(E, out, t, [50, 53, 57], 0.5, 1);
    boom(E, out, t, 1.4, 500, 55, 1);
    VOICES.timp(E, out, t, 26, 1.2, 1);
    // afterwards: a rising swell (the beast convulsing) into a smaller thud
    const sw = 0.5, t1 = t + 0.25;
    const n = noise(E, t1, t1 + sw);
    const bp = filt(E, 'bandpass', 400, 1);
    bp.frequency.setValueAtTime(250, t1);
    bp.frequency.exponentialRampToValueAtTime(3000, t1 + sw);
    const ng = gain(E);
    ng.gain.setValueAtTime(0.0001, t1);
    ng.gain.exponentialRampToValueAtTime(0.18, t1 + sw);
    ng.gain.linearRampToValueAtTime(0, t1 + sw + 0.02);
    chain_(n, bp, ng, out);
    VOICES.timp(E, out, t1 + sw, 31, 0.6, 0.7);
  }],
  regrow: [0.2, (E, out, t) => {
    // subtle squelch
    const o = osc(E, 'sine', 140, t, t + 0.3);
    o.frequency.linearRampToValueAtTime(260, t + 0.12);
    o.frequency.linearRampToValueAtTime(180, t + 0.25);
    const lfo = osc(E, 'sine', 24, t, t + 0.3);
    const lg = gain(E, 40);
    chain_(lfo, lg);
    lg.connect(o.frequency);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.28);
    chain_(o, filt(E, 'lowpass', 700), g, out);
  }],
  warningShort: [1.0, (E, out, t) => {
    const a = osc(E, 'sawtooth', 620, t, t + 1.4);
    for (let k = 0; k < 2; k++) {
      const tk = t + k * 0.65;
      a.frequency.setValueAtTime(620, tk);
      a.frequency.linearRampToValueAtTime(930, tk + 0.3);
      a.frequency.setValueAtTime(930, tk + 0.33);
      a.frequency.linearRampToValueAtTime(620, tk + 0.62);
    }
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.06);
    g.gain.setValueAtTime(0.12, t + 1.1);
    g.gain.linearRampToValueAtTime(0, t + 1.35);
    chain_(a, filt(E, 'lowpass', 2200, 3), g, out);
    VOICES.timp(E, out, t, 38, 1, 0.8);
  }],
  // ---- spectacle (giga laser etc.)
  riser: [1.0, (E, out, t) => {
    const d = 1.3;
    const n = noise(E, t, t + d);
    const bp = filt(E, 'bandpass', 300, 2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(5000, t + d);
    const g = gain(E);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + d);
    g.gain.linearRampToValueAtTime(0, t + d + 0.05);
    chain_(n, bp, g, out);
    const o = osc(E, 'sawtooth', 110, t, t + d);
    o.frequency.exponentialRampToValueAtTime(440, t + d);
    const og = gain(E);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.06, t + d);
    og.gain.linearRampToValueAtTime(0, t + d + 0.05);
    chain_(o, filt(E, 'lowpass', 1500), og, out);
  }],
  gigaCharge: [2.0, (E, out, t) => {
    // long rising drone (detuned saws) + sub, resonant filter opening, ~2.8 s
    const d = 2.8;
    const lp = filt(E, 'lowpass', 200, 7);
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + d);
    for (const [f, dt] of [[55, -12], [55, 10], [110, 4]]) {
      const o = osc(E, 'sawtooth', f, t, t + d);
      o.detune.value = dt;
      o.frequency.exponentialRampToValueAtTime(f * 2, t + d);
      o.connect(lp);
    }
    const trem = osc(E, 'sine', 6, t, t + d);
    trem.frequency.linearRampToValueAtTime(24, t + d);
    const tg = gain(E, 0.35), am = gain(E, 0.65);
    chain_(trem, tg); tg.connect(am.gain);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + d * 0.9);
    g.gain.linearRampToValueAtTime(0, t + d + 0.05);
    chain_(lp, am, g, out);
    const sub = osc(E, 'sine', 32, t, t + d);
    sub.frequency.linearRampToValueAtTime(48, t + d);
    const sg = gain(E);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.45, t + d);
    sg.gain.linearRampToValueAtTime(0, t + d + 0.05);
    chain_(sub, sg, out);
    send(E, g, 0.5);
    SFX.riser[1](E, out, t + d - 1.3);
  }],
  gigaFire: [1.5, (E, out, t) => {
    // massive filtered noise roar + sub boom, sustained ~3 s
    const d = 3.0;
    const n = noise(E, t, t + d);
    const lp = filt(E, 'lowpass', 2400, 1.5);
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
    const ws = E.ctx.createWaveShaper();
    ws.curve = E.dist;
    const g = gain(E);
    g.gain.setValueAtTime(0.5, t);
    g.gain.setValueAtTime(0.45, t + d - 0.6);
    g.gain.linearRampToValueAtTime(0, t + d);
    chain_(n, lp, ws, g, out);
    const lfo = osc(E, 'sine', 9, t, t + d);
    const lg = gain(E, 0.15);
    chain_(lfo, lg); lg.connect(g.gain);
    for (const [f, dt] of [[73, 0], [73.6, 0], [146, 7]]) {
      const o = osc(E, 'sawtooth', f, t, t + d);
      o.detune.value = dt;
      const og = gain(E);
      og.gain.setValueAtTime(0.09, t);
      og.gain.setValueAtTime(0.09, t + d - 0.6);
      og.gain.linearRampToValueAtTime(0, t + d);
      chain_(o, filt(E, 'lowpass', 900, 3), og, out);
    }
    boom(E, out, t, 1.6, 600, 50, 1);
    send(E, g, 0.4);
    duckLight(E, t, d);
  }],
  rumble: [0.6, (E, out, t) => {
    const d = 1.6;
    const n = noise(E, t, t + d);
    const lp = filt(E, 'lowpass', 160, 1.2);
    const g = gain(E);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.15);
    g.gain.setTargetAtTime(0, t + 0.5, 0.35);
    chain_(n, lp, g, out);
    const o = osc(E, 'sine', 38, t, t + d);
    const og = gain(E);
    og.gain.setValueAtTime(0.35, t);
    og.gain.setTargetAtTime(0, t + 0.3, 0.4);
    chain_(o, og, out);
    for (let k = 0; k < 4; k++) VOICES.tom(E, out, t + 0.08 + k * 0.17, 33 + (k % 2) * 3, 0.2, 0.5);
  }],
  // presentation extras
  start: [0.3, (E, out, t) => {
    [62, 69, 74, 81].forEach((m, i) => VOICES.bell(E, out, t + i * 0.07, m, 0.3, 1.6));
    VOICES.brass(E, out, t + 0.28, [62, 69, 74], 0.4, 0.9);
  }],
  sonar: [1.0, (E, out, t) => {
    VOICES.bell(E, out, t, 93, 0.6, 1.2);
    VOICES.bell(E, out, t + 0.9, 93, 0.6, 0.5);
  }],
  tick: [0.03, (E, out, t) => {
    const o = osc(E, 'square', 1760, t, t + 0.03);
    const g = gain(E);
    g.gain.setValueAtTime(0.1, t);
    g.gain.setTargetAtTime(0, t, 0.008);
    chain(o, filt(E, 'lowpass', 4000), g, out);
  }],
  tally: [0.1, (E, out, t) => {
    VOICES.bell(E, out, t, 86, 0.3, 1.5);
    VOICES.bell(E, out, t + 0.06, 93, 0.3, 1.2);
  }],
};

function boom(E, out, t, dur, cutoff, f0, vel) {
  const n = noise(E, t, t + dur);
  const lp = filt(E, 'lowpass', cutoff, 0.9);
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.12), t + dur);
  const ws = E.ctx.createWaveShaper();
  ws.curve = E.dist;
  const g = gain(E);
  g.gain.setValueAtTime(0.55 * vel, t);
  g.gain.setTargetAtTime(0, t + 0.02, dur / 4);
  chain(n, lp, ws, g, out);
  const o = osc(E, 'sine', f0 * 2.2, t, t + dur);
  o.frequency.exponentialRampToValueAtTime(Math.max(25, f0 * 0.4), t + dur * 0.8);
  const og = gain(E);
  og.gain.setValueAtTime(0.7 * vel, t);
  og.gain.setTargetAtTime(0, t + 0.03, dur / 3.5);
  chain(o, og, out);
  send(E, g, 0.3 * vel);
}

const chain_ = (...n) => chain(...n);

// STUN duck: low-pass + dip the music for 'secs', then sweep back.
export function duckMusic(E, t, secs) {
  const f = E.musicLP.frequency, g = E.music.gain;
  f.cancelScheduledValues(t); g.cancelScheduledValues(t);
  f.setValueAtTime(f.value, t); g.setValueAtTime(g.value, t);
  f.exponentialRampToValueAtTime(420, t + 0.18);
  g.linearRampToValueAtTime(0.2, t + 0.18);
  unduckMusic(E, t + Math.max(0.5, secs), true);
}
export function unduckMusic(E, t, scheduled = false) {
  const f = E.musicLP.frequency, g = E.music.gain;
  if (!scheduled) { f.cancelScheduledValues(t); g.cancelScheduledValues(t); f.setValueAtTime(Math.max(40, f.value), t); g.setValueAtTime(g.value, t); }
  else { f.setValueAtTime(420, t); g.setValueAtTime(0.2, t); }
  f.exponentialRampToValueAtTime(20000, t + 0.9);
  g.linearRampToValueAtTime(0.42, t + 0.6);
}

// light duck (giga laser): music dips ~5 dB with a 1.4 kHz low-pass, then recovers.
export function duckLight(E, t, secs) {
  const f = E.musicLP.frequency, g = E.music.gain;
  f.cancelScheduledValues(t); g.cancelScheduledValues(t);
  f.setValueAtTime(Math.max(40, f.value), t); g.setValueAtTime(g.value, t);
  f.exponentialRampToValueAtTime(1400, t + 0.1);
  g.linearRampToValueAtTime(0.24, t + 0.1);
  f.setValueAtTime(1400, t + secs); g.setValueAtTime(0.24, t + secs);
  f.exponentialRampToValueAtTime(20000, t + secs + 0.7);
  g.linearRampToValueAtTime(0.42, t + secs + 0.5);
}
