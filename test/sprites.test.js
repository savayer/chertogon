import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS } from '../src/sprite-atlas.js';
import { heroFrame, heroChin, itemFrame, frameQuad, demonFrame, bossFrame } from '../src/sprites.js';

test('heroFrame picks the pose: hurt beats throw beats air beats run', () => {
  assert.equal(heroFrame({}, 0), 0);
  assert.equal(heroFrame({ moving: true }, 0), 1);
  assert.equal(heroFrame({ moving: true }, 26 * 7), 8);
  assert.equal(heroFrame({ moving: true }, 26 * 8), 1); // run cycle wraps
  assert.equal(heroFrame({ airborne: true, rising: true, moving: true }, 0), 10);
  assert.equal(heroFrame({ airborne: true }, 0), 11);
  assert.equal(heroFrame({ airborne: true, throwing: true }, 0), 9);
  assert.equal(heroFrame({ throwing: true, hurt: true }, 0), 12);
  assert.equal(heroFrame({ lying: 0.5 }, 0), 12);
});

test('every hero frame has a chin above the feet, near the body axis', () => {
  assert.equal(ATLAS.hero.frames.length, 13);
  for (let i = 0; i < 13; i++) {
    const [x, y] = heroChin(i);
    assert.ok(Math.abs(x) < 12, `frame ${i} chin x ${x}`);
    assert.ok(y < -40 && y > -62, `frame ${i} chin y ${y}`);
  }
});

test('every pickup kind has an icon frame', () => {
  for (const kind of 'mlcvhbw') assert.ok(ATLAS.items.frames[itemFrame(kind)], kind);
});

test('every character has normal, hurt and dead faces, Ilka first as the default', () => {
  assert.deepEqual(ATLAS.heads.chars, ['ilka', 'yurok', 'chen']);
  assert.equal(ATLAS.heads.frames.length, 3 * ATLAS.heads.chars.length);
});

test('frameQuad puts the anchor inside the quad and maps the frame rect to UVs', () => {
  const f = ATLAS.hero.frames[0];
  const res = ATLAS.hero.res;
  const q = frameQuad('hero', 0, 1000, 500);
  assert.equal(q.w, f.w / res);
  assert.equal(q.h, f.h / res);
  assert.equal(q.cx, (f.w / 2 - f.ax) / res);
  assert.equal(q.cy, (f.ay - f.h / 2) / res);
  assert.deepEqual([q.u0, q.u1], [f.x / 1000, (f.x + f.w) / 1000]);
  assert.deepEqual([q.v0, q.v1], [1 - (f.y + f.h) / 500, 1 - f.y / 500]);
});

test('demonFrame: walk cycle, the fire imp opens its mouth on the wind-up', () => {
  assert.equal(demonFrame({}, 0.3), 2); // floor(0.3*8) % 4
  assert.equal(demonFrame({ shooter: true }, 0.2), 1); // floor(0.2*6) % 2
  assert.equal(demonFrame({ shooter: true, hold: true, shootT: 0.3 }, 0), 2);
  assert.equal(demonFrame({ shooter: true, hold: true, shootT: 0.3 }, 0.1), 3);
  assert.equal(demonFrame({ shooter: true, hold: true, shootT: 0.9 }, 0.1), 0);
});

test('bossFrame: jump, walk, idle, hurt for boss 0, shooting for the others', () => {
  assert.equal(bossFrame({ onGround: false }, 1, 0), 2);
  assert.equal(bossFrame({ onGround: true, vx: 50 }, 1, 0.3), 1);
  assert.equal(bossFrame({ onGround: true, vx: 0 }, 1, 0.3), 0);
  assert.equal(bossFrame({ onGround: true, vx: 0, hurt: 0.2 }, 0, 0), 3);
  assert.equal(bossFrame({ onGround: true, vx: 0, active: true, shootEvery: 2, shootT: 1.8 }, 1, 0), 3);
});
