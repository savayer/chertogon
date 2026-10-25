import { TILE, VIEW_W, VIEW_H, POPUP_LIFE } from './game.js';
import { HEAD_W, HEAD_H, CHIN_Y } from './face-math.js';
import { t } from './i18n.js';
import { drawSprite, heroFrame, heroChin, itemFrame, demonFrame, bossFrame, artImage, BACKDROP_ART } from './sprites.js';

export const HEAD_SCALE = 0.3; // head image px -> world px
const INK = '#111';

const BUFF_LABELS = {
  lighter: 'buffLighter',
  vape: 'buffVape',
  beer: 'buffBeer',
  whiskey: 'buffWhiskey',
};

export const BACKDROPS = {
  street: { sky: ['#ffb37a', '#7b5ea7'], far: '#4a3b6b', near: '#2e2445', window: '#ffd54f' },
  garages: { sky: ['#b0bec5', '#455a64'], far: '#546e7a', near: '#37474f', window: '#ff8a65' },
  hell: { sky: ['#ff5722', '#2b0000'], far: '#5d0f0f', near: '#260404', window: '#ffab00' },
};

// Deterministic pseudo-random for background silhouettes.
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function fillStroke(ctx, fill, stroke = INK, lw = 2) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// The 3D view's camera. The 2D view scrolls and sizes the backdrop layers the way it would see them.
export const CAMERA_FOV = 30;
export const CAMERA_DIST = VIEW_H / 2 / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180); // shows about VIEW_W x VIEW_H at z=0
const toned = new Map(); // src|color|amount -> canvas

// Copies of a w px wide picture covering 0..width scrolled by scroll px; every other copy is mirrored, so they
// meet without a seam.
export function mirroredTiles(scroll, w, width) {
  const tiles = [];
  for (let i = Math.floor(scroll / w); i * w - scroll < width; i++) tiles.push({ x: i * w - scroll, flip: Math.abs(i % 2) === 1 });
  return tiles;
}

// A copy of a loaded picture with color painted over its opaque pixels: the haze over the backdrop layers, black
// to darken the sky. Shared with the 3D view.
export function paintOver(img, color, amount) {
  const key = `${img.src}|${color}|${amount}`;
  if (!toned.has(key)) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = amount;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    toned.set(key, c);
  }
  return toned.get(key);
}

// The level's ChatGPT backdrop (see BACKDROP_ART); false until its pictures have loaded or if it has none.
function drawArt(ctx, bg, camX) {
  const look = BACKDROP_ART[bg];
  const sky = look && artImage(look.sky);
  const layers = look?.layers.map((l) => [l, artImage(l.src)]);
  if (!sky || layers.some(([, img]) => !img)) return false;
  const k = Math.max(VIEW_W / sky.width, VIEW_H / sky.height); // cover the view, cropping the picture's edges
  ctx.drawImage(paintOver(sky, '#000', look.skyDim), (VIEW_W - sky.width * k) / 2, (VIEW_H - sky.height * k) / 2, sky.width * k, sky.height * k);
  for (const [l, img] of layers) {
    const s = CAMERA_DIST / (CAMERA_DIST - l.z); // a layer this deep looks and scrolls this much smaller
    const h = l.h * s;
    const w = (h * img.width) / img.height;
    const pic = paintOver(img, look.haze, l.haze);
    for (const t of mirroredTiles(camX * s, w, VIEW_W)) {
      ctx.save();
      ctx.translate(t.x + (t.flip ? w : 0), VIEW_H - 64 - h);
      if (t.flip) ctx.scale(-1, 1);
      ctx.drawImage(pic, 0, 0, w, h);
      ctx.restore();
    }
  }
  return true;
}

