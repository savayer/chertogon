// Rules of the 3D world: an arena seen from above, the hero runs on x/z and jumps on y. No three.js and no DOM,
// so node tests import it. Axes: x east, z south (towards the camera), y up (feet height); cell (col, row) covers
// x from col*TILE and z from row*TILE. Bodies: x, z = center of a square footprint of half-size r, y = feet, h tall.
import { TILE, POPUP_LIFE, BOSSES, applyPickup } from '../src/game.js';
import { ARENAS } from './arenas.js';

const STEP = 1 / 60;
export const SPEED = 260;
export const GRAVITY = 1800;
export const JUMP_V = 720;
export const JUMP_CUT = 288;
export const MAX_FALL = 900;
const PIT_DEATH = -200; // feet this low = fell into a pit
const STOMP_BOUNCE = 450;
const SHOT_SPEED = 520;
export const AIM_RANGE = 420; // auto-aim: the nearest target this close ...
export const AIM_COS = Math.cos(Math.PI / 6); // ... and within 30° of where the hero looks
export const AGGRO = 260; // a demon this close (and on about the same height) walks at the player
const BOSS_WAKE = 500;
const PICKUPS = 'mlcvhbw';

const heightOf = (ch) => (ch === '#' ? Infinity : ch === '_' ? -Infinity : ch >= '1' && ch <= '5' ? Number(ch) * TILE : 0);

export function parseArena({ ground, things }) {
  const rows = ground.length;
  if (things.length !== rows || things.some((r, i) => r.length !== ground[i].length)) {
    throw new Error('arena: ground and things differ in size');
  }
  const cols = Math.max(...ground.map((r) => r.length));
  const heights = new Float64Array(cols * rows).fill(Infinity); // short rows end in a wall
  const checkpoints = [];
  const entities = [];
  let spawn = { col: 0, row: 0 };
  ground.forEach((line, row) => [...line].forEach((ch, col) => { heights[row * cols + col] = heightOf(ch); }));
  things.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === 'P') spawn = { col, row };
      else if (ch === 'C') checkpoints.push({ col, row });
      else if (ch !== '.' && ch !== ' ') entities.push({ ch, col, row });
    });
  });
  return { cols, rows, heights, spawn, checkpoints, entities };
}

export function heightAt(level, col, row) {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return Infinity;
  return level.heights[row * level.cols + col];
}

// pick (Math.max / Math.min) of the cell heights under the footprint [x-r, x+r] x [z-r, z+r]
function under(level, x, z, r, pick) {
  const c0 = Math.floor((x - r) / TILE);
  const c1 = Math.floor((x + r - 1e-6) / TILE);
  const r0 = Math.floor((z - r) / TILE);
  const r1 = Math.floor((z + r - 1e-6) / TILE);
  let h = heightAt(level, c0, r0);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) h = pick(h, heightAt(level, col, row));
  }
  return h;
}

// The highest cell under the footprint: what a body there stands on.
export const floorAt = (level, x, z, r) => under(level, x, z, r, Math.max);

function newPlayer() {
  return {
    x: 0, y: 0, z: 0, r: 12, h: 56, vx: 0, vy: 0, vz: 0, onGround: false, facing: 1, aim: { x: 1, z: 0 },
    hp: 3, maxHp: 5, ammo: 10, invuln: 0, knock: 0, fireCd: 0, airJumps: 0, jumpHeld: false, walk: 0,
    buffs: { vape: 0, beer: 0, whiskey: 0, lighter: 0 },
  };
}

// The same shape as src/game.js where drawOverlay and musicCue read it.
export function createGame(arenas = ARENAS) {
  return {
    levels: arenas, levelIndex: 0, mode: 'playing', time: 0, acc: 0, deaths: 0, deadT: 0, deathCause: null,
    player: newPlayer(), level: null, checkpoint: null, prevJump: false,
    enemies: [], boss: null, shots: [], pickups: [], particles: [], popups: [],
    events: [], // sound cues, the same names as src/game.js
  };
}

