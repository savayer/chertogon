import { TILE, VIEW_W, VIEW_H } from './game.js';
import { HEAD_W, HEAD_H, CHIN_Y } from './face-math.js';
import { t } from './i18n.js';

const HEAD_SCALE = 0.325; // head image px -> world px
const SUIT = '#2f4d40';
const SUIT_DARK = '#203a30';
const SHIRT = '#9fb8b2';
const SKIN = '#f3d9c0';
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

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
  const swing = Math.sin(walk * 0.09) * (opts.moving ? 0.6 : 0);
  const bob = opts.moving ? -Math.abs(Math.sin(walk * 0.09)) * 2 : 0;
  ctx.save();
  ctx.translate(x + 14, y + bob);
  if (opts.lying) {
    ctx.translate(0, 56 - 14 * opts.lying);
    ctx.rotate(-facing * (Math.PI / 2) * opts.lying);
    ctx.translate(0, -56);
  }
  ctx.scale(facing < 0 ? -1 : 1, 1);

  const leg = (angle, shade) => {
    ctx.save();
    ctx.translate(0, 38);
    ctx.rotate(angle);
    roundRect(ctx, -6, 0, 12, 16, 3);
    fillStroke(ctx, shade);
    roundRect(ctx, -6, 13, 15, 6, 3);
    fillStroke(ctx, '#1b1b1b');
    ctx.restore();
  };
  leg(-swing, SUIT_DARK);

  // back arm
  ctx.save();
  ctx.translate(-8, 22);
  ctx.rotate(swing * 0.8);
  roundRect(ctx, -4, 0, 8, 16, 3);
  fillStroke(ctx, SUIT_DARK);
  ctx.restore();

  leg(swing, SUIT);

  roundRect(ctx, -13, 17, 26, 26, 5);
  fillStroke(ctx, SUIT);
  ctx.fillStyle = SHIRT;
  ctx.fillRect(-4, 19, 8, 22);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-4, 19);
  ctx.lineTo(0, 30);
  ctx.lineTo(4, 19);
  ctx.stroke();

  // front arm: forward when throwing
  ctx.save();
  ctx.translate(8, 22);
  ctx.rotate(opts.throwing ? -1.4 : -swing * 0.8);
  roundRect(ctx, -4, 0, 8, 16, 3);
  fillStroke(ctx, SUIT);
  ctx.beginPath();
  ctx.arc(0, 18, 5, 0, Math.PI * 2);
  fillStroke(ctx, SKIN);
  ctx.restore();

  if (head?.img) {
    if (head.dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(head.img, (-HEAD_W * HEAD_SCALE) / 2, 22 - CHIN_Y * HEAD_SCALE, HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE);
  }
  ctx.restore();
}

function drawDemon(ctx, e, time) {
  const dir = e.hold ? e.aim : e.vx > 0 ? 1 : -1;
  const step = Math.sin(time * 12 + e.x * 0.1) * 3;
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#7f0000';
  ctx.fillRect(-10, 24 + step * 0.3, 6, 8);
  ctx.fillRect(4, 24 - step * 0.3, 6, 8);
  ctx.beginPath();
  ctx.moveTo(-12, 18);
  ctx.quadraticCurveTo(-26, 14, -22, 4);
  ctx.strokeStyle = '#b71c1c';
  ctx.lineWidth = 3;
  ctx.stroke();
  roundRect(ctx, -14, 4, 28, 24, 10);
  fillStroke(ctx, e.shooter ? '#ef6c00' : '#d32f2f');
  hornsAndFace(ctx, 0, 4, 1);
  if (e.shooter && e.hold && e.shootT < 0.45) {
    // wind-up glow so the player sees the flame coming
    ctx.beginPath();
    ctx.arc(8, 21, 3 + (0.45 - e.shootT) * 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 213, 79, 0.85)';
    ctx.fill();
  }
  ctx.restore();
}

function hornsAndFace(ctx, x, y, k) {
  ctx.fillStyle = '#fff8e1';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * 6 * k, y + 2 * k);
    ctx.lineTo(x + s * 12 * k, y - 10 * k);
    ctx.lineTo(x + s * 12 * k, y + 4 * k);
    ctx.closePath();
    fillStroke(ctx, '#fff8e1', INK, 1.5);
    ctx.beginPath();
    ctx.arc(x + s * 5 * k + 2 * k, y + 10 * k, 3.5 * k, 0, Math.PI * 2);
    fillStroke(ctx, '#ffeb3b', INK, 1);
    ctx.fillStyle = INK;
    ctx.fillRect(x + s * 5 * k + 2 * k - 1 * k, y + 9 * k, 2 * k, 3 * k);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2 * Math.min(k, 2);
  ctx.beginPath();
  ctx.moveTo(x - 1 * k, y + 5 * k);
  ctx.lineTo(x + 9 * k, y + 7 * k);
  ctx.moveTo(x + 1 * k, y + 5 * k);
  ctx.lineTo(x - 7 * k, y + 7 * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 4 * k, y + 17 * k);
  ctx.lineTo(x + 6 * k, y + 17 * k);
  ctx.stroke();
}

function drawFlyer(ctx, e, time) {
  const flap = Math.sin(time * 20 + e.phase) * 8;
  ctx.save();
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  ctx.fillStyle = '#4a148c';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 8, -2);
    ctx.lineTo(s * 26, -10 - flap);
    ctx.lineTo(s * 20, 4);
    ctx.lineTo(s * 14, 0);
    ctx.lineTo(s * 8, 8);
    ctx.closePath();
    fillStroke(ctx, '#6a1b9a', INK, 1.5);
  }
  ctx.beginPath();
  ctx.ellipse(0, 2, 12, 12, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#8e24aa');
  hornsAndFace(ctx, 0, -8, 0.8);
  ctx.restore();
}