function drawBackground(ctx, bg, camX, time) {
  if (drawArt(ctx, bg, camX)) return;
  const b = BACKDROPS[bg] || BACKDROPS.street;
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, b.sky[0]);
  grad.addColorStop(1, b.sky[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const layers = [[0.15, b.far, 180, 90], [0.4, b.near, 120, 60]];
  for (const [speed, color, base, spread] of layers) {
    const off = camX * speed;
    const w = 90;
    const first = Math.floor(off / w);
    for (let i = first; i < first + VIEW_W / w + 2; i++) {
      const h = base + hash(i + speed * 100) * spread * 2;
      const x = i * w - off;
      const y = VIEW_H - 64 - h;
      ctx.fillStyle = color;
      if (bg === 'hell') {
        ctx.beginPath();
        ctx.moveTo(x, VIEW_H);
        ctx.lineTo(x + w / 2, y);
        ctx.lineTo(x + w, VIEW_H);
        ctx.fill();
        continue;
      }
      ctx.fillRect(x, y, w - 6, h + 64);
      if (bg === 'garages' && speed > 0.3) {
        ctx.fillStyle = '#263238';
        ctx.fillRect(x + 12, VIEW_H - 64 - 50, w - 30, 50);
        continue;
      }
      // Lit pattern keyed to the building, not the screen, so windows don't flicker while scrolling.
      ctx.fillStyle = b.window;
      ctx.globalAlpha = speed > 0.3 ? 0.45 : 0.3;
      for (let row = 0, wy = y + 12; wy < VIEW_H - 80; row++, wy += 22) {
        for (let col = 0, wx = x + 10; wx < x + w - 16; col++, wx += 18) {
          if (hash(i * 97 + row * 13 + col + speed * 1000) > 0.55) ctx.fillRect(wx, wy, 8, 10);
        }
      }
      ctx.globalAlpha = 1;
    }
  }
  if (bg === 'hell') {
    ctx.fillStyle = '#ffab00';
    for (let i = 0; i < 30; i++) {
      const x = (hash(i) * VIEW_W * 2 - camX * 0.3) % VIEW_W;
      const y = VIEW_H - ((time * 40 * (0.5 + hash(i + 9)) + hash(i + 3) * VIEW_H) % VIEW_H);
      ctx.fillRect((x + VIEW_W) % VIEW_W, y, 3, 3);
    }
  }
}

// The street's tiles, shared with the 3D view, 2 px per world px: rubble and rusty gravel under an asphalt edge;
// in hell charred bricks with embers in the joints, dark so the red demons stand out on them.
const streetTiles = {};
export function streetTile(hell) {
  const key = hell ? 'hell' : 'street';
  if (!streetTiles[key]) {
    const c = document.createElement('canvas');
    c.width = c.height = 2 * TILE;
    const g = c.getContext('2d');
    if (hell) {
      g.fillStyle = '#1c1617'; // joints
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#3a3134';
      for (const [x, y] of [[2, 2], [34, 2], [-14, 34], [18, 34], [50, 34]]) g.fillRect(x, y, 28, 28);
      for (let i = 0; i < 120; i++) {
        g.fillStyle = hash(i) < 0.5 ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.05)';
        g.fillRect(hash(i + 1) * 64, hash(i + 2) * 64, 2, 2);
      }
      g.fillStyle = '#ff6a1a'; // embers
      for (const [x, y, w, h] of [[31, 8, 2, 6], [14, 31, 6, 2], [47, 44, 2, 5], [56, 31, 4, 2]]) g.fillRect(x, y, w, h);
    } else {
      g.fillStyle = '#4a352f';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 180; i++) {
        g.fillStyle = ['#5e4a42', '#3a2824', '#7a5038', '#6a625e'][Math.floor(hash(i) * 4)];
        g.fillRect(hash(i + 1) * 64, hash(i + 2) * 64, 2 + hash(i + 3) * 4, 2 + hash(i + 4) * 3);
      }
      g.fillStyle = '#5a5458'; // the asphalt's edge
      g.fillRect(0, 0, 64, 6);
      g.fillStyle = 'rgba(0, 0, 0, 0.4)';
      g.fillRect(0, 6, 64, 2);
    }
    streetTiles[key] = c;
  }
  return streetTiles[key];
}

