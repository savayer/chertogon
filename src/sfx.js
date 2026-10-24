// Sound: effects from assets/sfx/<event>.mp3 where we have them (Web Audio synth otherwise), music from assets/music.
// The AudioContext can only start after a user gesture, so unlockAudio() is called from input handlers.
const VOLUME = 0.5;
const FILES = ['hurt', 'shoot', 'fire', 'pickup-m', 'pickup-l', 'pickup-b', 'pickup-c', 'pickup-v', 'pickup-h', 'pickup-w'];
// Lighter fireballs fly every 0.15 s; stacking the 0.55 s sample that often clips, so it restarts at most every 0.3 s.
const RETRIGGER = { fire: 0.3 };
let ac = null;
let master = null;
let noiseBuf = null;
let muted = false;

// Downloads start right away; decoding needs the AudioContext, so it waits for unlockAudio().
const downloads = new Map(FILES.map((name) => {
  const download = fetch(`assets/sfx/${name}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))));
  download.catch(() => {}); // reported in decodeFiles(); avoids an unhandled rejection before the first click
  return [name, download];
}));
const buffers = new Map();
const lastStart = new Map();

// Music streams through <audio> (minutes of audio would be tens of MB decoded) but is routed
// through Web Audio, so its volume works on iOS too and the mute button covers it.
const MUSIC_VOLUME = 0.3; // relative to effects
const TRACKS = { bg: 'assets/music/bg.mp3', boss: 'assets/music/boss.mp3' };
const music = {};
let cue = { track: null, volume: 0 };

function startMusic() {
  const bus = ac.createGain();
  bus.gain.value = MUSIC_VOLUME;
  bus.connect(master);
  for (const [name, url] of Object.entries(TRACKS)) {
    const el = new Audio(url);
    el.loop = true;
    const gain = ac.createGain();
    gain.gain.value = 0;
    ac.createMediaElementSource(el).connect(gain).connect(bus);
    // Both start inside the unlocking gesture; switching tracks later is only a crossfade.
    el.play().catch((e) => console.warn(`music ${name} unavailable`, e));
    music[name] = { el, gain };
  }
}

// track: 'bg' | 'boss'; volume 0..1 on top of MUSIC_VOLUME. Cheap to call every frame.
export function setMusic(track, volume = 1) {
  if (!ac || !music[track] || (cue.track === track && cue.volume === volume)) return;
  if (track === 'boss' && cue.track !== 'boss') music.boss.el.currentTime = 0;
  cue = { track, volume };
  for (const [name, { gain }] of Object.entries(music)) {
    gain.gain.setTargetAtTime(name === track ? volume : 0, ac.currentTime, 0.35);
  }
}

export function pauseAudio(paused) {
  if (!ac) return;
  if (paused) ac.suspend();
  else ac.resume();
}

function decodeFiles() {
  for (const [name, download] of downloads) {
    download
      .then((data) => ac.decodeAudioData(data))
      .then((buf) => buffers.set(name, buf))
      .catch((e) => console.warn(`sound ${name} unavailable`, e));
  }
  downloads.clear();
}

export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ac.destination);
    decodeFiles();
    startMusic();
  }
  if (ac.state === 'suspended') ac.resume();
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : VOLUME;
}

function tone(freq, dur, { type = 'square', vol = 0.2, to = freq, delay = 0 } = {}) {
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise(dur, { vol = 0.2, freq = 1500, to = freq, type = 'bandpass', delay = 0 } = {}) {
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer();
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const arpeggio = (notes, step, len) => notes.forEach((f, i) => tone(f, len, { vol: 0.12, delay: i * step }));

// Muted trombone note: sawtooth through a "wah" filter, optional vibrato and pitch droop.
function brass(freq, dur, delay, { vibrato = 0, droop = 1 } = {}) {
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.linearRampToValueAtTime(freq * droop, t0 + dur);
  const stops = [osc];
  if (vibrato) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ac.createGain();
    depth.gain.value = freq * vibrato;
    lfo.connect(depth).connect(osc.frequency);
    stops.push(lfo);
  }
  const wah = ac.createBiquadFilter();
  wah.type = 'lowpass';
  wah.Q.value = 3;
  wah.frequency.setValueAtTime(400, t0);
  wah.frequency.exponentialRampToValueAtTime(1300, t0 + 0.12);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.001, t0);
  env.gain.exponentialRampToValueAtTime(0.3, t0 + 0.04);
  env.gain.setValueAtTime(0.3, t0 + dur * 0.75);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(wah).connect(env).connect(master);
  for (const o of stops) {
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

// Synth for events without a file. Keys match the event names emitted by game.js;
// pickup-<kind> falls back to the generic pickup blip.
const SOUNDS = {
  kill: () => {
    tone(520, 0.16, { type: 'triangle', to: 90, vol: 0.2 });
    noise(0.1, { freq: 800, vol: 0.15 });
  },
  stomp: () => tone(200, 0.1, { to: 70, vol: 0.2 }),
  pickup: () => {
    tone(660, 0.08, { type: 'sine', vol: 0.18 });
    tone(990, 0.12, { type: 'sine', vol: 0.18, delay: 0.07 });
  },
  // пум... пум... пуммммм
  death: () => {
    brass(233, 0.34, 0);
    brass(220, 0.34, 0.42);
    brass(208, 1.4, 0.84, { vibrato: 0.03, droop: 0.97 });
  },
  spit: () => noise(0.3, { type: 'lowpass', freq: 600, to: 2500, vol: 0.12 }),
  bossHit: () => tone(140, 0.09, { to: 90, vol: 0.18 }),
  bossDown: () => arpeggio([523, 659, 784, 1047], 0.12, 0.18),
  victory: () => arpeggio([523, 659, 784, 1047, 784, 1047, 1319], 0.13, 0.2),
};

export function play(name) {
  if (!ac || muted || ac.state !== 'running') return;
  const buf = buffers.get(name);
  if (buf) {
    if (ac.currentTime - (lastStart.get(name) ?? -Infinity) < (RETRIGGER[name] ?? 0)) return;
    lastStart.set(name, ac.currentTime);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
    return;
  }
  (SOUNDS[name] ?? (name.startsWith('pickup') ? SOUNDS.pickup : null))?.();
}
