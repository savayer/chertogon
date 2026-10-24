import { TILE, VIEW_W, VIEW_H } from './game.js';
import { HEAD_W, HEAD_H, CHIN_Y } from './face-math.js';
import { t } from './i18n.js';
import { drawSprite, heroFrame, heroChin, itemFrame } from './sprites.js';

const HEAD_SCALE = 0.3; // head image px -> world px
const INK = '#111';

const BUFF_LABELS = {
  lighter: 'buffLighter',
  vape: 'buffVape',
  beer: 'buffBeer',
  whiskey: 'buffWhiskey',
};

const BACKDROPS = {
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

function drawBackground(ctx, bg, camX, time) {
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

function drawTiles(ctx, state) {
  const { level, camX } = state;
  const c0 = Math.max(0, Math.floor(camX / TILE));
  const c1 = Math.min(level.cols - 1, Math.ceil((camX + VIEW_W) / TILE));
  for (let r = 0; r < level.rows; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = level.tiles[r * level.cols + c];
      if (!t) continue;
      const x = c * TILE;
      const y = r * TILE;
      if (t === 2) {
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(x, y, TILE, 14);
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(x, y + 10, TILE, 4);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE - 2, 12);
        continue;
      }
      const top = r === 0 || !level.tiles[(r - 1) * level.cols + c];
      ctx.fillStyle = state.levels[state.levelIndex].bg === 'hell' ? '#5d4037' : '#d7ccc8';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = '#4e4a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, TILE / 2 - 2, TILE / 2 - 2);
      ctx.strokeRect(x + TILE / 2 + 1, y + 1, TILE / 2 - 2, TILE / 2 - 2);
      ctx.strokeRect(x + TILE / 4 + 1, y + TILE / 2 + 1, TILE / 2 - 2, TILE / 2 - 2);
      if (top) {
        ctx.fillStyle = state.levels[state.levelIndex].bg === 'hell' ? '#ff6d00' : '#a1887f';
        ctx.fillRect(x, y, TILE, 5);
      }
    }
  }
}

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
    ctx.drawImage(head.img, (-HEAD_W * HEAD_SCALE) / 2, -CHIN_Y * HEAD_SCALE, HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE);
  }
  ctx.restore();
}

// Imp frames: 4-step walk; the fire imp has 2 walk frames and 2 spitting ones.
function drawDemon(ctx, e, time) {
  const dir = e.hold ? e.aim : e.vx > 0 ? 1 : -1;
  let frame = Math.floor(time * 8) % 4;
  if (e.shooter) {
    // mouth opens on the wind-up so the player sees the flame coming
    if (e.hold) frame = e.shootT < 0.45 ? 2 + (Math.floor(time * 10) % 2) : 0;
    else frame = Math.floor(time * 6) % 2;
  }
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h);
  ctx.scale(dir, 1);
  drawSprite(ctx, e.shooter ? 'fire-imp' : 'imp', frame);
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

// Boss frames: 0-1 walk, 2 jump, 3 hurt (boss 0, who doesn't shoot) or shooting (bosses 1 and 2).
function drawBoss(ctx, b, index, time) {
  let frame = !b.onGround ? 2 : b.vx ? Math.floor(time * 5) % 2 : 0;
  if (index === 0 ? b.hurt > 0 : b.active && b.shootEvery - b.shootT < 0.3) frame = 3;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  ctx.scale(b.facing, 1);
  if (b.hurt > 0 && Math.floor(time * 30) % 2) ctx.globalAlpha = 0.5;
  drawSprite(ctx, `boss${index}`, frame);
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

function drawHud(ctx, state) {
  const p = state.player;
  for (let i = 0; i < p.maxHp; i++) heart(ctx, 24 + i * 22, 12, i < p.hp);
  const ammo = p.buffs.lighter > 0 ? '∞' : String(p.ammo);
  label(ctx, t('matches', { n: ammo }), 14, 56);
  let y = 80;
  for (const [k, key] of Object.entries(BUFF_LABELS)) {
    if (p.buffs[k] > 0) {
      label(ctx, `${t(key)}: ${t('seconds', { n: Math.ceil(p.buffs[k]) })}`, 14, y, 15, 'left', '#ffe082');
      y += 20;
    }
  }
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
  const blink = !dead && p.invuln > 0 && Math.floor(state.time * 12) % 2;
  if (!blink) {
    if (!dead && p.buffs.whiskey > 0) {
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, p.y, 40, 60, 0, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${(state.time * 300) % 360}, 90%, 60%, 0.3)`;
      ctx.fill();
    }
    drawCharacter(ctx, p.x, p.y, p.facing, p.walk, head, {
      moving: !dead && p.onGround && p.vx !== 0,
      airborne: !dead && !p.onGround,
      rising: p.vy < 0,
      hurt: !dead && p.knock > 0,
      throwing: !dead && p.fireCd > 0.1,
      lying: dead ? Math.min(1, state.deadT / 0.35) : 0,
    });
  }
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

  drawHud(ctx, state);
  if (dead) {
    ctx.fillStyle = `rgba(40, 0, 0, ${Math.min(0.55, state.deadT * 0.6)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (state.mode === 'levelComplete') {
    drawBanner(ctx, t('bossDown'), t('next'));
  } else if (state.mode === 'victory') {
    drawBanner(ctx, t('victory'), t('victorySub', { name }));
  }
}
