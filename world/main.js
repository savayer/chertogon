// The 3D world's page: menu, input (keyboard, touch stick and buttons), the frame loop, HUD and the death screen.
// Rules live in game.js, the view in render.js. It is loaded with import(), so a browser without WebGL (or no CDN)
// only disables Play. Face, character and name come from the classic game's menu (same localStorage).
import { createGame, loadLevel, nextLevel, respawn, step } from './game.js';
import { VIEW_W, VIEW_H, musicCue } from '../src/game.js';
import { drawOverlay } from '../src/render.js';
import { loadSprites } from '../src/sprites.js';
import { t, setLang, getLang } from '../src/i18n.js';
import { unlockAudio, play, isMuted, setMuted, setMusic, pauseAudio } from '../src/sfx.js';
import { loadHead, CHARACTERS } from '../src/face.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const keys = { left: false, right: false, up: false, down: false };
const stick = { x: 0, z: 0 };
const input = { mx: 0, mz: 0, jump: false, fire: false };
let state = createGame();
loadLevel(state, 0);
let started = false;
let screen = 'menu';
let head = null;
let view = null; // render.js once it has started
let name = '';
let statusKey = '';
const NAME_KEY = 'chertogon.name';
const LANG_KEY = 'chertogon.lang';
const MUTE_KEY = 'chertogon.mute';
const HERO_KEY = 'chertogon.hero';
const STICK_R = 50; // px from the stick's center to full speed

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyK: 'jump', KeyJ: 'fire', KeyF: 'fire', KeyX: 'fire',
};

const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: setting lives until reload
  }
};

function resize() {
  const k = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = VIEW_W * k;
  canvas.height = VIEW_H * k;
}

function setStatus(key) {
  statusKey = key;
  $('status').textContent = key ? t(key) : '';
}

function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  document.title = t('worldTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-lang]')) el.setAttribute('aria-pressed', String(el.dataset.lang === getLang()));
  setStatus(statusKey);
  $('death').hidden = true; // re-shown with the new language by the next frame
}

function toggleSound() {
  setMuted(!isMuted());
  $('sound').textContent = isMuted() ? '🔇' : '🔊';
  $('sound').setAttribute('aria-pressed', String(!isMuted()));
  store(MUTE_KEY, isMuted() ? '1' : '');
}

function releaseAll() {
  for (const k in keys) keys[k] = false;
  input.jump = input.fire = false;
  setStick(0, 0);
  document.querySelectorAll('[data-key].on').forEach((b) => b.classList.remove('on'));
}

function showMenu() {
  screen = 'menu';
  releaseAll();
  document.body.classList.remove('playing');
  $('continue').hidden = !(started && state.mode !== 'victory');
  $('menu').hidden = false;
}

function startGame(fresh) {
  if (fresh) {
    state = createGame();
    loadLevel(state, 0);
    started = true;
  }
  screen = 'game';
  $('menu').hidden = true;
  document.body.classList.add('playing');
}

function advance() {
  if (state.mode === 'dead' && state.deadT > 0.8) respawn(state);
  else if (state.mode === 'levelComplete') nextLevel(state);
  else if (state.mode === 'victory') {
    started = false;
    showMenu();
  }
}

addEventListener('keydown', (e) => {
  if (screen !== 'game') return;
  const k = KEYS[e.code];
  if (k in keys) keys[k] = true;
  else if (k) input[k] = true;
  if (k) e.preventDefault();
  if (e.code === 'Enter') advance();
  if (e.code === 'Escape') showMenu();
  if (e.code === 'KeyM') toggleSound();
});
addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k in keys) keys[k] = false;
  else if (k) input[k] = false;
});
addEventListener('blur', releaseAll);
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
document.addEventListener('visibilitychange', () => pauseAudio(document.hidden));
addEventListener('resize', resize);
canvas.addEventListener('pointerdown', () => screen === 'game' && advance());

document.querySelectorAll('[data-key]').forEach((btn) => {
  const k = btn.dataset.key;
  const set = (v) => (e) => {
    e.preventDefault();
    input[k] = v;
    btn.classList.toggle('on', v);
    if (v && k === 'fire') advance();
  };
  btn.addEventListener('pointerdown', set(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, set(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

// The stick: the pointer's offset from its center, full speed at STICK_R px.
function setStick(dx, dz) {
  const len = Math.hypot(dx, dz);
  const k = len > STICK_R ? STICK_R / len : 1;
  stick.x = (dx * k) / STICK_R;
  stick.z = (dz * k) / STICK_R;
  $('knob').style.transform = `translate(${dx * k}px, ${dz * k}px)`;
}
const stickEl = $('stick');
const stickMove = (e) => {
  const r = stickEl.getBoundingClientRect();
  setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
};
stickEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  stickEl.setPointerCapture(e.pointerId);
  stickMove(e);
});
stickEl.addEventListener('pointermove', (e) => stickEl.hasPointerCapture(e.pointerId) && stickMove(e));
for (const ev of ['pointerup', 'pointercancel']) stickEl.addEventListener(ev, () => setStick(0, 0));

$('play').addEventListener('click', () => startGame(true));
$('continue').addEventListener('click', () => startGame(false));
$('retry').addEventListener('click', () => respawn(state));
$('restart').addEventListener('click', () => startGame(true));
$('sound').addEventListener('click', toggleSound);
for (const el of document.querySelectorAll('[data-lang]')) {
  el.addEventListener('click', () => {
    applyLang(el.dataset.lang);
    store(LANG_KEY, getLang());
  });
}

function frame(now) {
  const dt = (now - (frame.last ?? now)) / 1000;
  frame.last = now;
  if (screen === 'game') {
    input.mx = keys.right - keys.left + stick.x;
    input.mz = keys.down - keys.up + stick.z;
    step(state, input, dt);
  }
  for (const e of state.events) play(e);
  state.events.length = 0;
  const cue = screen === 'game' ? musicCue(state) : { track: 'bg', volume: 1 };
  setMusic(cue.track, cue.volume);

  const k = canvas.width / VIEW_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (view) drawOverlay(ctx, state, name, view.drawWorld(state, head));

  const deadShown = screen === 'game' && state.mode === 'dead' && state.deadT > 0.8;
  if (deadShown === $('death').hidden) {
    $('death').hidden = !deadShown;
    if (deadShown) {
      $('death-title').textContent = t('deathTitle', { name });
      $('death-cause').textContent = t(state.deathCause === 'pit' ? 'deathPit' : 'deathHp');
    }
  }
  requestAnimationFrame(frame);
}

window.__world = () => state; // debug handle for manual/e2e checks

let savedLang = null;
let hero = CHARACTERS[0]; // whose head is worn when none is uploaded
try {
  name = localStorage.getItem(NAME_KEY) || '';
  savedLang = localStorage.getItem(LANG_KEY);
  if (localStorage.getItem(MUTE_KEY)) toggleSound();
  if (CHARACTERS.includes(localStorage.getItem(HERO_KEY))) hero = localStorage.getItem(HERO_KEY);
} catch {
  // storage blocked: defaults
}
applyLang(savedLang || (navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'));
name ||= t('defaultName');
resize();
loadSprites();
loadHead(hero).then((h) => (head = h)).catch((e) => console.error('no head image', e));
import('./render.js')
  .then((m) => {
    m.initWorld($('gl'));
    view = m;
    $('play').disabled = false;
  })
  .catch((err) => {
    console.warn('3D world unavailable', err);
    setStatus('worldFailed');
  });
requestAnimationFrame(frame);
