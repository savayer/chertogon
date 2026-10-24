import { LEVELS } from './levels.js';

export const TILE = 32;
export const VIEW_W = 960;
export const VIEW_H = 544;

const STEP = 1 / 60;
const GRAVITY = 1800;
const MAX_FALL = 900;
const SPEED = 260;
const JUMP_V = 720;
const JUMP_CUT = 288;
const STOMP_BOUNCE = 450;
const MAX_HP_CAP = 8;
const SPIT_RANGE = 450;
const SPIT_EVERY = 2.2;

// Display names: i18n keys boss0..boss2.
export const BOSSES = [
  { hp: 10, speed: 90, jumpEvery: 2.5, shootEvery: 0, spread: 1, color: '#b3261e' },
  { hp: 16, speed: 70, jumpEvery: 4, shootEvery: 2, spread: 1, color: '#6a1b9a' },
  { hp: 24, speed: 110, jumpEvery: 2.2, shootEvery: 1.6, spread: 3, color: '#212121' },
];

const PICKUPS = 'mlcvhbw';
const BUFF_OF = { v: ['vape', 15], b: ['beer', 12], w: ['whiskey', 8], l: ['lighter', 10] };

export function parseLevel(level) {
  const rows = level.map.length;
  const cols = Math.max(...level.map.map((r) => r.length));
  const tiles = new Uint8Array(cols * rows);
  const checkpoints = [];
  const entities = [];
  let spawn = { col: 0, row: 0 };
  level.map.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '#') tiles[row * cols + col] = 1;
      else if (ch === '=') tiles[row * cols + col] = 2;
      else if (ch === 'P') spawn = { col, row };
      else if (ch === 'C') checkpoints.push({ col, row });
      else if (ch !== '.' && ch !== ' ') entities.push({ ch, col, row });
    });
  });
  return { tiles, cols, rows, spawn, checkpoints, entities };
}

// Bottom-aligned, horizontally centered in the cell.
function place(w, h, col, row) {
  return { x: col * TILE + (TILE - w) / 2, y: (row + 1) * TILE - h, w, h };
}

function newPlayer() {
  return {
    x: 0, y: 0, w: 28, h: 56, vx: 0, vy: 0, onGround: false, facing: 1,
    hp: 3, maxHp: 5, ammo: 10, invuln: 0, knock: 0, fireCd: 0, airJumps: 0, jumpHeld: false, walk: 0,
    buffs: { vape: 0, beer: 0, whiskey: 0, lighter: 0 },
  };
}

export function createGame(levels = LEVELS) {
  return {
    levels, levelIndex: 0, mode: 'playing', time: 0, acc: 0, camX: 0, deaths: 0, deadT: 0, deathCause: null,
    player: newPlayer(), level: null, checkpoint: null, prevJump: false,
    enemies: [], boss: null, shots: [], enemyShots: [], pickups: [], particles: [],
    events: [], // sound cues for the UI to drain: shoot, fire, kill, stomp, pickup-<kind>, hurt, death, spit, bossHit, bossDown, victory
  };
}

const emit = (state, name) => state.events.push(name);

export function loadLevel(state, index) {
  state.levelIndex = index;
  state.checkpoint = null;
  resetLevel(state);
}

export function nextLevel(state) {
  loadLevel(state, state.levelIndex + 1);
}

function resetLevel(state) {
  const def = state.levels[state.levelIndex];
  const lvl = parseLevel(def);
  Object.assign(state, {
    level: lvl, mode: 'playing', enemies: [], pickups: [], shots: [], enemyShots: [], boss: null, particles: [],
  });
  for (const e of lvl.entities) {
    if (e.ch === 'd') {
      state.enemies.push({ type: 'demon', ...place(32, 32, e.col, e.row), vx: -60, vy: 0, hp: 1, onGround: false });
    } else if (e.ch === 's') {
      state.enemies.push({
        type: 'demon', shooter: true, ...place(32, 32, e.col, e.row), vx: -40, vy: 0, hp: 1, onGround: false,
        shootT: 1.2, hold: false, aim: -1,
      });
    } else if (e.ch === 'f') {
      const p = place(32, 28, e.col, e.row);
      state.enemies.push({ type: 'flyer', ...p, baseY: p.y, vx: 0, hp: 1, phase: e.col });
    } else if (e.ch === 'B') {
      const cfg = BOSSES[def.boss ?? 0];
      state.boss = {
        ...cfg, ...place(96, 96, e.col, e.row), vx: 0, vy: 0, maxHp: cfg.hp, facing: -1,
        active: false, onGround: false, hurt: 0, jumpT: cfg.jumpEvery, shootT: cfg.shootEvery,
      };
    } else if (PICKUPS.includes(e.ch)) {
      state.pickups.push({ kind: e.ch, ...place(24, 28, e.col, e.row) });
    }
  }
  const sp = state.checkpoint || lvl.spawn;
  Object.assign(state.player, place(state.player.w, state.player.h, sp.col, sp.row), {
    vx: 0, vy: 0, onGround: false, invuln: 0, knock: 0, airJumps: 0, jumpHeld: false,
  });
  state.camX = 0;
}

