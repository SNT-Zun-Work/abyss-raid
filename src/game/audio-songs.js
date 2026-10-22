// Original compositions, written as step data (16 steps per bar).
// Each song: { bpm, loopStart, loopEnd, loop, events:[{s,i,n,l,v,p}] }
//   s = absolute step, i = voice name, n = midi note or array, l = length in steps,
//   v = velocity, p = pan.  Steps < loopStart form a one-shot intro.
//
// Boss theme "ROSEA ASSAULT" (D minor, 152 BPM): 2-bar orchestra-hit intro,
// then a 24-bar loop (≈37.9 s): A (hook, 8) – B (soaring, 8) – C (brass break, 4)
// – D (build-up with snare roll, 4).

const ROOT = { D: 38, Eb: 39, E: 40, F: 41, G: 43, A: 45, Bb: 46, C: 48 };
// triads as semitone offsets
const Q = { m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus: [0, 5, 7], add9: [0, 3, 7, 14], d7: [0, 4, 7, 10] };
const chordNotes = (root, q, base) => {
  // voice the chord close to `base`
  let r = root;
  while (r < base - 6) r += 12;
  while (r > base + 6) r -= 12;
  return Q[q].map((x) => r + x);
};

function song(bpm) {
  const ev = [];
  const add = (s, i, n, l = 1, v = 1, p) => ev.push({ s, i, n, l, v, p });
  return { bpm, events: ev, add };
}

