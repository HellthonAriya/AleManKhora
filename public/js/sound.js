/**
 * AleManKhora — Sound effects
 * ===========================
 * Tiny synthesized SFX via the Web Audio API (no asset files, no network).
 * Every cue is a short blip/chord built from oscillators, so the whole thing
 * weighs nothing and works offline. Honors a persisted mute toggle.
 */

let ctx = null;
let muted = false;
try { muted = localStorage.getItem('sfx_muted') === '1'; } catch {}

function ac() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/** One oscillator note. t0 is an offset (seconds) from "now". */
function note(freq, t0, dur, { type = 'sine', gain = 0.14 } = {}) {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  const start = c.currentTime + t0;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Each cue is a list of [freq, offset, dur, opts?].
const CUES = {
  move:     [[330, 0, 0.09, { type: 'triangle', gain: 0.10 }]],
  place:    [[262, 0, 0.10, { type: 'square', gain: 0.07 }]],
  capture:  [[200, 0, 0.10, { type: 'sawtooth', gain: 0.10 }], [150, 0.06, 0.12, { type: 'sawtooth', gain: 0.09 }]],
  turn:     [[523, 0, 0.10, { type: 'sine', gain: 0.12 }], [784, 0.08, 0.12, { type: 'sine', gain: 0.10 }]],
  trick:    [[440, 0, 0.08], [587, 0.07, 0.10], [880, 0.14, 0.12]],
  reaction: [[660, 0, 0.08, { type: 'triangle', gain: 0.08 }]],
  notify:   [[700, 0, 0.09], [900, 0.09, 0.11]],
  start:    [[392, 0, 0.10], [523, 0.10, 0.10], [659, 0.20, 0.16]],
  win:      [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.14], [1047, 0.38, 0.26]],
  lose:     [[392, 0, 0.16, { type: 'sine', gain: 0.12 }], [294, 0.16, 0.18, { type: 'sine', gain: 0.12 }], [196, 0.34, 0.30, { type: 'sine', gain: 0.12 }]],
  error:    [[160, 0, 0.18, { type: 'sawtooth', gain: 0.10 }]],
  achievement: [[659, 0, 0.10], [880, 0.10, 0.10], [1047, 0.20, 0.10], [1319, 0.30, 0.24]],
};

export function playSound(name) {
  if (muted) return;
  const cue = CUES[name];
  if (!cue) return;
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  for (const [freq, t0, dur, opts] of cue) note(freq, t0, dur, opts);
}

export function isSoundMuted() { return muted; }

export function setSoundMuted(v) {
  muted = !!v;
  try { localStorage.setItem('sfx_muted', muted ? '1' : '0'); } catch {}
  if (!muted) playSound('reaction'); // little confirmation blip
}

export function toggleSound() { setSoundMuted(!muted); return muted; }
