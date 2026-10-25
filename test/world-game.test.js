import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicCue } from '../src/game.js';
import { parseArena, heightAt, floorAt, createGame, loadLevel, nextLevel, step, respawn } from '../world/game.js';
import { ARENAS } from '../world/arenas.js';

const IDLE = { mx: 0, mz: 0, jump: false, fire: false };
const DT = 1 / 60;
const go = (o) => ({ ...IDLE, ...o });

function run(state, input, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(state, input, DT);
}

// Steps until cond(state) or the time runs out; returns whether cond came true.
function until(state, input, cond, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    step(state, input, DT);
    if (cond(state)) return true;
  }
  return false;
}

const cell = (b) => [Math.floor(b.x / 32), Math.floor(b.z / 32)];

// One map for both grids: terrain chars go to ground, everything else to things (standing on '.').
function split(map) {
  const terrain = (ch) => '#._12345'.includes(ch);
  return {
    ground: map.map((r) => [...r].map((ch) => (terrain(ch) ? ch : '.')).join('')),
    things: map.map((r) => [...r].map((ch) => (terrain(ch) ? '.' : ch)).join('')),
  };
}

function game(map, extra = {}) {
  const state = createGame([{ boss: 0, bg: 'street', ...split(map), ...extra }]);
  loadLevel(state, 0);
  return state;
}

// w x h walkable cells inside a wall, P at (px, pz), extra things placed by [ch, col, row]
function field(w, h, px, pz, things = []) {
  const rows = Array.from({ length: h + 2 }, (_, r) => [...'#'.repeat(w + 2)].map((ch, c) => (r > 0 && r <= h && c > 0 && c <= w ? '.' : ch)));
  rows[pz][px] = 'P';
  for (const [ch, c, r] of things) rows[r][c] = ch;
  return rows.map((r) => r.join(''));
}

test('parseArena reads heights, spawn and things', () => {
  const lvl = parseArena({ ground: ['#####', '#.2_#', '#####'], things: ['.....', '.P.d.', '.....'] });
  assert.equal(lvl.cols, 5);
  assert.equal(lvl.rows, 3);
  assert.equal(heightAt(lvl, 0, 0), Infinity);
  assert.equal(heightAt(lvl, 2, 1), 64);
  assert.equal(heightAt(lvl, 3, 1), -Infinity);
  assert.equal(heightAt(lvl, 1, 1), 0);
  assert.equal(heightAt(lvl, -1, 1), Infinity);
  assert.equal(heightAt(lvl, 1, 3), Infinity);
  assert.deepEqual(lvl.spawn, { col: 1, row: 1 });
  assert.deepEqual(lvl.entities, [{ ch: 'd', col: 3, row: 1 }]);
});

test('parseArena rejects a things grid of another size', () => {
  assert.throws(() => parseArena({ ground: ['...'], things: ['..'] }));
  assert.throws(() => parseArena({ ground: ['...', '...'], things: ['...'] }));
});

test('floorAt takes the highest cell under the footprint', () => {
  const lvl = parseArena({ ground: ['#####', '#.2_#', '#####'], things: ['.....', '.....', '.....'] });
  assert.equal(floorAt(lvl, 64, 48, 12), 64); // straddles '.' (col 1) and '2' (col 2)
  assert.equal(floorAt(lvl, 40, 48, 4), 0);
  assert.equal(floorAt(lvl, 112, 48, 4), -Infinity); // over the pit
  assert.equal(floorAt(lvl, 92, 48, 4), 64); // x 88..96 is still the block, not the pit at 96
});

test('player runs at SPEED in any direction, diagonals are not faster', () => {
  const s = game(field(20, 20, 5, 5));
  const x0 = s.player.x;
  run(s, go({ mx: 1 }), 1);
  assert.ok(Math.abs(s.player.x - x0 - 260) < 3, `ran ${s.player.x - x0}`);

  const d = game(field(20, 20, 5, 5));
  const [dx0, dz0] = [d.player.x, d.player.z];
  run(d, go({ mx: 1, mz: 1 }), 1);
  const dist = Math.hypot(d.player.x - dx0, d.player.z - dz0);
  assert.ok(Math.abs(dist - 260) < 3, `ran ${dist}`);
});