function drawBoss(ctx, b, time) {
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y);
  ctx.scale(b.facing, 1);
  const color = b.hurt > 0 && Math.floor(time * 30) % 2 ? '#ffffff' : b.color;
  const step = b.onGround && b.vx ? Math.sin(time * 10) * 6 : 0;
  ctx.fillStyle = INK;
  ctx.fillRect(-32, 74 + step * 0.3, 20, 22);
  ctx.fillRect(12, 74 - step * 0.3, 20, 22);
  ctx.beginPath();
  ctx.moveTo(-40, 60);
  ctx.quadraticCurveTo(-80, 50, -66, 20);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  roundRect(ctx, -44, 14, 88, 66, 26);
  fillStroke(ctx, color, INK, 3);
  hornsAndFace(ctx, 0, 14, 3);
  ctx.restore();
}

function drawPickup(ctx, k, time) {
  const y = k.y + Math.sin(time * 4 + k.x) * 3;
  const cx = k.x + k.w / 2;
  ctx.save();
  ctx.translate(cx, y + k.h / 2);
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#fff59d';
  ctx.fill();
  ctx.globalAlpha = 1;
  switch (k.kind) {
    case 'm': // matchbox
      ctx.fillStyle = '#ffcc80';
      ctx.fillRect(-4, -14, 2, 10);
      ctx.fillRect(2, -16, 2, 12);
      ctx.fillStyle = '#d50000';
      ctx.fillRect(-5, -16, 4, 4);
      ctx.fillRect(1, -18, 4, 4);
      roundRect(ctx, -11, -6, 22, 16, 2);
      fillStroke(ctx, '#c62828');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('matchbox'), 0, 4, 20);
      break;
    case 'l': // lighter
      roundRect(ctx, -7, -6, 14, 20, 3);
      fillStroke(ctx, '#1e88e5');
      roundRect(ctx, -7, -12, 14, 7, 2);
      fillStroke(ctx, '#bdbdbd');
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(6, -16, 0, -13);
      ctx.quadraticCurveTo(-6, -16, 0, -24);
      fillStroke(ctx, '#ffab00', '#e65100', 1);
      break;
    case 'c': // cigarette
      ctx.rotate(-0.5);
      roundRect(ctx, -14, -3, 28, 7, 2);
      fillStroke(ctx, '#fafafa');
      ctx.fillStyle = '#ef9a3c';
      ctx.fillRect(6, -2, 7, 5);
      ctx.fillStyle = '#ff3d00';
      ctx.fillRect(-14, -2, 3, 5);
      ctx.strokeStyle = 'rgba(220,220,220,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, -4);
      ctx.quadraticCurveTo(-22, -12, -16, -18);
      ctx.stroke();
      break;
    case 'v': // vape (the green one from the concept video)
      roundRect(ctx, -5, -10, 10, 26, 3);
      fillStroke(ctx, '#7cc242');
      roundRect(ctx, -5, -16, 10, 7, 3);
      fillStroke(ctx, '#212121');
      ctx.fillStyle = '#dcedc8';
      ctx.fillRect(-1, -6, 2, 16);
      break;
    case 'h': // hookah
      ctx.beginPath();
      ctx.ellipse(0, 10, 9, 7, 0, 0, Math.PI * 2);
      fillStroke(ctx, '#26c6da');
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(-2, -12, 4, 16);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-2, -12, 4, 16);
      roundRect(ctx, -6, -18, 12, 6, 2);
      fillStroke(ctx, '#ff7043');
      ctx.strokeStyle = '#6d4c41';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(18, 0, 14, 16);
      ctx.stroke();
      break;
    case 'b': // beer mug
      roundRect(ctx, -9, -8, 16, 22, 3);
      fillStroke(ctx, '#ffb300');
      ctx.beginPath();
      ctx.arc(7, 3, 5, -Math.PI / 2, Math.PI / 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-1, -9, 10, 5, 0, 0, Math.PI * 2);
      fillStroke(ctx, '#fffde7', INK, 1.5);
      break;
    case 'w': // whiskey glass
      roundRect(ctx, -10, -6, 20, 18, 2);
      fillStroke(ctx, 'rgba(225,245,254,0.7)');
      ctx.fillStyle = '#e65100';
      ctx.fillRect(-8, 2, 16, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-4, -1, 7, 6);
      break;
  }
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
  for (const e of state.enemies) (e.type === 'flyer' ? drawFlyer : drawDemon)(ctx, e, state.time);
  if (state.boss) drawBoss(ctx, state.boss, state.time);
  drawShots(ctx, state);

  const dead = state.mode === 'dead';
  const blink = !dead && p.invuln > 0 && Math.floor(state.time * 12) % 2;
  if (!blink) {
    if (!dead && p.buffs.whiskey > 0) {
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, p.y + 10, 40, 56, 0, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${(state.time * 300) % 360}, 90%, 60%, 0.3)`;
      ctx.fill();
    }
    drawCharacter(ctx, p.x, p.y, p.facing, p.walk, head, {
      moving: !dead && p.onGround && p.vx !== 0,
      throwing: !dead && p.fireCd > 0.1,
      lying: dead ? Math.min(1, state.deadT / 0.35) : 0,
    });
  }
  if (dead && state.deathCause === 'hp' && head?.img && state.deadT > 0.3) {
    // the soul leaves the body
    const t = state.deadT - 0.3;
    ctx.globalAlpha = Math.max(0, 0.6 - t * 0.35);
    const w = HEAD_W * HEAD_SCALE;
    ctx.drawImage(head.img, p.x + p.w / 2 - w / 2, p.y - 40 - t * 50 + Math.sin(t * 4) * 4, w, HEAD_H * HEAD_SCALE);
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