export function isSolid(state, col, row) {
  const { cols, rows, tiles } = state.level;
  if (col < 0 || col >= cols) return true;
  if (row < 0 || row >= rows) return false;
  return tiles[row * cols + col] > 0;
}

function collides(state, b) {
  const c0 = Math.floor(b.x / TILE);
  const c1 = Math.floor((b.x + b.w - 1e-6) / TILE);
  const r0 = Math.floor(b.y / TILE);
  const r1 = Math.floor((b.y + b.h - 1e-6) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (isSolid(state, c, r)) return true;
  }
  return false;
}

// Axis-separated move against the tile grid. Returns true if blocked horizontally.
function moveBody(state, b) {
  let hitX = false;
  b.x += b.vx * STEP;
  if (b.vx !== 0 && collides(state, b)) {
    b.x = b.vx > 0 ? Math.floor((b.x + b.w) / TILE) * TILE - b.w : (Math.floor(b.x / TILE) + 1) * TILE;
    hitX = true;
  }
  b.onGround = false;
  b.y += b.vy * STEP;
  if (b.vy !== 0 && collides(state, b)) {
    if (b.vy > 0) {
      b.y = Math.floor((b.y + b.h) / TILE) * TILE - b.h;
      b.onGround = true;
    } else {
      b.y = (Math.floor(b.y / TILE) + 1) * TILE;
    }
    b.vy = 0;
  }
  return hitX;
}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const cx = (b) => b.x + b.w / 2;

export function applyPickup(state, kind) {
  const p = state.player;
  const heal = (n) => { p.hp = Math.min(p.maxHp, p.hp + n); };
  if (kind === 'm') p.ammo += 5;
  if (kind === 'c' || kind === 'v' || kind === 'b') heal(1);
  if (kind === 'w') heal(2);
  if (kind === 'h') {
    p.maxHp = Math.min(MAX_HP_CAP, p.maxHp + 1);
    p.hp = p.maxHp;
  }
  if (BUFF_OF[kind]) {
    const [name, secs] = BUFF_OF[kind];
    p.buffs[name] = secs;
  }
}

function burst(state, x, y, color, n = 12, speed = 220) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.6, max: 0.6, color, size: 3 + Math.random() * 4 });
  }
}

// cause: 'pit' | 'hp'. The world freezes until respawn() or a new game.
function die(state, cause) {
  state.deaths++;
  emit(state, 'death');
  state.mode = 'dead';
  state.deadT = 0;
  state.deathCause = cause;
  state.player.vx = 0;
}

export function respawn(state) {
  const p = state.player;
  p.hp = p.maxHp;
  p.ammo = Math.max(p.ammo, 10);
  for (const k in p.buffs) p.buffs[k] = 0;
  resetLevel(state);
}

function hurt(state, src) {
  const p = state.player;
  if (p.invuln > 0 || p.buffs.whiskey > 0) return;
  p.hp--;
  emit(state, 'hurt');
  p.invuln = 1.2;
  p.knock = 0.25;
  p.vx = (cx(p) < cx(src) ? -1 : 1) * 250;
  p.vy = -350;
  p.jumpHeld = false;
  burst(state, cx(p), p.y + 20, '#ff5252', 8);
  if (p.hp <= 0) die(state, 'hp');
}