test('moving north keeps facing and turns aim', () => {
  const s = game(field(10, 10, 5, 8));
  assert.equal(s.player.facing, 1);
  run(s, go({ mz: -1 }), 0.1);
  assert.equal(s.player.facing, 1);
  assert.deepEqual(s.player.aim, { x: 0, z: -1 });
  assert.ok(s.player.z < 8 * 32 + 16);
  run(s, go({ mx: -1 }), 0.1);
  assert.equal(s.player.facing, -1);
  assert.deepEqual(s.player.aim, { x: -1, z: 0 });
});

test('walls stop the player', () => {
  const s = game(field(9, 3, 1, 2));
  run(s, go({ mx: 1 }), 3);
  assert.ok(s.player.x + s.player.r <= 320, `x ${s.player.x}`);
  assert.ok(s.player.x + s.player.r > 318, `x ${s.player.x}`);
  run(s, go({ mz: 1 }), 2);
  assert.ok(s.player.z + s.player.r <= 4 * 32, `z ${s.player.z}`);
});

test('a block needs a jump', () => {
  const s = game(['##########', '#P..11111#', '##########']);
  run(s, go({ mx: 1 }), 2);
  assert.ok(s.player.x + s.player.r <= 128, `x ${s.player.x}`);
  assert.equal(s.player.y, 0);
  run(s, go({ mx: 1, jump: true }), 1.5);
  assert.equal(s.player.onGround, true);
  assert.equal(s.player.y, 32);
});

test('4 tiles is reachable with one jump, 5 only with a vape double jump', () => {
  const four = game(['##########', '#P..44444#', '##########']);
  run(four, go({ mx: 1 }), 1);
  run(four, go({ mx: 1, jump: true }), 1.5);
  assert.equal(four.player.y, 128);

  const five = game(['##########', '#P..55555#', '##########']);
  run(five, go({ mx: 1 }), 1);
  run(five, go({ mx: 1, jump: true }), 1.5);
  assert.equal(five.player.y, 0);

  const vape = game(['##########', '#P..55555#', '##########']);
  vape.player.buffs.vape = 10;
  run(vape, go({ mx: 1 }), 1);
  run(vape, go({ mx: 1, jump: true }), 0.4);
  run(vape, go({ mx: 1 }), DT);
  run(vape, go({ mx: 1, jump: true }), 1.5);
  assert.equal(vape.player.y, 160);
});

test('falling into a pit kills', () => {
  const s = game(['##########', '#P..____.#', '##########']);
  run(s, go({ mx: 1 }), 2);
  assert.equal(s.mode, 'dead');
  assert.equal(s.deathCause, 'pit');
  assert.ok(s.events.includes('death'));
});

test('a long frame runs at most 15 ticks', () => {
  const s = game(field(5, 5, 2, 2));
  step(s, IDLE, 5);
  assert.ok(Math.abs(s.time - 0.25) < 1e-9, `time ${s.time}`);
});

test('a match flies along aim and kills a demon in line', () => {
  const s = game(field(10, 12, 5, 11, [['d', 5, 4]]));
  run(s, go({ mz: -1 }), DT);
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 1);
  assert.equal(s.enemies.length, 0);
  assert.ok(s.events.includes('shoot'));
  assert.ok(s.events.includes('kill'));
  assert.equal(s.player.ammo, 9);
});

test('auto-aim hits a walking demon up to 30° off the aim', () => {
  // aim east (default); the demon is 10 tiles east, 3 north (17°), out of chase range and walking
  const s = game(field(18, 8, 2, 6, [['d', 12, 3]]));
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 1);
  assert.equal(s.enemies.length, 0);
});

test('auto-aim leads a demon walking across the line of fire', () => {
  // straight north, 11 tiles: out of chase range, pacing west; unled, the match lands ~40 px behind it
  const s = game(field(20, 14, 10, 13, [['d', 10, 2]]));
  run(s, go({ mz: -1 }), DT);
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 1);
  assert.equal(s.enemies.length, 0);
});

test('auto-aim ignores a demon 60° off the aim', () => {
  const s = game(field(18, 12, 2, 10, [['d', 5, 5]])); // 3 east, 5 north
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 1);
  assert.equal(s.enemies.length, 1);
});