// A platform's front, 2 px per world px (32 x 14): light concrete with an ink outline, so it stands out against the
// backdrop as the old 2D planks did; ash-grey in hell. Shared with the 3D view.
const slabTiles = {};
export function slabTile(hell) {
  const key = hell ? 'hell' : 'street';
  if (!slabTiles[key]) {
    const c = document.createElement('canvas');
    c.width = 2 * TILE;
    c.height = 28;
    const g = c.getContext('2d');
    const [base, light, dark] = hell ? ['#a8958c', '#c8b8ae', '#6e5e58'] : ['#c2b8ac', '#e2dacd', '#857c72'];
    g.fillStyle = base;
    g.fillRect(0, 0, 64, 28);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = hash(i + 200) < 0.5 ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';
      g.fillRect(hash(i + 201) * 64, 4 + hash(i + 202) * 16, 2, 2);
    }
    g.fillStyle = light;
    g.fillRect(0, 2, 64, 3);
    g.fillStyle = dark;
    g.fillRect(0, 19, 64, 5);
    g.fillRect(0, 2, 2, 22); // the joint with the next slab
    g.fillStyle = INK;
    g.fillRect(0, 0, 64, 2);
    g.fillRect(0, 24, 64, 4);
    slabTiles[key] = c;
  }
  return slabTiles[key];
}

function drawTiles(ctx, state) {
  const { level, camX } = state;
  const hell = state.levels[state.levelIndex].bg === 'hell';
  const pattern = ctx.createPattern(streetTile(hell), 'repeat');
  pattern.setTransform(new DOMMatrix().scale(0.5));
  const topColor = hell ? '#2b2426' : '#4e4250'; // asphalt (charcoal in hell) as the 3D view lights it
  const c0 = Math.max(0, Math.floor(camX / TILE));
  const c1 = Math.min(level.cols - 1, Math.ceil((camX + VIEW_W) / TILE));
  for (let r = 0; r < level.rows; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = level.tiles[r * level.cols + c];
      if (!t) continue;
      const x = c * TILE;
      const y = r * TILE;
      if (t === 2) {
        ctx.drawImage(slabTile(hell), x, y, TILE, 14);
        continue;
      }
      ctx.fillStyle = pattern;
      ctx.fillRect(x, y, TILE, TILE);
      if (r === 0 || !level.tiles[(r - 1) * level.cols + c]) {
        ctx.fillStyle = topColor;
        ctx.fillRect(x, y, TILE, 8);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(x, y + 8, TILE, 2);
        if (hash(c * 13.7 + 1) < 0.22) {
          // a chipped kerb where the 3D view puts broken paving or a pothole
          ctx.fillStyle = '#1c181d';
          ctx.fillRect(x + 6 + hash(c * 13.7 + 3) * 14, y, 8, 4);
          ctx.fillRect(x + 8 + hash(c * 13.7 + 3) * 14, y + 4, 4, 2);
        }
      }
    }
  }
}

// Hero pose flags for drawCharacter / heroFrame.
export function heroOpts(state) {
  const p = state.player;
  const dead = state.mode === 'dead';
  return {
    moving: !dead && p.onGround && p.vx !== 0,
    airborne: !dead && !p.onGround,
    rising: p.vy < 0,
    hurt: !dead && p.knock > 0,
    throwing: !dead && p.fireCd > 0.1,
    lying: dead ? Math.min(1, state.deadT / 0.35) : 0,
  };
}

// The default head also has hurt and dead faces; uploaded heads have one.
export const headFor = (head, opts) => (opts.lying && head.dead) || (opts.hurt && head.hurt) || head.img;

