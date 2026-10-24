import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, parseLevel, createGame, loadLevel, nextLevel, respawn, step, applyPickup, isSolid, musicCue } from '../src/game.js';

const IDLE = { left: false, right: false, jump: false, fire: false };
const DT = 1 / 60;

function run(state, input, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(state, input, DT);
}

function game(map, extra = {}) {
  const state = createGame([{ name: 'тест', map, ...extra }]);
  loadLevel(state, 0);
  return state;
}

const FLAT = [
  '..........',
  '..........',
  '.P........',
  '##########',
];

test('parseLevel finds spawn, solid tiles and entities', () => {
  const lvl = parseLevel({ map: [
    '.P..dfmlcv',
    'hbwBC.....',
    '#####=====',
  ] });
  assert.equal(lvl.cols, 10);
  assert.equal(lvl.rows, 3);
  assert.deepEqual(lvl.spawn, { col: 1, row: 0 });
  assert.equal(lvl.tiles[2 * 10 + 0], 1);
  assert.equal(lvl.tiles[2 * 10 + 7], 2);
  assert.equal(lvl.tiles[0], 0);
  const kinds = lvl.entities.map((e) => e.ch).sort().join('');
  assert.equal(kinds, [...'dfmlcvhbwB'].sort().join(''));
  assert.deepEqual(lvl.checkpoints, [{ col: 4, row: 1 }]);
});

test('player falls and lands on the ground', () => {
  const s = game(FLAT);
  run(s, IDLE, 1);
  assert.equal(s.player.onGround, true);
  assert.equal(s.player.y + s.player.h, 3 * TILE);
});

test('player stops at a wall', () => {
  const s = game([
    '..........',
    '.P..#.....',
    '....#.....',
    '##########',
  ]);
  run(s, { ...IDLE, right: true }, 2);
  assert.equal(s.player.x + s.player.w, 4 * TILE);
});

test('huge dt does not tunnel the player through the floor', () => {
  const s = game(FLAT);
  step(s, IDLE, 5);
  step(s, IDLE, 5);
  assert.ok(s.player.y + s.player.h <= 3 * TILE);
  run(s, IDLE, 1);
  assert.equal(s.player.onGround, true);
});

test('cigarette never heals above maxHp', () => {
  const s = game(FLAT);
  s.player.hp = s.player.maxHp;
  applyPickup(s, 'c');
  assert.equal(s.player.hp, s.player.maxHp);
});

test('hookah raises maxHp by one, heals fully, caps at 8', () => {
  const s = game(FLAT);
  s.player.hp = 1;
  const before = s.player.maxHp;
  applyPickup(s, 'h');
  assert.equal(s.player.maxHp, before + 1);
  assert.equal(s.player.hp, before + 1);
  s.player.maxHp = 8;
  applyPickup(s, 'h');
  assert.equal(s.player.maxHp, 8);
});

test('buff pickups set timers that tick down', () => {
  const s = game(FLAT);
  applyPickup(s, 'v');
  applyPickup(s, 'b');
  applyPickup(s, 'w');
  applyPickup(s, 'l');
  assert.deepEqual(s.player.buffs, { vape: 15, beer: 12, whiskey: 8, lighter: 10 });
  run(s, IDLE, 1);
  assert.ok(Math.abs(s.player.buffs.vape - 14) < 0.02);
  run(s, IDLE, 10);
  assert.equal(s.player.buffs.whiskey, 0);
});

test('matches give ammo, touching a pickup collects it', () => {
  const s = game(FLAT);
  const ammo = s.player.ammo;
  applyPickup(s, 'm');
  assert.equal(s.player.ammo, ammo + 5);
  const s2 = game([
    '..........',
    '..........',
    '.P..c.....',
    '##########',
  ]);
  s2.player.hp = 1;
  run(s2, { ...IDLE, right: true }, 1.5);
  assert.equal(s2.player.hp, 2);
  assert.equal(s2.pickups.length, 0);
});

test('a collected pickup shows a popup of what it gave, which then expires', () => {
  const s = game([
    '..........',
    '..........',
    '.P.c......',
    '##########',
  ]);
  run(s, { ...IDLE, right: true }, 0.5);
  assert.deepEqual(s.popups.map((q) => q.kind), ['c']);
  run(s, IDLE, 2);
  assert.equal(s.popups.length, 0);
});

