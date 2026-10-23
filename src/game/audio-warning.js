// Original alarm score. Shared by realtime playback and OfflineAudioContext QA.
// Offsets match scene slams at frames 14 and 208 (alarm starts on frame 1).
export function warningScore(E, out, t, zone = 'V', duration = 5.48) {
  const c = E.ctx, amber = zone === 'G', end = t + duration;
  const bus = c.createGain();
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(0.85, t + 0.035);
  bus.gain.setValueAtTime(0.85, end - 0.16);
  bus.gain.linearRampToValueAtTime(0, end);
  bus.connect(out);
  const wet = c.createGain(); wet.gain.value = 0.18; bus.connect(wet); wet.connect(E.revIn);
  const source = (type, f, at, stop) => {
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
    o.start(at); o.stop(stop); return o;
  };
  const envelope = (at, attack, release, level) => {
    const g = c.createGain(); g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + release);
    return g;
  };
  // Deep pressure bed; sine sub stays clear of the distorted horn harmonics.
  const sub = source('sine', amber ? 43.65 : 36.71, t, end);
  const sg = envelope(t, 0.8, duration, 0.3); sub.connect(sg); sg.connect(bus);
  const horn = c.createBiquadFilter(); horn.type = 'lowpass'; horn.Q.value = 0.8;
  horn.frequency.setValueAtTime(amber ? 1500 : 1050, t);
  horn.frequency.linearRampToValueAtTime(680, end);
  const dist = c.createWaveShaper(); dist.curve = E.dist; dist.oversample = '2x';
  horn.connect(dist);
  const hg = c.createGain(); hg.gain.value = 0.11; dist.connect(hg);
  const pan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
  hg.connect(pan); pan.connect(bus);
  for (let k = 0; k < Math.ceil(duration / 0.7); k++) {
    const at = t + k * 0.7, off = Math.min(end, at + 0.64);
    const f = (amber ? 146.83 : 110) * (k % 2 ? 1.5 : 1);
    if (pan.pan) { pan.pan.setValueAtTime(k % 2 ? -0.6 : 0.6, at); pan.pan.linearRampToValueAtTime(k % 2 ? 0.6 : -0.6, off); }
    const g = envelope(at, 0.06, off - at, 0.9);
    for (const [type, mul] of [['sawtooth', 1], ['triangle', 0.5]]) {
      const o = source(type, f * mul, at, off); o.frequency.exponentialRampToValueAtTime(f * mul * 0.96, off); o.connect(g);
    }
    g.connect(horn);
  }
  // Steel bell clusters and a pitched sub drop, rather than a broadband loud crack.
  for (const offset of [13 / 60, duration < 2 ? 39 / 60 : 207 / 60]) {
    const at = t + offset;
    if (at >= end - 0.1) continue;
    for (const [i, f] of [191, 413, 787, 1289].entries()) {
      const stop = Math.min(end, at + 0.8);
      const o = source('sine', f * (amber ? 1.19 : 1), at, stop);
      const g = envelope(at, 0.002, stop - at, 0.12 / (i + 1));
      o.connect(g); g.connect(bus);
    }
    const stop = Math.min(end, at + 0.65), o = source('sine', 124, at, stop);
    o.frequency.exponentialRampToValueAtTime(32, stop);
    const g = envelope(at, 0.004, stop - at, 0.48); o.connect(g); g.connect(bus);
  }
  // Filtered noise rises into the existing boss music handoff, then closes cleanly.
  const riseAt = t + Math.max(0.6, duration - 1.3);
  const n = c.createBufferSource(); n.buffer = E.noise; n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.65;
  bp.frequency.setValueAtTime(220, riseAt); bp.frequency.exponentialRampToValueAtTime(4600, end - 0.07);
  const ng = c.createGain(); ng.gain.setValueAtTime(0, riseAt);
  ng.gain.linearRampToValueAtTime(0.23, end - 0.13); ng.gain.linearRampToValueAtTime(0, end);
  n.connect(bp); bp.connect(ng); ng.connect(bus); n.start(riseAt); n.stop(end);
  // Disconnect the score's output after its last source ends; reverb tail remains on E.rev.
  n.onended = () => { bus.disconnect(); wet.disconnect(); };
}
