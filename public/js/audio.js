// Procedural chiptune music and sound effects (Web Audio), plus Pokémon cries.
// All melodies here are original.
import { cryUrl } from './data.js';

let ctx = null, master, musicGain, sfxGain;
const settings = { master: 0.8, music: 0.5, sfx: 0.8, muted: false };

export function applyAudioSettings(s = {}) {
  Object.assign(settings, s);
  if (!ctx) return;
  master.gain.value = settings.muted ? 0 : settings.master;
  musicGain.gain.value = settings.music * 0.35;
  sfxGain.gain.value = settings.sfx * 0.6;
}

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  ctx = new C();
  master = ctx.createGain(); master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  applyAudioSettings();
  if (pendingTrack) { const t = pendingTrack; pendingTrack = null; playMusic(t); }
}

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

function tone(dest, { freq, start, dur, type = 'square', vol = 0.2, slide = 0 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(dest);
  o.start(start); o.stop(start + dur + 0.02);
}

function noise(dest, { start, dur, vol = 0.2, hp = 800 }) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(start);
}

// ---------- Music ----------
// Each track: tempo, lead (melody), bass; notes as [midi|null, beats]
const TRACKS = {
  menu: {
    bpm: 96,
    lead: [[72, 1], [76, 1], [79, 1], [76, 1], [77, 1], [74, 1], [71, 2], [72, 1], [76, 1], [81, 1], [79, 1], [77, 1], [76, 0.5], [74, 0.5], [72, 2],
      [69, 1], [72, 1], [76, 1], [74, 1], [72, 1], [71, 1], [67, 2], [65, 1], [69, 1], [72, 1], [71, 1], [72, 4]],
    bass: [[48, 2], [55, 2], [53, 2], [55, 2], [48, 2], [57, 2], [53, 2], [55, 2], [45, 2], [52, 2], [50, 2], [43, 2], [41, 2], [43, 2], [48, 4]],
  },
  map: {
    bpm: 120,
    lead: [[67, 0.5], [72, 0.5], [74, 0.5], [76, 1], [74, 0.5], [72, 1], [79, 1], [76, 1], [77, 0.5], [76, 0.5], [74, 1], [72, 0.5], [74, 0.5], [76, 2],
      [72, 0.5], [74, 0.5], [76, 0.5], [77, 1], [76, 0.5], [74, 1], [71, 1], [67, 1], [69, 0.5], [71, 0.5], [72, 1], [74, 1], [72, 2]],
    bass: [[48, 1], [55, 1], [48, 1], [55, 1], [53, 1], [60, 1], [53, 1], [60, 1], [50, 1], [57, 1], [55, 1], [59, 1], [48, 1], [55, 1], [48, 2],
      [45, 1], [52, 1], [45, 1], [52, 1], [43, 1], [50, 1], [43, 1], [50, 1], [48, 2]],
  },
  battle: {
    bpm: 168,
    lead: [[69, 0.5], [69, 0.5], [72, 0.5], [69, 0.5], [74, 0.5], [69, 0.5], [76, 1], [74, 0.5], [72, 0.5], [71, 0.5], [72, 0.5], [74, 1], [69, 1],
      [77, 0.5], [76, 0.5], [74, 0.5], [72, 0.5], [74, 0.5], [76, 0.5], [79, 1], [77, 0.5], [76, 0.5], [74, 0.5], [76, 0.5], [72, 1], [69, 1],
      [69, 0.5], [72, 0.5], [76, 0.5], [81, 0.5], [79, 0.5], [76, 0.5], [74, 1], [72, 0.5], [74, 0.5], [76, 0.5], [74, 0.5], [71, 1], [68, 1]],
    bass: [[45, 0.5], [45, 0.5], [57, 0.5], [45, 0.5], [45, 0.5], [57, 0.5], [45, 0.5], [57, 0.5], [41, 0.5], [41, 0.5], [53, 0.5], [41, 0.5], [43, 0.5], [55, 0.5], [43, 0.5], [55, 0.5]],
  },
  boss: {
    bpm: 176,
    lead: [[64, 0.5], [67, 0.5], [71, 0.5], [76, 1], [74, 0.5], [71, 0.5], [72, 0.5], [74, 1], [71, 1], [67, 0.5], [69, 0.5], [71, 1],
      [76, 0.5], [79, 0.5], [83, 1], [81, 0.5], [79, 0.5], [78, 0.5], [76, 0.5], [74, 1], [75, 1], [76, 2]],
    bass: [[40, 0.5], [40, 0.5], [52, 0.5], [40, 0.5], [43, 0.5], [43, 0.5], [55, 0.5], [43, 0.5], [36, 0.5], [36, 0.5], [48, 0.5], [36, 0.5], [35, 0.5], [35, 0.5], [47, 0.5], [47, 0.5]],
  },
  victory: {
    bpm: 140, loop: false,
    lead: [[67, 0.5], [72, 0.5], [76, 0.5], [79, 1.5], [76, 0.5], [79, 2], [81, 0.5], [79, 0.5], [77, 0.5], [76, 0.5], [74, 0.5], [76, 0.5], [72, 3]],
    bass: [[48, 2], [52, 2], [53, 2], [55, 2], [48, 4]],
  },
  hall: {
    bpm: 104,
    lead: [[72, 1], [79, 1], [84, 2], [83, 1], [81, 1], [79, 2], [77, 1], [76, 1], [74, 1], [76, 1], [79, 4],
      [72, 1], [76, 1], [79, 1], [84, 1], [86, 2], [84, 1], [83, 1], [81, 2], [79, 1], [77, 1], [76, 1], [74, 1], [72, 4]],
    bass: [[48, 4], [53, 4], [55, 4], [48, 4], [45, 4], [53, 4], [55, 4], [48, 4]],
  },
};