// x,y = top-left of the 28x56 hitbox. Head chin sits on the collar.
// head = { img, dir }: dir -1 means the photo looks left, so it is mirrored to look where the body goes.
// opts.lying 0..1 tips the body over backwards around the feet.
export function drawCharacter(ctx, x, y, facing, walk, head, opts = {}) {
  const frame = heroFrame(opts, walk);
  ctx.save();
  ctx.translate(x + 14, y + 56); // feet: bottom middle of the 28x56 hitbox
  if (opts.lying) {
    ctx.translate(0, -14 * opts.lying);
    ctx.rotate(-facing * (Math.PI / 2) * opts.lying);
  }
  ctx.scale(facing < 0 ? -1 : 1, 1);
  drawSprite(ctx, 'hero', frame);
  if (head?.img) {
    ctx.translate(...heroChin(frame));
    if (head.dir < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = head.style !== 'pixel';
    ctx.drawImage(headFor(head, opts), (-HEAD_W * HEAD_SCALE) / 2, -CHIN_Y * HEAD_SCALE, HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE);
  }
  ctx.restore();
}

function drawDemon(ctx, e, time) {
  const dir = e.hold ? e.aim : e.vx > 0 ? 1 : -1;
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h);
  ctx.scale(dir, 1);
  drawSprite(ctx, e.shooter ? 'fire-imp' : 'imp', demonFrame(e, time));
  ctx.restore();
}

// The bat's anchor is its eyes; they sit ahead of the body's center, so it faces the player.
function drawFlyer(ctx, e, time, playerX) {
  const dir = playerX < e.x + e.w / 2 ? -1 : 1;
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  ctx.scale(dir, 1);
  ctx.translate(6, 0);
  drawSprite(ctx, 'bat', Math.floor(time * 12 + e.phase) % 4);
  ctx.restore();
}

function drawBoss(ctx, b, index, time) {
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  ctx.scale(b.facing, 1);
  drawSprite(ctx, `boss${index}`, bossFrame(b, index, time));
  ctx.restore();
}

function drawPickup(ctx, k, time) {
  const y = k.y + Math.sin(time * 4 + k.x) * 3;
  ctx.save();
  ctx.translate(k.x + k.w / 2, y + k.h / 2);
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#fff59d';
  ctx.fill();
  ctx.globalAlpha = 1;
  drawSprite(ctx, 'items', itemFrame(k.kind));
  ctx.restore();
}