function updatePlayer(state, input) {
  const p = state.player;
  const jumpPressed = input.jump && !state.prevJump;
  state.prevJump = input.jump;
  for (const k in p.buffs) p.buffs[k] = Math.max(0, p.buffs[k] - STEP);
  p.invuln = Math.max(0, p.invuln - STEP);
  p.knock = Math.max(0, p.knock - STEP);
  p.fireCd = Math.max(0, p.fireCd - STEP);

  if (p.knock <= 0) {
    p.vx = (input.right - input.left) * SPEED * (p.buffs.beer > 0 ? 1.4 : 1);
    if (p.vx) p.facing = Math.sign(p.vx);
  }
  if (jumpPressed) {
    if (p.onGround) {
      p.vy = -JUMP_V;
      p.jumpHeld = true;
    } else if (p.buffs.vape > 0 && p.airJumps > 0) {
      p.vy = -JUMP_V * 0.9;
      p.jumpHeld = true;
      p.airJumps--;
      burst(state, cx(p), p.y + p.h, '#e0e0e0', 10, 120);
    }
  }
  if (!input.jump && p.jumpHeld && p.vy < -JUMP_CUT) {
    p.vy = -JUMP_CUT;
    p.jumpHeld = false;
  }
  p.vy = Math.min(p.vy + GRAVITY * STEP, MAX_FALL);
  moveBody(state, p);
  if (p.onGround) {
    p.airJumps = 1;
    p.walk += Math.abs(p.vx) * STEP;
  }

  if (input.fire && p.fireCd <= 0) {
    const lighter = p.buffs.lighter > 0;
    if (lighter || p.ammo > 0) {
      if (!lighter) p.ammo--;
      emit(state, lighter ? 'fire' : 'shoot');
      const w = lighter ? 22 : 16;
      state.shots.push({
        x: p.facing > 0 ? p.x + p.w : p.x - w, y: p.y + 34, w, h: lighter ? 14 : 6,
        vx: p.facing * 520, life: 0.8, pierce: lighter, hitBoss: false,
      });
      p.fireCd = lighter ? 0.15 : 0.3;
    }
  }

  const bottom = state.level.rows * TILE;
  if (p.y > bottom + 64) die(state, 'pit');
}

function updateEnemies(state) {
  const p = state.player;
  const bottom = state.level.rows * TILE;
  for (const e of state.enemies) {
    if (e.type === 'demon') {
      if (e.shooter) spit(state, e);
      e.vy = Math.min(e.vy + GRAVITY * STEP, MAX_FALL);
      const patrol = e.vx;
      if (e.hold) e.vx = 0;
      const hitX = moveBody(state, e);
      e.vx = patrol;
      if (!e.hold) {
        const footX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        const edge = e.onGround && !isSolid(state, Math.floor(footX / TILE), Math.floor((e.y + e.h + 1) / TILE));
        if (hitX || edge) e.vx = -e.vx;
      }
      if (e.y > bottom) e.hp = 0;
    } else {
      const dx = cx(p) - cx(e);
      if (Math.abs(dx) < 400) e.x += Math.sign(dx) * 50 * STEP;
      e.y = e.baseY + Math.sin(state.time * 3 + e.phase) * 40;
    }
  }
}

// Fire-spitting demon: stops when the player is in range, faces them and spits a flame every SPIT_EVERY s.
function spit(state, e) {
  const p = state.player;
  const dx = cx(p) - cx(e);
  e.hold = Math.abs(dx) < SPIT_RANGE && Math.abs(p.y + p.h / 2 - (e.y + e.h / 2)) < 160;
  if (!e.hold) {
    e.shootT = Math.max(e.shootT, 0.8);
    return;
  }
  e.aim = Math.sign(dx) || 1;
  e.shootT -= STEP;
  if (e.shootT > 0) return;
  e.shootT = SPIT_EVERY;
  emit(state, 'spit');
  const a = Math.atan2(p.y + p.h / 2 - (e.y + 12), dx);
  state.enemyShots.push({
    x: cx(e) - 7 + e.aim * 12, y: e.y + 6, w: 14, h: 14, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, life: 3, flame: true,
  });
}

function updateBoss(state) {
  const b = state.boss;
  if (!b) return;
  const p = state.player;
  b.hurt = Math.max(0, b.hurt - STEP);
  if (!b.active && Math.abs(cx(b) - cx(p)) < 600) b.active = true;
  b.vx = 0;
  if (b.active) {
    const dir = Math.sign(cx(p) - cx(b));
    if (dir) b.facing = dir;
    if (Math.abs(cx(p) - cx(b)) > 8) b.vx = dir * b.speed;
    b.jumpT -= STEP;
    if (b.jumpT <= 0 && b.onGround) {
      b.vy = -650;
      b.jumpT = b.jumpEvery;
    }
    if (b.shootEvery) {
      b.shootT -= STEP;
      if (b.shootT <= 0) {
        b.shootT = b.shootEvery;
        emit(state, 'spit');
        const aim = Math.atan2(p.y + p.h / 2 - (b.y + 30), cx(p) - cx(b));
        const fan = b.spread === 3 ? [-0.25, 0, 0.25] : [0];
        for (const off of fan) {
          state.enemyShots.push({ x: cx(b) - 8, y: b.y + 22, w: 16, h: 16, vx: Math.cos(aim + off) * 280, vy: Math.sin(aim + off) * 280, life: 4 });
        }
      }
    }
  }
  b.vy = Math.min(b.vy + GRAVITY * STEP, MAX_FALL);
  moveBody(state, b);
}

