import { createGame, loadLevel, nextLevel, respawn, step, musicCue, VIEW_W, VIEW_H } from './game.js';
import { drawGame, drawCharacter } from './render.js';
import { loadSprites } from './sprites.js';
import { t, setLang, getLang } from './i18n.js';
import { unlockAudio, play, isMuted, setMuted, setMusic, pauseAudio } from './sfx.js';
import { loadImage, detectFace, fallbackEyes, cutHead, frameHead, stylizeHead, saveHead, clearHead, loadHead } from './face.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const preview = $('preview');
const pctx = preview.getContext('2d');

const input = { left: false, right: false, jump: false, fire: false };
let state = createGame();
loadLevel(state, 0);
let started = false;
let screen = 'menu';
let head = null; // { img, dir }
let photo = null; // last uploaded { cut, dir }, kept in memory for the sliders and style only
let faceStyle = 'cartoon'; // style for the next upload
const NAME_KEY = 'chertogon.name';
const LANG_KEY = 'chertogon.lang';
const MUTE_KEY = 'chertogon.mute';
let name = '';
let statusKey = 'statusIdle';

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyX: 'fire', KeyJ: 'fire', KeyF: 'fire',
};

function resize() {
  const k = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = VIEW_W * k;
  canvas.height = VIEW_H * k;
}

function releaseAll() {
  for (const k in input) input[k] = false;
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
  if (k) {
    input[k] = true;
    e.preventDefault();
  }
  if (e.code === 'Enter') advance();
  if (e.code === 'Escape') showMenu();
  if (e.code === 'KeyM') toggleSound();
});
addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k) input[k] = false;
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

$('play').addEventListener('click', () => startGame(true));
$('continue').addEventListener('click', () => startGame(false));
$('retry').addEventListener('click', () => respawn(state));
$('restart').addEventListener('click', () => startGame(true));

function setName(value) {
  name = value.trim() || t('defaultName');
  $('name').placeholder = t('defaultName');
  document.title = t('title');
}

const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: setting lives until reload
  }
};

function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-lang]')) el.setAttribute('aria-pressed', String(el.dataset.lang === getLang()));
  setStatus(statusKey);
  setName($('name').value);
}

function toggleSound() {
  setMuted(!isMuted());
  $('sound').textContent = isMuted() ? '🔇' : '🔊';
  $('sound').setAttribute('aria-pressed', String(!isMuted()));
  store(MUTE_KEY, isMuted() ? '1' : '');
}
$('sound').addEventListener('click', toggleSound);

for (const el of document.querySelectorAll('[data-lang]')) {
  el.addEventListener('click', () => {
    applyLang(el.dataset.lang);
    store(LANG_KEY, getLang());
  });
}

$('name').addEventListener('input', (e) => {
  setName(e.target.value);
  store(NAME_KEY, e.target.value.trim());
});

function setStatus(key) {
  statusKey = key;
  $('status').textContent = t(key);
}

function busy(on) {
  for (const id of ['play', 'continue', 'reset']) $(id).disabled = on;
  $('photo').disabled = on;
}

const sliders = () => ({ zoom: +$('zoom').value, dx: +$('dx').value, dy: +$('dy').value });
const buildHead = () => ({ img: stylizeHead(frameHead(photo.cut, sliders()), faceStyle), dir: photo.dir, style: faceStyle });

function showStyle() {
  for (const b of document.querySelectorAll('[data-style]')) b.setAttribute('aria-pressed', String(b.dataset.style === faceStyle));
}

for (const b of document.querySelectorAll('[data-style]')) {
  b.addEventListener('click', () => {
    faceStyle = b.dataset.style;
    showStyle();
    if (!photo) return;
    head = buildHead();
    saveHead(head);
  });
}

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  busy(true);
  setStatus('statusSearching');
  try {
    const img = await loadImage(file);
    let face = null;
    try {
      face = await detectFace(img);
    } catch (err) {
      console.warn('face detection unavailable', err);
    }
    const { cut, segmented, dir } = await cutHead(img, face || fallbackEyes(img));
    photo = { cut, dir };
    for (const [id, v] of [['zoom', 1], ['dx', 0], ['dy', 0]]) $(id).value = v;
    head = buildHead();
    saveHead(head);
    $('adjust').hidden = false;
    if (!segmented) setStatus('statusOval');
    else if (!face) setStatus('statusNoFace');
    else setStatus('statusDone');
  } catch (err) {
    console.error(err);
    setStatus('statusBadPhoto');
  } finally {
    busy(false);
  }
});

for (const id of ['zoom', 'dx', 'dy']) {
  $(id).addEventListener('input', () => {
    if (photo) head = buildHead();
  });
  $(id).addEventListener('change', () => {
    if (photo) saveHead(head);
  });
}

$('reset').addEventListener('click', async () => {
  clearHead();
  photo = null;
  $('adjust').hidden = true;
  head = await loadHead();
  setStatus('statusReset');
});

function frame(now) {
  const dt = (now - (frame.last ?? now)) / 1000;
  frame.last = now;
  if (screen === 'game') step(state, input, dt);
  for (const e of state.events) play(e);
  state.events.length = 0;
  const cue = screen === 'game' ? musicCue(state) : { track: 'bg', volume: 1 };
  setMusic(cue.track, cue.volume);
  const k = canvas.width / VIEW_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawGame(ctx, state, head, name);

  const deadShown = screen === 'game' && state.mode === 'dead' && state.deadT > 0.8;
  if (deadShown === $('death').hidden) {
    $('death').hidden = !deadShown;
    if (deadShown) {
      $('death-title').textContent = t('deathTitle', { name });
      $('death-cause').textContent = t(state.deathCause === 'pit' ? 'deathPit' : 'deathHp');
    }
  }

  if (screen === 'menu') {
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.setTransform(3.6, 0, 0, 3.6, 0, 0);
    drawCharacter(pctx, 30, 48, 1, now * 0.2, head, { moving: true });
  }
  requestAnimationFrame(frame);
}

window.__game = () => state; // debug handle for manual/e2e checks

let savedLang = null;
try {
  $('name').value = localStorage.getItem(NAME_KEY) || '';
  savedLang = localStorage.getItem(LANG_KEY);
  if (localStorage.getItem(MUTE_KEY)) toggleSound();
} catch {
  // storage blocked: defaults
}
applyLang(savedLang || (navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'));
resize();
loadSprites();
loadHead().then((h) => { head = h; }).catch((e) => console.error('no head image', e));
requestAnimationFrame(frame);
