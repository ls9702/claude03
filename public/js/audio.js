// Sound (Stage 5): Web Audio synthesized SFX + BGM per era.
//
//   import { audio } from './audio.js';
//   audio.install();               // unlock the AudioContext on the first pointer/touch/key (autoplay policy)
//   audio.play('coin');            // tick|coin|thud|fanfare|heart|whoosh|pop|tears|babble
//   audio.rouletteTicks(2400);     // slowing tick ramp while the wheel spins
//   audio.playEvent(engineEvent);  // tones.json `sfx` map → effect (setSfxMap(meta.presentation.sfx))
//   audio.setEra('elem');          // BGM: /assets/audio/bgm_<era>.mp3 when present, else a soft generated pad
//   audio.toggleMuted(); audio.setBgm(false); audio.setVolume(0.6); audio.onChange(cb)
//
// Drop-ins: public/assets/audio/sfx_<name>.mp3 replaces a synthesized effect, bgm_<era>.mp3 the pad.
// The file list comes from GET /api/audio once (no 404 probes). Nothing is created before a user gesture.
import { sfxForEvent } from './ui/cutinMap.js';

const KEYS = { muted: 'jinsei.muted', bgm: 'jinsei.bgm', volume: 'jinsei.volume' };
/** Synthesized effects (tones.json `sfx` values must be one of these). */
export const SFX_NAMES = ['tick', 'coin', 'thud', 'fanfare', 'heart', 'whoosh', 'pop', 'tears', 'babble'];
const ERA_CHORDS = {
  // root MIDI notes of a 4-chord loop per era (gentle, major-ish; senior slower)
  baby: [60, 65, 67, 65],
  elem: [67, 72, 74, 72],
  middle: [62, 67, 69, 67],
  high: [57, 53, 60, 55],
  young: [65, 70, 72, 70],
  middle_age: [58, 63, 65, 63],
  senior: [63, 68, 70, 68],
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function storageGet(k) {
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function storageSet(k, v) {
  try {
    globalThis.localStorage?.setItem(k, String(v));
  } catch {
    /* ignore */
  }
}

export function createAudio({ fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const st = {
    ctx: null,
    master: null,
    sfxBus: null,
    bgmBus: null,
    noise: null,
    muted: storageGet(KEYS.muted) === '1',
    bgmOn: storageGet(KEYS.bgm) !== '0',
    volume: Math.min(1, Math.max(0, Number(storageGet(KEYS.volume) ?? 0.7) || 0)),
    files: null, // Set of drop-in file names
    buffers: new Map(),
    era: null,
    bgm: null, // { stop() }
    sfxMap: {},
    installed: false,
    lastPlay: new Map(),
  };
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => cb(api.state));

  function loadFiles() {
    if (st.files || !fetchImpl) return Promise.resolve(st.files);
    st.files = new Set();
    return fetchImpl('/api/audio')
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((j) => {
        st.files = new Set(j.files ?? []);
        if (st.era) startBgm();
      })
      .catch(() => {});
  }

  function ensureCtx() {
    if (st.ctx) return st.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    st.ctx = ctx;
    st.master = ctx.createGain();
    st.master.gain.value = st.muted ? 0 : st.volume;
    st.master.connect(ctx.destination);
    st.sfxBus = ctx.createGain();
    st.sfxBus.gain.value = 0.9;
    st.sfxBus.connect(st.master);
    st.bgmBus = ctx.createGain();
    st.bgmBus.gain.value = 0.28;
    st.bgmBus.connect(st.master);
    const len = ctx.sampleRate;
    st.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = st.noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    return ctx;
  }

  /** Create/resume the context — call from a user gesture. */
  function unlock() {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    loadFiles();
    if (st.era && !st.bgm) startBgm();
  }

  // ---------- synth voices ----------
  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(type, f0, f1, t, dur, peak = 0.2, dest = st.sfxBus) {
    const ctx = st.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.008, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(t, dur, { type = 'bandpass', f0 = 800, f1 = 800, q = 1, peak = 0.2 } = {}) {
    const ctx = st.ctx;
    const src = ctx.createBufferSource();
    src.buffer = st.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, dur * 0.3, peak, dur);
    src.connect(f).connect(g).connect(st.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  const VOICES = {
    tick: (t) => tone('square', 1900, 1400, t, 0.025, 0.07),
    coin: (t) => {
      tone('square', 988, 988, t, 0.08, 0.09);
      tone('square', 1319, 1319, t + 0.08, 0.28, 0.09);
    },
    thud: (t) => {
      tone('sine', 150, 48, t, 0.55, 0.55);
      noise(t, 0.25, { type: 'lowpass', f0: 400, f1: 80, peak: 0.25 });
    },
    fanfare: (t) => {
      [523, 659, 784].forEach((f, i) => tone('triangle', f, f, t + i * 0.11, 0.16, 0.18));
      tone('triangle', 1047, 1047, t + 0.33, 0.6, 0.2);
      tone('triangle', 784, 784, t + 0.33, 0.6, 0.1);
    },
    heart: (t) => {
      tone('sine', 90, 60, t, 0.14, 0.4);
      tone('sine', 90, 60, t + 0.2, 0.16, 0.35);
      tone('sine', 1175, 1175, t + 0.05, 0.5, 0.06);
      tone('sine', 1568, 1568, t + 0.2, 0.45, 0.05);
    },
    whoosh: (t) => noise(t, 0.38, { f0: 300, f1: 2800, q: 0.8, peak: 0.22 }),
    pop: (t) => tone('sine', 380, 980, t, 0.08, 0.2),
    tears: (t) => {
      tone('triangle', 740, 520, t, 0.35, 0.1);
      tone('triangle', 622, 415, t + 0.3, 0.5, 0.1);
    },
    babble: (t, { seed = 3, count = 4 } = {}) => {
      for (let i = 0; i < count; i++) {
        const f = 420 + (((seed * (i + 7)) % 9) * 45);
        tone('sine', f, f * 1.08, t + i * 0.075, 0.06, 0.05);
      }
    },
  };

  function playFile(name) {
    const file = [...(st.files ?? [])].find((f) => f.startsWith(`sfx_${name}.`));
    if (!file) return false;
    const ctx = st.ctx;
    const url = `/assets/audio/${file}`;
    let p = st.buffers.get(url);
    if (!p) {
      p = fetchImpl(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      st.buffers.set(url, p);
    }
    p.then((buf) => {
      if (!buf || st.muted) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(st.sfxBus);
      src.start();
    });
    return true;
  }

  /** Play an effect by name (silently ignored before unlock / when muted / unknown). */
  function play(name, opts = {}) {
    if (!name || st.muted || !st.ctx || st.ctx.state !== 'running') return false;
    const now = performance.now();
    if (!opts.force && now - (st.lastPlay.get(name) ?? 0) < 60) return false; // de-dupe bursts
    st.lastPlay.set(name, now);
    if (playFile(name)) return true;
    const v = VOICES[name];
    if (!v) return false;
    try {
      v(st.ctx.currentTime + 0.01, opts);
    } catch {
      return false;
    }
    return true;
  }

  /** Roulette: ticks that slow down over `ms`. */
  function rouletteTicks(ms = 2000) {
    if (st.muted || !st.ctx || st.ctx.state !== 'running') return;
    const t0 = st.ctx.currentTime + 0.02;
    const dur = ms / 1000;
    let t = 0;
    let gap = 0.045;
    while (t < dur) {
      VOICES.tick(t0 + t);
      t += gap;
      gap *= 1.09;
    }
  }

  // ---------- BGM ----------
  function stopBgm() {
    st.bgm?.stop();
    st.bgm = null;
  }

  function padLoop(era) {
    const ctx = st.ctx;
    const chords = ERA_CHORDS[era] ?? ERA_CHORDS.elem;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    out.connect(lp).connect(st.bgmBus);
    out.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 2);
    const barSec = era === 'senior' ? 4.8 : 3.6;
    let i = 0;
    let stopped = false;
    function chord(t) {
      const root = chords[i % chords.length];
      i++;
      for (const [k, iv] of [0, 4, 7, 12].entries()) {
        const o = ctx.createOscillator();
        o.type = k === 3 ? 'sine' : 'triangle';
        o.frequency.value = midi(root - 12 + iv);
        o.detune.value = (k - 1.5) * 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.9);
        g.gain.linearRampToValueAtTime(0.0001, t + barSec + 0.8);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + barSec + 1);
      }
      // soft music-box melody note
      const n = root + [12, 16, 19, 14][i % 4];
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(n);
      const g = ctx.createGain();
      env(g, t + barSec * 0.5, 0.01, 0.05, 1.2);
      o.connect(g).connect(out);
      o.start(t + barSec * 0.5);
      o.stop(t + barSec * 0.5 + 1.3);
    }
    let next = ctx.currentTime + 0.1;
    const timer = setInterval(() => {
      if (stopped) return;
      while (next < ctx.currentTime + 1.5) {
        chord(next);
        next += barSec;
      }
    }, 400);
    chord(next);
    next += barSec;
    return {
      stop() {
        stopped = true;
        clearInterval(timer);
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.8);
        setTimeout(() => out.disconnect(), 1200);
      },
    };
  }

  function fileLoop(url) {
    const el = new Audio(url);
    el.loop = true;
    el.volume = (st.muted ? 0 : st.volume) * 0.4;
    el.play().catch(() => {});
    return {
      el,
      stop() {
        el.pause();
        el.src = '';
      },
    };
  }

  function startBgm() {
    stopBgm();
    if (!st.bgmOn || st.muted || !st.era || !st.ctx || st.ctx.state === 'closed') return;
    const file = [...(st.files ?? [])].find((f) => f.startsWith(`bgm_${st.era}.`));
    st.bgm = file ? fileLoop(`/assets/audio/${file}`) : padLoop(st.era);
    st.bgm.era = st.era;
  }

  function applyGain() {
    if (st.master) st.master.gain.setTargetAtTime(st.muted ? 0 : st.volume, st.ctx.currentTime, 0.05);
    if (st.bgm?.el) st.bgm.el.volume = (st.muted ? 0 : st.volume) * 0.4;
  }

  const api = {
    install(target = globalThis) {
      if (st.installed || !target?.addEventListener) return;
      st.installed = true;
      const h = () => unlock();
      for (const ev of ['pointerdown', 'touchstart', 'keydown']) target.addEventListener(ev, h, { capture: true, passive: true });
    },
    unlock,
    play,
    rouletteTicks,
    /** Engine event → effect via the tones.json sfx map. */
    playEvent(e) {
      const name = sfxForEvent(e, st.sfxMap);
      if (name === 'tick') return rouletteTicks(1800);
      return play(name);
    },
    setSfxMap(map) {
      st.sfxMap = map ?? {};
    },
    setEra(era) {
      if (era === st.era) return;
      st.era = era;
      if (st.ctx) startBgm();
    },
    setMuted(v) {
      st.muted = !!v;
      storageSet(KEYS.muted, st.muted ? '1' : '0');
      if (!st.muted) unlock();
      applyGain();
      if (st.muted) stopBgm();
      else if (!st.bgm) startBgm();
      notify();
    },
    toggleMuted() {
      api.setMuted(!st.muted);
    },
    setBgm(v) {
      st.bgmOn = !!v;
      storageSet(KEYS.bgm, st.bgmOn ? '1' : '0');
      if (st.bgmOn) {
        unlock();
        startBgm();
      } else stopBgm();
      notify();
    },
    setVolume(v) {
      st.volume = Math.min(1, Math.max(0, Number(v) || 0));
      storageSet(KEYS.volume, st.volume);
      applyGain();
      notify();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get state() {
      return {
        muted: st.muted,
        bgm: st.bgmOn,
        volume: st.volume,
        unlocked: st.ctx?.state === 'running',
        bgmPlaying: !!st.bgm,
        bgmSource: st.bgm ? (st.bgm.el ? 'file' : 'pad') : null,
        era: st.era,
      };
    },
    stopAll() {
      stopBgm();
    },
  };
  return api;
}

/** App-wide instance. */
export const audio = createAudio();