function drawShots(ctx, state) {
  for (const s of state.shots) {
    if (s.pierce) {
      ctx.beginPath();
      ctx.arc(s.x + s.w / 2, s.y + s.h / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6d00';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x + s.w / 2, s.y + s.h / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffee58';
      ctx.fill();
      continue;
    }
    const head = s.vx > 0 ? s.x + s.w : s.x;
    ctx.fillStyle = '#ffcc80';
    ctx.fillRect(s.x, s.y + 2, s.w, 2);
    ctx.beginPath();
    ctx.arc(head, s.y + 3, 4 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff9100';
    ctx.fill();
  }
  for (const s of state.enemyShots) {
    ctx.beginPath();
    ctx.arc(s.x + s.w / 2, s.y + s.h / 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = s.flame ? '#ff6d00' : '#d500f9';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x + s.w / 2, s.y + s.h / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = s.flame ? '#ffeb3b' : '#fff';
    ctx.fill();
  }
}

function drawCheckpoints(ctx, state) {
  for (const c of state.level.checkpoints) {
    const x = c.col * TILE + TILE / 2;
    const y = (c.row + 1) * TILE;
    const on = state.checkpoint && state.checkpoint.col >= c.col;
    ctx.fillStyle = '#424242';
    ctx.fillRect(x - 2, y - 64, 4, 64);
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 64);
    ctx.lineTo(x + 30, y - 54);
    ctx.lineTo(x + 2, y - 44);
    fillStroke(ctx, on ? '#43a047' : '#9e9e9e', INK, 1.5);
  }
}

function heart(ctx, x, y, full) {
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.bezierCurveTo(x, y, x - 8, y - 2, x - 8, y + 4);
  ctx.bezierCurveTo(x - 8, y + 9, x, y + 13, x, y + 16);
  ctx.bezierCurveTo(x, y + 13, x + 8, y + 9, x + 8, y + 4);
  ctx.bezierCurveTo(x + 8, y - 2, x, y, x, y + 4);
  fillStroke(ctx, full ? '#e53935' : 'rgba(0,0,0,0.35)', INK, 2);
}

function label(ctx, text, x, y, size = 18, align = 'left', color = '#fff') {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round'; // miter joins spike on sharp glyphs like M
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// Pickup popups: the icon and what it gave pop up over the head, then fly to the HUD line they changed,
// which pulses when they land.
const POP_HOLD = 0.55; // s over the head
const POP_FLY = 0.55; // s on the way to the HUD; the rest of POPUP_LIFE is the HUD pulse
const POP_TEXT = { m: 'gainMatches', l: 'gainLighter', c: 'gainCig', v: 'gainVape', h: 'gainHookah', b: 'gainBeer', w: 'gainWhiskey' };
const POP_LINE = { m: 'ammo', l: 'buffs' }; // everything else heals: hearts
const HUD_Y = { hearts: 20, ammo: 50, buffs: 74 }; // middle of each HUD line

const popLine = (kind) => POP_LINE[kind] ?? 'hearts';
const smooth = (f) => f * f * (3 - 2 * f);

// 0..1..0 while a popup that landed on this HUD line pulses it
function hudPulse(state, line) {
  let k = 0;
  for (const q of state.popups) {
    const f = (q.t - POP_HOLD - POP_FLY) / (POPUP_LIFE - POP_HOLD - POP_FLY);
    if (popLine(q.kind) === line && f > 0) k = Math.max(k, Math.sin(Math.PI * Math.min(1, f)));
  }
  return k;
}

// Scales what draw() paints around the start of a HUD line.
function pulsing(ctx, state, line, draw) {
  const s = 1 + 0.35 * hudPulse(state, line);
  ctx.save();
  ctx.translate(14, HUD_Y[line]);
  ctx.scale(s, s);
  ctx.translate(-14, -HUD_Y[line]);
  draw();
  ctx.restore();
}

// anchor: screen point over the top middle of the player's hitbox
function drawPopups(ctx, state, anchor) {
  const p = state.player;
  for (const q of state.popups) {
    if (q.t >= POP_HOLD + POP_FLY) continue;
    let x = anchor.x;
    let y = anchor.y - 84 - Math.min(q.t, POP_HOLD) * 20;
    let k = Math.min(1, q.t / 0.12);
    if (q.t > POP_HOLD) {
      const f = smooth((q.t - POP_HOLD) / POP_FLY);
      const tx = popLine(q.kind) === 'hearts' ? 24 + Math.max(0, p.hp - 1) * 22 : 60;
      x += (tx - x) * f;
      y += (HUD_Y[popLine(q.kind)] - y) * f;
      k = 1 - 0.5 * f;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    drawSprite(ctx, 'items', itemFrame(q.kind));
    label(ctx, t(POP_TEXT[q.kind]), 0, -22, 16, 'center', '#ffe082');
    ctx.restore();
  }
}

function drawHud(ctx, state) {
  const p = state.player;
  pulsing(ctx, state, 'hearts', () => {
    for (let i = 0; i < p.maxHp; i++) heart(ctx, 24 + i * 22, 12, i < p.hp);
  });
  const ammo = p.buffs.lighter > 0 ? '∞' : String(p.ammo);
  pulsing(ctx, state, 'ammo', () => label(ctx, t('matches', { n: ammo }), 14, 56));
  pulsing(ctx, state, 'buffs', () => {
    let y = 80;
    for (const [k, key] of Object.entries(BUFF_LABELS)) {
      if (p.buffs[k] > 0) {
        label(ctx, `${t(key)}: ${t('seconds', { n: Math.ceil(p.buffs[k]) })}`, 14, y, 15, 'left', '#ffe082');
        y += 20;
      }
    }
  });
  const lvl = state.levels[state.levelIndex];
  const levelName = t(`level${state.levelIndex}`);
  label(ctx, t('levelLabel', { n: state.levelIndex + 1, level: levelName }), VIEW_W - 14, 28, 18, 'right');
  const b = state.boss;
  if (b && b.active) {
    const w = 360;
    const x = (VIEW_W - w) / 2;
    label(ctx, t(`boss${lvl.boss ?? 0}`), VIEW_W / 2, 24, 18, 'center', '#ff8a80');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, 32, w, 12);
    ctx.fillStyle = '#d50000';
    ctx.fillRect(x, 32, (w * Math.max(0, b.hp)) / b.maxHp, 12);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, 32, w, 12);
  }
}

function drawBanner(ctx, title, sub) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, VIEW_H / 2 - 80, VIEW_W, 150);
  label(ctx, title, VIEW_W / 2, VIEW_H / 2 - 18, 40, 'center', '#ffeb3b');
  label(ctx, sub, VIEW_W / 2, VIEW_H / 2 + 30, 20, 'center');
}