// ------------------------------------------------------------------ BOSS
// FINAL FORM variation: same material, +1 semitone, 164 BPM, choir pad, 16th hats,
// four-on-the-floor push and a 1-bar hit intro.
export function bossTheme(opts = {}) {
  const FINAL = !!opts.final;
  const S = song(FINAL ? 164 : 152);
  const { add } = S;
  const INTRO = FINAL ? 1 : 2;
  const bar = (b) => (INTRO + b) * 16;

  if (FINAL) {
    for (const st of [0, 4, 8]) add(st, 'ohit', chordNotes(ROOT.A, 'M', 61), 2, 1);
    add(0, 'crash', 0, 1, 1);
    for (const st of [0, 4, 8]) add(st, 'timp', 33, 2, 1);
    for (let k = 10; k < 16; k++) add(k, 'snare', 0, 1, 0.4 + (k - 10) * 0.1);
  }
  // intro: orchestra hits + timpani + snare roll
  if (!FINAL) add(0, 'ohit', chordNotes(ROOT.D, 'm', 62), 3, 1);
  if (!FINAL) {
    add(0, 'crash', 0, 1, 0.8);
    add(6, 'ohit', chordNotes(ROOT.D, 'm', 62), 2, 0.9);
    add(12, 'ohit', chordNotes(ROOT.Bb, 'M', 62), 3, 0.95);
    add(16, 'ohit', chordNotes(ROOT.A, 'M', 61), 6, 1);
    for (const st of [0, 6, 12]) add(st, 'timp', 38, 2, 0.9);
    add(16, 'timp', 33, 2, 1);
    for (let k = 0; k < 8; k++) add(24 + k, 'snare', 0, 1, 0.35 + k * 0.08);
    add(28, 'tom', 50, 1, 0.8); add(29, 'tom', 47, 1, 0.8); add(30, 'tom', 43, 1, 0.9); add(31, 'tom', 40, 1, 1);
    // a short bass run into the loop
    [45, 47, 49, 50].forEach((m, k) => add(28 + k, 'bass', m - 12, 1, 0.9));
  }

  const prog = [
    // A
    ['D', 'm'], ['Bb', 'M'], ['C', 'M'], ['A', 'M'], ['D', 'm'], ['Bb', 'M'], ['C', 'M'], ['A', 'M'],
    // B
    ['G', 'm'], ['D', 'm'], ['Bb', 'M'], ['A', 'M'], ['G', 'm'], ['D', 'm'], ['Eb', 'M'], ['A', 'M'],
    // C (brass break)
    ['Bb', 'M'], ['C', 'M'], ['D', 'm'], ['D', 'm'],
    // D (build)
    ['Bb', 'M'], ['C', 'M'], ['A', 'M'], ['A', 'M'],
  ];
  const BASS_A = [0, 0, 12, 0, 0, 12, 0, 0, 0, 12, 0, 0, 7, 0, 12, 0];
  const BASS_B = [0, 0, 12, 0, 7, 0, 12, 0, 0, 0, 12, 0, 7, 12, 7, 0];

  prog.forEach(([r, q], b) => {
    const s0 = bar(b);
    const root = ROOT[r] - (ROOT[r] > 44 ? 12 : 0); // bass register D1..C2-ish
    const sec = b < 8 ? 'A' : b < 16 ? 'B' : b < 20 ? 'C' : 'D';
    // ---- bass
    if (sec === 'A' || sec === 'B') {
      const P = sec === 'A' ? BASS_A : BASS_B;
      P.forEach((o, k) => add(s0 + k, 'bass', root + 12 + o, 1, k % 4 === 0 ? 1 : 0.78));
    } else if (sec === 'C') {
      [0, 3, 6, 8, 10, 12, 14].forEach((k, j) => add(s0 + k, 'bass', root + 12 + (j % 3 === 2 ? 12 : 0), 2, 0.95));
    } else {
      for (let k = 0; k < 16; k++) add(s0 + k, 'bass', root + 12 + (k % 8 === 7 ? 12 : 0), 1, 0.7 + (b - 20) * 0.08);
    }
    // ---- final form: choir pad + denser drums
    if (FINAL) {
      add(s0, 'choir', chordNotes(ROOT[r], q, 62), 16, sec === 'C' ? 0.8 : 1);
      for (let k = 1; k < 16; k += 2) add(s0 + k, 'hat', 0, 1, 0.4, -0.35);
      if (sec !== 'D') { add(s0 + 4, 'kick', 0, 1, 0.8); add(s0 + 12, 'kick', 0, 1, 0.8); }
    }
    // ---- pad (always, quiet)
    add(s0, 'pad', chordNotes(ROOT[r], q, 57), 16, sec === 'C' ? 0.6 : 0.85);
    // ---- brass
    const ch = chordNotes(ROOT[r], q, 64);
    if (sec === 'A') {
      for (const [k, l] of [[0, 3], [6, 2], [12, 2]]) add(s0 + k, 'brass', ch, l, k === 0 ? 0.75 : 0.6);
    } else if (sec === 'B') {
      add(s0, 'brass', ch, 14, 0.5);
      add(s0 + 14, 'brass', ch, 2, 0.7);
    } else if (sec === 'C') {
      for (const [k, l, v] of [[0, 2, 1], [3, 2, 0.85], [6, 4, 0.95], [12, 1, 0.8], [14, 2, 1]]) add(s0 + k, 'brass', ch.map((n) => n + (b === 19 && k >= 12 ? 2 : 0)), l, v);
      if (b === 16 || b === 18) add(s0, 'ohit', ch, 2, 0.8);
    } else {
      for (let k = 0; k < 16; k += 4) add(s0 + k, 'brass', ch.map((n) => n + (b === 23 ? Math.floor(k / 4) : 0)), 2, 0.6 + k * 0.02 + (b - 20) * 0.06);
    }
    // ---- arpeggio (A, B)
    if (sec === 'A' || sec === 'B') {
      const tones = chordNotes(ROOT[r], q, 74);
      const seq = [0, 1, 2, 3, 2, 1, 0, 1];
      for (let k = 0; k < 16; k++) {
        const ti = seq[k % 8];
        const n = ti === 3 ? tones[0] + 12 : tones[ti];
        add(s0 + k, 'bell', n, 1, sec === 'A' ? 0.35 : 0.28, k % 2 ? 0.45 : -0.45);
      }
    }
    // ---- drums
    const D = (k, i, v = 1, n = 0, p) => add(s0 + k, i, n, 1, v, p);
    if (sec === 'A' || sec === 'B') {
      for (const k of sec === 'A' ? [0, 8, 10] : [0, 6, 8, 14]) D(k, 'kick');
      D(4, 'snare'); D(12, 'snare');
      D(15, 'snare', 0.25);
      for (let k = 0; k < 16; k += sec === 'A' ? 2 : 1) D(k, 'hat', k % 4 === 2 ? 1 : 0.55, k === 14 ? 1 : 0, 0.3);
      if (b % 4 === 0) D(0, 'crash', 0.9);
      if (b === 7 || b === 15) { D(12, 'tom', 0.8, 50); D(13, 'tom', 0.8, 47); D(14, 'tom', 0.9, 43); D(15, 'tom', 1, 40); }
    } else if (sec === 'C') {
      D(0, 'kick'); D(10, 'kick'); D(8, 'snare');
      D(0, 'timp', 0.8, ROOT[r] - 12);
      for (let k = 0; k < 16; k += 2) D(k, 'hat', 0.5, 0, -0.3);
      if (b === 16) D(0, 'crash', 1);
      if (b === 19) for (let k = 8; k < 16; k++) D(k, 'tom', 0.6 + (k - 8) * 0.05, 52 - (k - 8) * 2);
    } else {
      for (const k of [0, 4, 8, 12]) D(k, 'kick');
      if (b < 22) { D(4, 'snare'); D(12, 'snare'); }
      else if (b === 22) for (let k = 0; k < 16; k += 2) D(k, 'snare', 0.5 + k * 0.02);
      else for (let k = 0; k < 16; k++) D(k, 'snare', 0.35 + k * 0.045);
      for (let k = 0; k < 16; k += 2) D(k, 'hat', 0.6);
      if (b === 20) D(0, 'crash', 1);
      if (b === 22) D(0, 'timp', 1, 33);
    }
  });

  // ---- lead melody (bars relative to loop start): [step, midi, len]
  const LEAD = {
    0: [[0, 69, 3], [3, 74, 3], [6, 76, 2], [8, 77, 6], [14, 76, 2]],
    1: [[0, 74, 6], [6, 72, 2], [8, 74, 4], [12, 77, 4]],
    2: [[0, 76, 6], [6, 79, 6], [12, 76, 2], [14, 72, 2]],
    3: [[0, 76, 12], [12, 73, 2], [14, 76, 2]],
    4: [[0, 69, 3], [3, 74, 3], [6, 76, 2], [8, 77, 6], [14, 79, 2]],
    5: [[0, 77, 4], [4, 74, 2], [6, 77, 2], [8, 82, 4], [12, 81, 4]],
    6: [[0, 79, 4], [4, 77, 2], [6, 76, 2], [8, 79, 4], [12, 72, 4]],
    7: [[0, 76, 4], [4, 73, 4], [8, 69, 8]],
    8: [[0, 79, 8], [8, 77, 4], [12, 74, 4]],
    9: [[0, 77, 8], [8, 76, 4], [12, 74, 4]],
    10: [[0, 74, 6], [6, 77, 6], [12, 82, 4]],
    11: [[0, 81, 12], [12, 79, 2], [14, 76, 2]],
    12: [[0, 79, 6], [6, 81, 2], [8, 82, 6], [14, 81, 2]],
    13: [[0, 81, 6], [6, 77, 2], [8, 74, 8]],
    14: [[0, 75, 6], [6, 79, 6], [12, 82, 4]],
    15: [[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 76, 8]],
    // C: lead rests (brass break), short answer phrases
    17: [[8, 79, 2], [10, 81, 2], [12, 84, 4]],
    19: [[8, 81, 2], [10, 84, 2], [12, 86, 4]],
    // D: rising held line
    20: [[0, 77, 8], [8, 79, 8]],
    21: [[0, 79, 8], [8, 81, 8]],
    22: [[0, 81, 16]],
    23: [[0, 85, 8], [8, 88, 6]],
  };
  for (const [b, notes] of Object.entries(LEAD)) for (const [k, m, l] of notes) add(bar(Number(b)) + k, 'lead', m, l, 1);

  S.loopStart = INTRO * 16;
  S.loopEnd = (INTRO + prog.length) * 16;
  S.loop = true;
  S.delaySteps = 3;
  if (FINAL) {
    const PITCHED = new Set(['bass', 'pad', 'brass', 'lead', 'bell', 'ohit', 'choir', 'timp', 'tom']);
    for (const e of S.events) if (PITCHED.has(e.i)) e.n = Array.isArray(e.n) ? e.n.map((m) => m + 1) : e.n + 1;
    S.gain = 1.05;
  }
  return S;
}
export const finalTheme = () => bossTheme({ final: true });