test('firing spends a match, no ammo means no shot, lighter is free', () => {
  const s = game(FLAT);
  run(s, IDLE, 0.5);
  s.player.ammo = 2;
  step(s, { ...IDLE, fire: true }, DT);
  assert.equal(s.shots.length, 1);
  assert.equal(s.player.ammo, 1);

  s.shots = [];
  s.player.ammo = 0;
  run(s, { ...IDLE, fire: true }, 0.5);
  assert.equal(s.shots.length, 0);

  applyPickup(s, 'l');
  run(s, { ...IDLE, fire: true }, 0.2);
  assert.ok(s.shots.length >= 1);
  assert.equal(s.player.ammo, 0);
  assert.equal(s.shots[0].pierce, true);
});

test('a match kills a demon', () => {
  const s = game([
    '..............',
    '..............',
    '.P.......d....',
    '##############',
  ]);
  run(s, IDLE, 0.5);
  run(s, { ...IDLE, fire: true }, DT);
  run(s, IDLE, 1);
  assert.equal(s.enemies.length, 0);
});

test('jumping on a demon kills it and bounces the player', () => {
  const s = game(FLAT);
  run(s, IDLE, 0.5);
  s.enemies.push({ type: 'demon', x: s.player.x - 2, y: 2 * TILE, w: 32, h: 32, vx: 0, vy: 0, hp: 1 });
  s.player.y = 2 * TILE - s.player.h - 4;
  s.player.vy = 300;
  s.player.onGround = false;
  step(s, IDLE, DT);
  step(s, IDLE, DT);
  assert.equal(s.enemies.length, 0);
  assert.ok(s.player.vy < 0);
  assert.equal(s.player.hp, 3);
});

test('touching a demon from the side hurts once, then invulnerable', () => {
  const s = game(FLAT);
  run(s, IDLE, 0.5);
  const hp = s.player.hp;
  s.enemies.push({ type: 'demon', x: s.player.x + 10, y: 2 * TILE, w: 32, h: 32, vx: 0, vy: 0, hp: 1 });
  step(s, IDLE, DT);
  assert.equal(s.player.hp, hp - 1);
  assert.ok(s.player.invuln > 0);
  s.enemies[0].x = s.player.x;
  s.enemies[0].y = s.player.y + s.player.h - 32;
  run(s, IDLE, 0.3);
  assert.equal(s.player.hp, hp - 1);
});

test('whiskey makes demons die on contact without damage', () => {
  const s = game(FLAT);
  run(s, IDLE, 0.5);
  applyPickup(s, 'w');
  const hp = s.player.hp;
  s.enemies.push({ type: 'demon', x: s.player.x + 10, y: 2 * TILE, w: 32, h: 32, vx: 0, vy: 0, hp: 1 });
  step(s, IDLE, DT);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.player.hp, hp);
});

test('second jump in the air only with vape', () => {
  const air = (vape) => {
    const s = game(FLAT);
    run(s, IDLE, 0.5);
    if (vape) applyPickup(s, 'v');
    step(s, { ...IDLE, jump: true }, DT);
    run(s, IDLE, 0.2);
    const vyBefore = s.player.vy;
    step(s, { ...IDLE, jump: true }, DT);
    return { vyBefore, vyAfter: s.player.vy };
  };
  const no = air(false);
  assert.ok(no.vyAfter > no.vyBefore - 1);
  const yes = air(true);
  assert.ok(yes.vyAfter < -500);
});

test('falling into a pit kills, respawn returns to the checkpoint with full hp', () => {
  const s = game([
    '............',
    '............',
    '.P..C.......',
    '#######...##',
  ]);
  for (let i = 0; i < 240 && !s.deaths; i++) step(s, { ...IDLE, right: true }, DT);
  assert.equal(s.deaths, 1);
  assert.equal(s.mode, 'dead');
  assert.equal(s.deathCause, 'pit');
  respawn(s);
  assert.equal(s.mode, 'playing');
  assert.equal(s.player.hp, s.player.maxHp);
  assert.equal(Math.floor((s.player.x + s.player.w / 2) / TILE), 4);
});