let current = null, pendingTrack = null, timer = null;

export function playMusic(name) {
  if (!ctx) { pendingTrack = name; return; }
  if (current?.name === name) return;
  stopMusic();
  const tr = TRACKS[name];
  if (!tr) return;
  const beat = 60 / tr.bpm;
  const seqs = [
    { notes: tr.lead, i: 0, t: ctx.currentTime + 0.1, type: 'square', vol: 0.12 },
    { notes: tr.bass, i: 0, t: ctx.currentTime + 0.1, type: 'triangle', vol: 0.22 },
  ];
  current = { name };
  const token = current;
  const schedule = () => {
    if (current !== token) return;
    for (const s of seqs) {
      while (s.t < ctx.currentTime + 0.4) {
        if (s.i >= s.notes.length) {
          if (tr.loop === false) { s.done = true; break; }
          s.i = 0;
        }
        const [n, beats] = s.notes[s.i++];
        if (n != null) tone(musicGain, { freq: midi(n), start: s.t, dur: beats * beat * 0.92, type: s.type, vol: s.vol });
        s.t += beats * beat;
      }
    }
  };
  schedule();
  timer = setInterval(schedule, 120);
}

export function stopMusic() {
  current = null;
  clearInterval(timer);
}

// ---------- Sound effects ----------
export function sfx(name) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  const S = sfxGain;
  switch (name) {
    case 'select': tone(S, { freq: 988, start: t, dur: 0.06, vol: 0.15 }); break;
    case 'back': tone(S, { freq: 660, start: t, dur: 0.06, vol: 0.15 }); break;
    case 'hit': noise(S, { start: t, dur: 0.18, vol: 0.35, hp: 400 }); tone(S, { freq: 220, start: t, dur: 0.12, type: 'square', vol: 0.2, slide: 0.4 }); break;
    case 'move': tone(S, { freq: 440, start: t, dur: 0.15, type: 'sawtooth', vol: 0.12, slide: 2 }); break;
    case 'faint': tone(S, { freq: 600, start: t, dur: 0.6, type: 'square', vol: 0.15, slide: 0.2 }); break;
    case 'heal': [72, 76, 79, 84].forEach((n, i) => tone(S, { freq: midi(n), start: t + i * 0.08, dur: 0.12, vol: 0.12, type: 'triangle' })); break;
    case 'up': [64, 68, 71].forEach((n, i) => tone(S, { freq: midi(n), start: t + i * 0.05, dur: 0.08, vol: 0.12 })); break;
    case 'down': [71, 67, 64].forEach((n, i) => tone(S, { freq: midi(n), start: t + i * 0.05, dur: 0.08, vol: 0.12 })); break;
    case 'status': tone(S, { freq: 300, start: t, dur: 0.3, type: 'sawtooth', vol: 0.1, slide: 1.5 }); break;
    case 'exp': tone(S, { freq: 800, start: t, dur: 0.4, type: 'triangle', vol: 0.08, slide: 1.8 }); break;
    case 'levelup': [[72, 0], [76, 0.1], [79, 0.2], [84, 0.3]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.14, vol: 0.14 })); break;
    case 'learn': [[79, 0], [84, 0.12]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.18, vol: 0.12 })); break;
    case 'ball': tone(S, { freq: 300, start: t, dur: 0.25, type: 'triangle', vol: 0.2, slide: 3 }); break;
    case 'shake': tone(S, { freq: 180, start: t, dur: 0.08, type: 'square', vol: 0.15 }); tone(S, { freq: 140, start: t + 0.1, dur: 0.08, type: 'square', vol: 0.15 }); break;
    case 'caught': [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [84, 0.5]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.2, vol: 0.14 })); break;
    case 'run': [0, 0.08, 0.16].forEach(d => noise(S, { start: t + d, dur: 0.06, vol: 0.15, hp: 2000 })); break;
    case 'coin': [[88, 0], [93, 0.07]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.12, vol: 0.12 })); break;
    case 'evolve': for (let i = 0; i < 12; i++) tone(S, { freq: midi(60 + i * 2), start: t + i * 0.12, dur: 0.12, vol: 0.1, type: 'triangle' }); break;
    case 'shiny': [[88, 0], [91, 0.08], [96, 0.16], [100, 0.24]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.2, vol: 0.1, type: 'triangle' })); break;
    case 'achievement': [[72, 0], [76, 0.1], [79, 0.2], [84, 0.3], [88, 0.45]].forEach(([n, d]) => tone(S, { freq: midi(n), start: t + d, dur: 0.22, vol: 0.12, type: 'square' })); break;
    case 'error': tone(S, { freq: 150, start: t, dur: 0.2, type: 'square', vol: 0.15 }); break;
  }
}

export function playCry(id) {
  if (settings.muted || !settings.sfx || !settings.master) return;
  try {
    const a = new Audio(cryUrl(id));
    a.volume = Math.min(1, settings.master * settings.sfx * 0.5);
    a.play().catch(() => {});
  } catch { /* cries are optional */ }
}