const emit = (state, name) => state.events.push(name);
const cellCenter = (level, { col, row }) => ({ x: (col + 0.5) * TILE, z: (row + 0.5) * TILE, y: Math.max(0, heightAt(level, col, row)) });

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
  const level = parseArena(def);
  Object.assign(state, { level, mode: 'playing', enemies: [], boss: null, shots: [], pickups: [], particles: [], popups: [] });
  for (const e of level.entities) {
    const at = cellCenter(level, e);
    if (e.ch === 'd') state.enemies.push({ type: 'demon', ...at, r: 14, h: 32, vx: -60, vz: 0, vy: 0, hp: 1, onGround: false });
    else if (PICKUPS.includes(e.ch)) state.pickups.push({ kind: e.ch, ...at, r: 12, h: 28 });
    else if (e.ch === 'B') {
      const cfg = BOSSES[def.boss ?? 0];
      state.boss = {
        ...cfg, ...at, r: 40, h: 96, vx: 0, vz: 0, vy: 0, maxHp: cfg.hp, facing: -1,
        active: false, onGround: false, hurt: 0, jumpT: cfg.jumpEvery, shootT: cfg.shootEvery,
      };
    }
  }
  Object.assign(state.player, cellCenter(level, state.checkpoint || level.spawn), {
    vx: 0, vy: 0, vz: 0, onGround: false, invuln: 0, knock: 0, airJumps: 0, jumpHeld: false,
  });
}

// Moves along x, then z, then y against the height grid; a cell higher than the feet is a wall.
// Returns true if blocked on x or z.
function moveBody(level, b) {
  let hit = false;
  b.x += b.vx * STEP;
  if (b.vx && floorAt(level, b.x, b.z, b.r) > b.y + 0.5) {
    b.x = b.vx > 0 ? Math.floor((b.x + b.r) / TILE) * TILE - b.r - 1e-3 : (Math.floor((b.x - b.r) / TILE) + 1) * TILE + b.r + 1e-3;
    hit = true;
  }
  b.z += b.vz * STEP;
  if (b.vz && floorAt(level, b.x, b.z, b.r) > b.y + 0.5) {
    b.z = b.vz > 0 ? Math.floor((b.z + b.r) / TILE) * TILE - b.r - 1e-3 : (Math.floor((b.z - b.r) / TILE) + 1) * TILE + b.r + 1e-3;
    hit = true;
  }
  b.vy = Math.max(b.vy - GRAVITY * STEP, -MAX_FALL);
  b.y += b.vy * STEP;
  const floor = floorAt(level, b.x, b.z, b.r);
  b.onGround = b.y <= floor;
  if (b.onGround) {
    b.y = floor;
    b.vy = 0;
  }
  return hit;
}

const overlap = (a, b) => Math.abs(a.x - b.x) < a.r + b.r && Math.abs(a.z - b.z) < a.r + b.r && a.y < b.y + b.h && a.y + a.h > b.y;

function burst(state, x, y, z, color, n = 12, speed = 220) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * Math.PI - Math.PI / 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    state.particles.push({
      x, y, z, vx: Math.cos(a) * Math.cos(b) * v, vy: Math.sin(b) * v + 80, vz: Math.sin(a) * Math.cos(b) * v,
      life: 0.6, max: 0.6, color, size: 3 + Math.random() * 4,
    });
  }
}

// cause: 'pit' | 'hp'. The world freezes until respawn() or a new game.
function die(state, cause) {
  state.deaths++;
  emit(state, 'death');
  state.mode = 'dead';
  state.deadT = 0;
  state.deathCause = cause;
  state.player.vx = state.player.vz = 0;
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
  const dx = p.x - src.x;
  const dz = p.z - src.z;
  const d = Math.hypot(dx, dz);
  p.vx = (d ? dx / d : -p.facing) * 250;
  p.vz = (d ? dz / d : 0) * 250;
  p.vy = 350;
  p.jumpHeld = false;
  burst(state, p.x, p.y + 36, p.z, '#ff5252', 8);
  if (p.hp <= 0) die(state, 'hp');
}

// Unit direction of a shot from (x, y, z): at the nearest demon or awake boss within AIM_RANGE and 30° of the aim,
// led by its walk, else straight along the aim.
function aimFrom(state, x, y, z) {
  const { aim } = state.player;
  let best = null;
  let bestD = AIM_RANGE;
  for (const e of state.boss?.active ? [...state.enemies, state.boss] : state.enemies) {
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz);
    if (d > 0 && d < bestD && (dx * aim.x + dz * aim.z) / d >= AIM_COS) {
      best = e;
      bestD = d;
    }
  }
  if (!best) return [aim.x, 0, aim.z];
  const t = bestD / SHOT_SPEED;
  const dx = best.x + best.vx * t - x;
  const dy = best.y + best.h / 2 - y;
  const dz = best.z + best.vz * t - z;
  const len = Math.hypot(dx, dy, dz);
  return [dx / len, dy / len, dz / len];
}