// ------------------------------------------------------------------ TITLE
// "SUNKEN CHORALE" — moody pad + FM-bell arpeggio + sparse pluck melody, 84 BPM, 8-bar loop.
export function titleTheme() {
  const S = song(84);
  S.gain = 1.7;
  const { add } = S;
  const prog = [['D', 'add9'], ['Bb', 'M7'], ['G', 'm7'], ['A', 'sus'], ['D', 'add9'], ['Bb', 'M7'], ['Eb', 'M7'], ['A', 'd7']];
  const MEL = {
    4: [[0, 81, 6], [6, 77, 2], [8, 76, 4], [12, 74, 4]],
    5: [[0, 77, 8], [8, 74, 8]],
    6: [[0, 79, 6], [6, 75, 2], [8, 74, 8]],
    7: [[0, 73, 8], [8, 76, 8]],
  };
  prog.forEach(([r, q], b) => {
    const s0 = b * 16;
    add(s0, 'pad', chordNotes(ROOT[r], q, 58), 16, 1);
    add(s0, 'bass', ROOT[r] - 12 + (ROOT[r] > 44 ? 0 : 12), 14, 0.45);
    const tones = chordNotes(ROOT[r], q, 70);
    const up = [...tones, ...tones.map((n) => n + 12)];
    for (let k = 0; k < 16; k++) add(s0 + k, 'bell', up[(k * 1) % up.length], 1, 0.38 - (k % 2) * 0.12, Math.sin(k * 0.8) * 0.6);
    if (b % 4 === 0) add(s0, 'timp', ROOT[r] - 12, 2, 0.35);
    for (const [k, m, l] of MEL[b] || []) add(s0 + k, 'pluck', m, l, 0.9);
    if (b % 2 === 1) add(s0 + 8, 'hat', 1, 1, 0.25, 0.5);
  });
  S.loopStart = 0;
  S.loopEnd = prog.length * 16;
  S.loop = true;
  S.delaySteps = 3;
  return S;
}