test('ammo runs out; the lighter fires free piercing shots', () => {
  const s = game(field(10, 5, 2, 3));
  s.player.ammo = 0;
  run(s, go({ fire: true }), DT);
  assert.equal(s.shots.length, 0);
  assert.ok(!s.events.includes('shoot'));
  s.player.buffs.lighter = 5;
  run(s, go({ fire: true }), 0.2);
  assert.equal(s.shots[0].pierce, true);
  assert.equal(s.player.ammo, 0);
  assert.ok(s.events.includes('fire'));
});

test('landing on a demon stomps it and bounces the player', () => {
  const s = game(field(10, 10, 2, 2, [['d', 6, 6]]));
  const e = s.enemies[0];
  Object.assign(s.player, { x: e.x, z: e.z, y: 80, vy: 0 });
  assert.ok(until(s, IDLE, (st) => st.enemies.length === 0, 1));
  assert.ok(s.player.vy > 0);
  assert.equal(s.player.hp, 3);
  assert.ok(s.events.includes('stomp'));
});

test('touching a demon from the side hurts and knocks back', () => {
  const s = game(field(10, 5, 3, 3, [['d', 5, 3]])); // walks west into the player
  assert.ok(until(s, IDLE, (st) => st.player.hp < 3, 2));
  assert.equal(s.player.hp, 2);
  assert.ok(s.player.invuln > 0);
  assert.ok(s.player.vx < 0, 'knocked away from the demon');
  assert.ok(s.player.vy > 0);
  assert.ok(s.events.includes('hurt'));
});

test('whiskey kills on touch without damage', () => {
  const s = game(field(10, 5, 3, 3, [['d', 5, 3]]));
  s.player.buffs.whiskey = 5;
  assert.ok(until(s, IDLE, (st) => st.enemies.length === 0, 2));
  assert.equal(s.player.hp, 3);
  assert.ok(s.events.includes('kill'));
});

test('demons patrol along x and turn at walls and pit edges', () => {
  const s = game([
    '##############################',
    '#P...........................#',
    '##############################',
    '#.................__..d..#####',
    '##############################',
  ]);
  const e = s.enemies[0];
  let turns = 0;
  let vx = e.vx;
  for (let i = 0; i < 300; i++) {
    step(s, IDLE, DT);
    const [col] = cell(e);
    assert.ok(col >= 20 && col <= 24, `demon at col ${col}`);
    if (Math.sign(e.vx) !== Math.sign(vx)) turns++;
    vx = e.vx;
  }
  assert.equal(s.enemies.length, 1);
  assert.ok(turns >= 2, `turned ${turns} times`);
});

test('demons chase a player within AGGRO', () => {
  const s = game(field(12, 6, 2, 5, [['d', 6, 2]])); // 4 east, 3 north: 160 px
  const e = s.enemies[0];
  const z0 = e.z;
  const d0 = Math.hypot(e.x - s.player.x, e.z - s.player.z);
  run(s, IDLE, 1);
  assert.ok(e.z > z0 + 30, `z ${z0} -> ${e.z}`);
  assert.ok(Math.hypot(e.x - s.player.x, e.z - s.player.z) < d0);
});

test('pickups apply like in the 2D game', () => {
  const s = game(field(10, 5, 2, 3, [['h', 3, 3]]));
  run(s, go({ mx: 1 }), 0.3);
  assert.equal(s.player.maxHp, 6);
  assert.equal(s.player.hp, 6);
  assert.deepEqual(s.popups.map((q) => q.kind), ['h']);
  assert.ok(s.events.includes('pickup-h'));
  assert.equal(s.pickups.length, 0);
});

test('touching a checkpoint makes it the respawn point', () => {
  const s = game(['###########', '#P..C..___#', '###########']);
  run(s, go({ mx: 1 }), 3);
  assert.equal(s.mode, 'dead');
  respawn(s);
  assert.equal(s.mode, 'playing');
  assert.deepEqual(cell(s.player), [4, 1]);
  assert.equal(s.player.hp, s.player.maxHp);
});

test('the boss wakes within 500 px and walks to the player', () => {
  const s = game(field(20, 8, 2, 4, [['B', 14, 4]])); // 384 px
  const d0 = s.boss.x - s.player.x;
  run(s, IDLE, 1);
  assert.equal(s.boss.active, true);
  assert.ok(s.boss.x - s.player.x < d0 - 40);

  const far = game(field(26, 8, 2, 4, [['B', 22, 4]])); // 640 px
  run(far, IDLE, 1);
  assert.equal(far.boss.active, false);
});