function updatePlayer(state, input) {
  const p = state.player;
  const jumpPressed = input.jump && !state.prevJump;
  state.prevJump = input.jump;
  for (const k in p.buffs) p.buffs[k] = Math.max(0, p.buffs[k] - STEP);
  p.invuln = Math.max(0, p.invuln - STEP);
  p.knock = Math.max(0, p.knock - STEP);
  p.fireCd = Math.max(0, p.fireCd - STEP);

  let mx = input.mx || 0;
  let mz = input.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  if (p.knock <= 0) {
    const speed = SPEED * (p.buffs.beer > 0 ? 1.4 : 1);
    p.vx = mx * speed;
    p.vz = mz * speed;
    if (len > 0.1) p.aim = { x: mx / Math.min(len, 1), z: mz / Math.min(len, 1) }; // mx, mz are already unit if len > 1
    if (Math.abs(mx) > 0.1) p.facing = Math.sign(mx);
  }
  if (jumpPressed) {
    if (p.onGround) {
      p.vy = JUMP_V;
      p.jumpHeld = true;
    } else if (p.buffs.vape > 0 && p.airJumps > 0) {
      p.vy = JUMP_V * 0.9;
      p.jumpHeld = true;
      p.airJumps--;
    }
  }
  if (!input.jump && p.jumpHeld && p.vy > JUMP_CUT) {
    p.vy = JUMP_CUT;
    p.jumpHeld = false;
  }
  moveBody(state.level, p);
  if (p.onGround) {
    p.airJumps = 1;
    p.walk += Math.hypot(p.vx, p.vz) * STEP;
  }

  if (input.fire && p.fireCd <= 0) {
    const lighter = p.buffs.lighter > 0;
    if (lighter || p.ammo > 0) {
      if (!lighter) p.ammo--;
      emit(state, lighter ? 'fire' : 'shoot');
      const r = lighter ? 9 : 4;
      const [x, y, z] = [p.x + p.aim.x * (p.r + r), p.y + 30, p.z + p.aim.z * (p.r + r)];
      const [dx, dy, dz] = aimFrom(state, x, y, z);
      state.shots.push({
        x, y, z, vx: dx * SHOT_SPEED, vy: dy * SHOT_SPEED, vz: dz * SHOT_SPEED, r, life: 0.8, pierce: lighter, hitBoss: false,
      });
      p.fireCd = lighter ? 0.15 : 0.3;
    }
  }

  if (p.y < PIT_DEATH) die(state, 'pit');
}

// Demons walk at a player who is near and about level with them, else pace along x. They never step where any part
// of them would hang over lower ground: on patrol they turn there (and at walls), in a chase they wait.
function updateEnemies(state) {
  const p = state.player;
  for (const e of state.enemies) {
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz);
    const chase = d > 1 && d < AGGRO && Math.abs(p.y - e.y) < 64;
    if (chase) {
      e.vx = (dx / d) * 70;
      e.vz = (dz / d) * 70;
    } else {
      e.vx = (e.vx > 0 ? 1 : -1) * 60;
      e.vz = 0;
    }
    if (e.onGround && under(state.level, e.x + e.vx * STEP, e.z + e.vz * STEP, e.r, Math.min) < e.y - 1) {
      if (chase) e.vx = e.vz = 0;
      else e.vx = -e.vx;
    }
    if (moveBody(state.level, e) && !chase) e.vx = -e.vx;
  }
}

// Wakes when the player comes close, then walks at them and jumps now and then; never walks off its ground,
// not even mid-jump. Bosses that shoot (1 and 2) come in phase 2.
function updateBoss(state) {
  const b = state.boss;
  if (!b) return;
  const p = state.player;
  b.hurt = Math.max(0, b.hurt - STEP);
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz);
  if (!b.active && d < BOSS_WAKE) b.active = true;
  b.vx = b.vz = 0;
  if (b.active) {
    if (Math.abs(dx) > 1) b.facing = Math.sign(dx);
    if (d > 8) {
      b.vx = (dx / d) * b.speed;
      b.vz = (dz / d) * b.speed;
    }
    const ground = floorAt(state.level, b.x, b.z, b.r);
    if (under(state.level, b.x + b.vx * STEP, b.z + b.vz * STEP, b.r, Math.min) < ground - 1) b.vx = b.vz = 0;
    b.jumpT -= STEP;
    if (b.jumpT <= 0 && b.onGround) {
      b.vy = 650;
      b.jumpT = b.jumpEvery;
    }
  }
  moveBody(state.level, b);
  if (b.y < PIT_DEATH) b.hp = 0;
}