test('losing the last hp kills and freezes the player', () => {
  const s = game(FLAT);
  run(s, IDLE, 0.5);
  s.player.hp = 1;
  s.enemies.push({ type: 'demon', x: s.player.x + 10, y: 2 * TILE, w: 32, h: 32, vx: 0, vy: 0, hp: 1 });
  step(s, IDLE, DT);
  assert.equal(s.mode, 'dead');
  assert.equal(s.deathCause, 'hp');
  const x = s.player.x;
  run(s, { ...IDLE, right: true, fire: true }, 1);
  assert.equal(s.player.x, x);
  assert.equal(s.shots.length, 0);
  assert.ok(s.deadT > 0.9);
});

const RANGE = [
  '....................',
  '....................',
  '.P..........s.......',
  '####################',
];

test('fire-spitting demon shoots toward the player in range', () => {
  const s = game(RANGE);
  for (let i = 0; i < 300 && !s.enemyShots.length; i++) step(s, IDLE, DT);
  assert.ok(s.enemyShots.length >= 1);
  assert.ok(s.enemyShots[0].vx < 0);
  assert.equal(s.enemyShots[0].flame, true);
});

test('fire-spitting demon stays quiet when the player is far away', () => {
  const s = game([
    '..................................',
    '..................................',
    '.P..............................s.',
    '##################################',
  ]);
  run(s, IDLE, 3);
  assert.equal(s.enemyShots.length, 0);
});

test('demon flame hurts the player', () => {
  const s = game(RANGE);
  const hp = s.player.hp;
  for (let i = 0; i < 600 && s.player.hp === hp; i++) step(s, IDLE, DT);
  assert.equal(s.player.hp, hp - 1);
});

test('out of bounds left/right is solid, below is open', () => {
  const s = game(FLAT);
  assert.equal(isSolid(s, -1, 1), true);
  assert.equal(isSolid(s, 10, 1), true);
  assert.equal(isSolid(s, 3, 99), false);
});

test('killing the boss completes the level, on the last level wins the game', () => {
  const map = [
    '..........',
    '..........',
    '.P.....B..',
    '##########',
  ];
  const two = createGame([{ name: 'a', map, boss: 0 }, { name: 'b', map: FLAT }]);
  loadLevel(two, 0);
  assert.ok(two.boss);
  two.boss.hp = 0;
  step(two, IDLE, DT);
  assert.equal(two.mode, 'levelComplete');
  nextLevel(two);
  assert.equal(two.levelIndex, 1);
  assert.equal(two.mode, 'playing');

  const one = game(map, { boss: 0 });
  one.boss.hp = 0;
  step(one, IDLE, DT);
  assert.equal(one.mode, 'victory');
});

test('boss takes damage from matches', () => {
  const s = game([
    '..............',
    '..............',
    '.P.........B..',
    '##############',
  ], { boss: 0 });
  run(s, IDLE, 0.3);
  const hp = s.boss.hp;
  run(s, { ...IDLE, fire: true }, DT);
  run(s, IDLE, 0.8);
  assert.equal(s.boss.hp, hp - 1);
});

test('logic reports sound events', () => {
  const s = game([
    '..............',
    '..............',
    '.P..c....d....',
    '##############',
  ]);
  run(s, IDLE, 0.4);
  step(s, { ...IDLE, jump: true }, DT);
  run(s, IDLE, 1);
  run(s, { ...IDLE, fire: true }, DT);
  run(s, IDLE, 1);
  run(s, { ...IDLE, right: true }, 0.6);
  for (const e of ['shoot', 'kill', 'pickup-c']) assert.ok(s.events.includes(e), `missing ${e}: ${s.events}`);
  assert.ok(!s.events.includes('jump'), 'jump is silent');
});

test('music switches to the boss track during the fight and ducks on death', () => {
  const s = game([
    '..........',
    '..........',
    '.P.....B..',
    '##########',
  ], { boss: 0 });
  assert.deepEqual(musicCue(s), { track: 'bg', volume: 1 });
  step(s, IDLE, DT);
  assert.equal(s.boss.active, true);
  assert.deepEqual(musicCue(s), { track: 'boss', volume: 1 });
  s.player.y = 9999;
  step(s, IDLE, DT);
  assert.equal(s.mode, 'dead');
  assert.deepEqual(musicCue(s), { track: 'boss', volume: 0.35 });
  respawn(s);
  step(s, IDLE, DT);
  s.boss.hp = 0;
  step(s, IDLE, DT);
  assert.equal(s.mode, 'victory');
  assert.deepEqual(musicCue(s), { track: 'bg', volume: 1 });
});