test('stomping the boss hurts it at most once per 0.4 s', () => {
  const s = game(field(20, 8, 4, 4, [['B', 12, 4]]));
  const b = s.boss;
  const drop = () => Object.assign(s.player, { x: b.x, z: b.z, y: b.y + b.h + 2, vy: -100 });
  drop();
  assert.ok(until(s, IDLE, (st) => st.events.includes('bossHit'), 0.5));
  assert.equal(b.hp, b.maxHp - 1);
  assert.ok(s.player.vy > 0);
  run(s, IDLE, 0.1);
  drop();
  run(s, IDLE, DT * 2);
  assert.equal(b.hp, b.maxHp - 1);
  run(s, IDLE, 0.5);
  drop();
  run(s, IDLE, DT * 2);
  assert.equal(b.hp, b.maxHp - 2);
});

test('matches hurt the boss: 1 per match, 2 per lighter shot, once per shot', () => {
  const s = game(field(20, 8, 2, 4, [['B', 9, 4]]));
  run(s, IDLE, DT); // wakes up
  const b = s.boss;
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 0.6);
  assert.equal(b.hp, b.maxHp - 1);
  s.player.buffs.lighter = 5;
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 0.6);
  assert.equal(b.hp, b.maxHp - 3);
});

test('the boss at 0 hp ends the arena: victory on the last one, levelComplete before it', () => {
  const s = game(field(20, 8, 2, 4, [['B', 9, 4]]));
  run(s, IDLE, DT);
  s.boss.hp = 1;
  run(s, go({ fire: true }), DT);
  run(s, IDLE, 0.6);
  assert.equal(s.boss, null);
  assert.equal(s.mode, 'victory');
  assert.ok(s.events.includes('victory'));

  const arena = { boss: 0, bg: 'street', ...split(field(20, 8, 2, 4, [['B', 9, 4]])) };
  const two = createGame([arena, arena]);
  loadLevel(two, 0);
  run(two, IDLE, DT);
  two.boss.hp = 1;
  run(two, go({ fire: true }), DT);
  run(two, IDLE, 0.6);
  assert.equal(two.mode, 'levelComplete');
  assert.ok(two.events.includes('bossDown'));
  nextLevel(two);
  assert.equal(two.levelIndex, 1);
  assert.equal(two.mode, 'playing');
});

test('respawn after a death resets the boss and the music cue', () => {
  const s = game(['####################', '#__P...........B...#', '#..................#', '####################']);
  run(s, IDLE, 0.2);
  assert.equal(musicCue(s).track, 'boss');
  s.boss.hp = 3;
  run(s, go({ mx: -1 }), 2);
  assert.equal(s.mode, 'dead');
  respawn(s);
  assert.equal(s.boss.active, false);
  assert.equal(s.boss.hp, s.boss.maxHp);
  assert.equal(musicCue(s).track, 'bg');
});

test('ARENAS are valid', () => {
  assert.ok(ARENAS.length > 0);
  for (const def of ARENAS) {
    const { ground, things } = def;
    const rows = ground.length;
    const cols = ground[0].length;
    assert.ok(ground.every((r) => r.length === cols) && things.every((r) => r.length === cols) && things.length === rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const g = ground[r][c];
        const t = things[r][c];
        assert.ok('#._12345'.includes(g), `ground ${g} at ${c},${r}`);
        assert.ok('.PCBdmlcvhbw'.includes(t), `thing ${t} at ${c},${r}`);
        if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) assert.equal(g, '#', `border open at ${c},${r}`);
        if (t !== '.') assert.ok(g !== '_' && g !== '#', `${t} on ${g} at ${c},${r}`);
        if (g === '4' || g === '5') assert.ok(r <= 4 || c <= 4 || c >= cols - 5, `tall block inside at ${c},${r}`);
      }
    }
    assert.equal(things.join('').split('P').length - 1, 1);
    assert.equal(things.join('').split('B').length - 1, 1);
    const s = createGame([def]);
    loadLevel(s, 0);
    run(s, IDLE, 1);
    assert.equal(s.mode, 'playing', 'nothing kills the hero standing at the start');
  }
});