function updateShots(state) {
  for (const s of state.shots) {
    s.x += s.vx * STEP;
    s.y += s.vy * STEP;
    s.z += s.vz * STEP;
    s.life -= STEP;
    if (heightAt(state.level, Math.floor(s.x / TILE), Math.floor(s.z / TILE)) > s.y) s.life = 0;
    const box = { x: s.x, z: s.z, r: s.r, y: s.y - s.r, h: 2 * s.r };
    for (const e of state.enemies) {
      if (s.life > 0 && e.hp > 0 && overlap(box, e)) {
        e.hp = 0;
        if (!s.pierce) s.life = 0;
      }
    }
    const b = state.boss;
    if (b && s.life > 0 && !s.hitBoss && overlap(box, b)) {
      b.hp -= s.pierce ? 2 : 1;
      b.hurt = 0.15;
      emit(state, 'bossHit');
      s.hitBoss = true;
      if (!s.pierce) s.life = 0;
    }
    if (s.life <= 0) burst(state, s.x, s.y, s.z, '#ffb300', 4, 90);
  }
  state.shots = state.shots.filter((s) => s.life > 0);
}

function contacts(state) {
  const p = state.player;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !overlap(p, e)) continue;
    if (p.buffs.whiskey > 0) {
      e.hp = 0;
    } else if (p.vy < 0 && p.y >= e.y + e.h - 16) {
      e.hp = 0;
      emit(state, 'stomp');
      p.vy = STOMP_BOUNCE;
      p.jumpHeld = false;
    } else {
      hurt(state, e);
    }
  }
  for (const e of state.enemies) {
    if (e.hp > 0) continue;
    burst(state, e.x, e.y + e.h / 2, e.z, '#d50000');
    emit(state, 'kill');
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0);

  const b = state.boss;
  if (b && overlap(p, b)) {
    if (p.vy < 0 && p.y >= b.y + b.h - 20) {
      if (b.hurt <= 0) {
        b.hp--;
        b.hurt = 0.4;
        emit(state, 'bossHit');
      }
      p.vy = 550;
      p.jumpHeld = false;
    } else {
      hurt(state, b);
    }
  }

  for (const k of state.pickups) {
    if (overlap(p, k)) {
      applyPickup(state, k.kind);
      emit(state, `pickup-${k.kind}`);
      state.popups.push({ kind: k.kind, t: 0 });
      k.taken = true;
      burst(state, k.x, k.y + k.h / 2, k.z, '#fff59d', 8, 120);
    }
  }
  state.pickups = state.pickups.filter((k) => !k.taken);

  for (const c of state.level.checkpoints) {
    const at = cellCenter(state.level, c);
    if (Math.abs(p.x - at.x) <= 24 && Math.abs(p.z - at.z) <= 24) state.checkpoint = c;
  }
}

function tick(state, input) {
  state.time += STEP;
  for (const q of state.particles) {
    q.x += q.vx * STEP;
    q.y += q.vy * STEP;
    q.z += q.vz * STEP;
    q.vy -= 500 * STEP;
    q.life -= STEP;
  }
  state.particles = state.particles.filter((q) => q.life > 0);
  for (const q of state.popups) q.t += STEP;
  state.popups = state.popups.filter((q) => q.t < POPUP_LIFE);
  if (state.mode === 'dead') {
    const p = state.player;
    state.deadT += STEP;
    if (p.y > PIT_DEATH * 2) moveBody(state.level, p);
    return;
  }
  if (state.mode !== 'playing') return;

  const deaths = state.deaths;
  updatePlayer(state, input);
  if (state.deaths !== deaths) return;
  updateEnemies(state);
  updateBoss(state);
  updateShots(state);
  contacts(state);
  if (state.deaths !== deaths) return;

  const b = state.boss;
  if (b && b.hp <= 0) {
    burst(state, b.x, b.y + b.h / 2, b.z, '#ff6d00', 60, 400);
    state.boss = null;
    state.mode = state.levelIndex + 1 < state.levels.length ? 'levelComplete' : 'victory';
    emit(state, state.mode === 'victory' ? 'victory' : 'bossDown');
  }
}

export function step(state, input, dt) {
  state.acc = Math.min(state.acc + dt, 0.25);
  while (state.acc >= STEP) {
    tick(state, input);
    state.acc -= STEP;
  }
}