function updateShots(state) {
  const p = state.player;
  for (const s of state.shots) {
    s.x += s.vx * STEP;
    s.life -= STEP;
    if (isSolid(state, Math.floor((s.x + s.w / 2) / TILE), Math.floor((s.y + s.h / 2) / TILE))) s.life = 0;
    for (const e of state.enemies) {
      if (s.life > 0 && e.hp > 0 && overlap(s, e)) {
        e.hp = 0;
        if (!s.pierce) s.life = 0;
      }
    }
    const b = state.boss;
    if (b && s.life > 0 && !s.hitBoss && overlap(s, b)) {
      b.hp -= s.pierce ? 2 : 1;
      b.hurt = 0.15;
      emit(state, 'bossHit');
      s.hitBoss = true;
      if (!s.pierce) s.life = 0;
    }
    if (s.life <= 0) burst(state, s.x + s.w / 2, s.y, '#ffb300', 4, 90);
  }
  state.shots = state.shots.filter((s) => s.life > 0);

  for (const s of state.enemyShots) {
    s.x += s.vx * STEP;
    s.y += s.vy * STEP;
    s.life -= STEP;
    if (isSolid(state, Math.floor((s.x + s.w / 2) / TILE), Math.floor((s.y + s.h / 2) / TILE))) s.life = 0;
    if (s.life > 0 && overlap(s, p)) {
      s.life = 0;
      hurt(state, s);
    }
  }
  state.enemyShots = state.enemyShots.filter((s) => s.life > 0);
}

function contacts(state) {
  const p = state.player;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !overlap(p, e)) continue;
    if (p.buffs.whiskey > 0) {
      e.hp = 0;
    } else if (p.vy > 0 && p.y + p.h - e.y < 16) {
      e.hp = 0;
      emit(state, 'stomp');
      p.vy = -STOMP_BOUNCE;
      p.jumpHeld = false;
    } else {
      hurt(state, e);
    }
  }
  for (const e of state.enemies) {
    if (e.hp > 0) continue;
    burst(state, cx(e), e.y + e.h / 2, '#d50000');
    emit(state, 'kill');
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0);

  const b = state.boss;
  if (b && overlap(p, b)) {
    if (p.vy > 0 && p.y + p.h - b.y < 20) {
      if (b.hurt <= 0) {
        b.hp--;
        b.hurt = 0.4;
        emit(state, 'bossHit');
      }
      p.vy = -550;
      p.jumpHeld = false;
    } else {
      hurt(state, b);
    }
  }

  for (const k of state.pickups) {
    if (overlap(p, k)) {
      applyPickup(state, k.kind);
      emit(state, `pickup-${k.kind}`);
      k.taken = true;
      burst(state, cx(k), k.y + k.h / 2, '#fff59d', 8, 120);
    }
  }
  state.pickups = state.pickups.filter((k) => !k.taken);
}

function tick(state, input) {
  state.time += STEP;
  for (const q of state.particles) {
    q.x += q.vx * STEP;
    q.y += q.vy * STEP;
    q.vy += 500 * STEP;
    q.life -= STEP;
  }
  state.particles = state.particles.filter((q) => q.life > 0);
  if (state.mode === 'dead') {
    const p = state.player;
    state.deadT += STEP;
    p.vy = Math.min(p.vy + GRAVITY * STEP, MAX_FALL);
    if (p.y < state.level.rows * TILE + 200) moveBody(state, p);
    return;
  }
  if (state.mode !== 'playing') return;

  const deaths = state.deaths;
  updatePlayer(state, input);
  if (state.deaths !== deaths) return;
  updateEnemies(state);
  updateBoss(state);
  updateShots(state);
  if (state.deaths !== deaths) return;
  contacts(state);
  if (state.deaths !== deaths) return;

  const p = state.player;
  for (const c of state.level.checkpoints) {
    if (cx(p) >= c.col * TILE && (!state.checkpoint || c.col > state.checkpoint.col)) state.checkpoint = c;
  }

  const b = state.boss;
  if (b && b.hp <= 0) {
    burst(state, cx(b), b.y + b.h / 2, '#ff6d00', 60, 400);
    state.boss = null;
    state.enemyShots = [];
    state.mode = state.levelIndex + 1 < state.levels.length ? 'levelComplete' : 'victory';
    emit(state, state.mode === 'victory' ? 'victory' : 'bossDown');
  }

  const maxCam = Math.max(0, state.level.cols * TILE - VIEW_W);
  state.camX = Math.min(maxCam, Math.max(0, cx(p) - VIEW_W * 0.4));
}

// Which music should play: the boss track from the moment the boss wakes up until it dies,
// background otherwise; quieter while the death screen is up.
export function musicCue(state) {
  return {
    track: state.boss?.active ? 'boss' : 'bg',
    volume: state.mode === 'dead' ? 0.35 : 1,
  };
}

export function step(state, input, dt) {
  state.acc = Math.min(state.acc + dt, 0.25);
  while (state.acc >= STEP) {
    tick(state, input);
    state.acc -= STEP;
  }
}