export function drawGame(ctx, state, head, name) {
  const p = state.player;
  const lvl = state.levels[state.levelIndex];
  ctx.save();
  if (p.buffs.whiskey > 0) {
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.rotate(Math.sin(state.time * 2.5) * 0.035);
    ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
  }
  drawBackground(ctx, lvl.bg, state.camX, state.time);
  ctx.save();
  ctx.translate(-Math.round(state.camX), VIEW_H - state.level.rows * TILE);
  drawTiles(ctx, state);
  drawCheckpoints(ctx, state);
  for (const k of state.pickups) drawPickup(ctx, k, state.time);
  for (const e of state.enemies) {
    if (e.type === 'flyer') drawFlyer(ctx, e, state.time, p.x + p.w / 2);
    else drawDemon(ctx, e, state.time);
  }
  if (state.boss) drawBoss(ctx, state.boss, lvl.boss ?? 0, state.time);
  drawShots(ctx, state);

  const dead = state.mode === 'dead';
  if (!dead && p.buffs.whiskey > 0) {
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, p.y, 40, 60, 0, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${(state.time * 300) % 360}, 90%, 60%, 0.3)`;
    ctx.fill();
  }
  // whole px like the camera, or the hero wobbles by a fraction of a pixel while it follows him
  drawCharacter(ctx, Math.round(p.x), p.y, p.facing, p.walk, head, heroOpts(state));
  if (dead && state.deathCause === 'hp' && head?.img && state.deadT > 0.3) {
    // the soul leaves the body
    const t = state.deadT - 0.3;
    ctx.globalAlpha = Math.max(0, 0.6 - t * 0.35);
    const w = HEAD_W * HEAD_SCALE;
    ctx.drawImage(head.img, p.x + p.w / 2 - w / 2, p.y - 50 - t * 50 + Math.sin(t * 4) * 4, w, HEAD_H * HEAD_SCALE);
    ctx.globalAlpha = 1;
  }
  for (const q of state.particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();

  drawOverlay(ctx, state, name, { x: p.x + p.w / 2 - Math.round(state.camX), y: p.y + VIEW_H - state.level.rows * TILE });
}

// Everything drawn in screen space over the world: HUD, pickup popups, the death tint and banners.
// anchor: where the top middle of the player's hitbox is on screen.
export function drawOverlay(ctx, state, name, anchor) {
  drawHud(ctx, state);
  drawPopups(ctx, state, anchor);
  if (state.mode === 'dead') {
    ctx.fillStyle = `rgba(40, 0, 0, ${Math.min(0.55, state.deadT * 0.6)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (state.mode === 'levelComplete') {
    drawBanner(ctx, t('bossDown'), t('next'));
  } else if (state.mode === 'victory') {
    drawBanner(ctx, t('victory'), t('victorySub', { name }));
  }
}