// ------------------------------------------------------------------ APPROACH
// Tense 4-bar loop at 132 BPM: D pedal, dissonant pad, ticking hats.
export function approachTheme() {
  const S = song(132);
  const { add } = S;
  for (let b = 0; b < 4; b++) {
    const s0 = b * 16;
    for (let k = 0; k < 16; k += 2) add(s0 + k, 'bass', 26 + (k % 8 === 6 ? 12 : 0) + (b === 3 && k >= 8 ? 1 : 0), 1, 0.7 + k * 0.015);
    add(s0, 'pad', b < 2 ? [50, 57, 63] : [51, 57, 62], 16, 0.8);
    for (let k = 0; k < 16; k++) add(s0 + k, 'hat', 0, 1, k % 4 === 0 ? 0.7 : 0.3, 0.35);
    for (const k of [0, 6, 8]) add(s0 + k, 'kick', 0, 1, 0.75);
    if (b % 2 === 0) add(s0, 'timp', 38, 2, 0.7);
    add(s0 + 12, 'bell', b % 2 ? 87 : 86, 2, 0.35, 0.5);
    if (b === 3) for (let k = 8; k < 16; k++) add(s0 + k, 'snare', 0, 1, 0.2 + (k - 8) * 0.06);
  }
  S.loopStart = 0;
  S.loopEnd = 64;
  S.loop = true;
  S.delaySteps = 3;
  return S;
}

// ------------------------------------------------------------------ JINGLES
export function victoryJingle() {
  const S = song(140);
  S.gain = 1.2;
  const { add } = S;
  const lead = [[0, 69, 2], [2, 74, 2], [4, 78, 2], [6, 81, 6], [12, 79, 2], [14, 81, 2], [16, 83, 4], [20, 79, 2], [22, 83, 2], [24, 86, 8], [32, 85, 2], [34, 86, 14]];
  for (const [k, m, l] of lead) add(k, 'lead', m, l, 1);
  add(0, 'brass', [62, 66, 69], 6, 0.9); add(6, 'brass', [62, 66, 69], 6, 0.8);
  add(16, 'brass', [67, 71, 74], 4, 0.9); add(20, 'brass', [69, 73, 76], 4, 0.85);
  add(24, 'brass', [66, 69, 74], 8, 0.9);
  add(32, 'ohit', [62, 66, 69], 16, 1);
  add(32, 'pad', [62, 66, 69, 74], 16, 1);
  for (const k of [0, 6, 12, 16, 20, 24, 28]) add(k, 'kick', 0, 1, 0.9);
  for (const k of [4, 12, 20]) add(k, 'snare', 0, 1, 0.9);
  for (let k = 24; k < 32; k++) add(k, 'snare', 0, 1, 0.3 + (k - 24) * 0.08);
  add(0, 'crash', 0, 1, 0.8); add(32, 'crash', 0, 1, 1);
  add(32, 'timp', 38, 2, 1);
  [38, 38, 43, 45, 38].forEach((m, i) => add([0, 6, 16, 20, 32][i], 'bass', m, 4, 0.9));
  S.loopStart = 0;
  S.loopEnd = 52;
  S.loop = false;
  S.delaySteps = 3;
  return S;
}

export function gameoverJingle() {
  const S = song(80);
  S.gain = 1.5;
  const { add } = S;
  for (const [k, m, l] of [[0, 74, 4], [4, 72, 4], [8, 69, 4], [12, 65, 4], [16, 62, 14]]) add(k, 'lead', m, l, 0.7);
  add(0, 'pad', [50, 53, 57], 8, 0.9); add(8, 'pad', [46, 50, 53], 8, 0.9); add(16, 'pad', [50, 53, 57], 16, 0.9);
  add(0, 'bass', 26, 8, 0.6); add(8, 'bass', 22, 8, 0.6); add(16, 'bass', 26, 14, 0.6);
  add(16, 'timp', 26, 2, 0.6);
  S.loopStart = 0;
  S.loopEnd = 34;
  S.loop = false;
  S.delaySteps = 3;
  return S;
}

export const SONGS = { boss: bossTheme, final: finalTheme, title: titleTheme, approach: approachTheme, victory: victoryJingle, gameover: gameoverJingle };
