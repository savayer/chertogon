import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS } from '../src/sprite-atlas.js';
import { heroFrame, heroChin, itemFrame } from '../src/sprites.js';

test('heroFrame picks the pose: hurt beats throw beats air beats run', () => {
  assert.equal(heroFrame({}, 0), 0);
  assert.equal(heroFrame({ moving: true }, 0), 1);
  assert.equal(heroFrame({ moving: true }, 14 * 5), 6);
  assert.equal(heroFrame({ moving: true }, 14 * 6), 1); // run cycle wraps
  assert.equal(heroFrame({ airborne: true, rising: true, moving: true }, 0), 8);
  assert.equal(heroFrame({ airborne: true }, 0), 9);
  assert.equal(heroFrame({ airborne: true, throwing: true }, 0), 7);
  assert.equal(heroFrame({ throwing: true, hurt: true }, 0), 10);
  assert.equal(heroFrame({ lying: 0.5 }, 0), 10);
});

test('every hero frame has a chin above the feet, near the body axis', () => {
  assert.equal(ATLAS.hero.frames.length, 11);
  for (let i = 0; i < 11; i++) {
    const [x, y] = heroChin(i);
    assert.ok(Math.abs(x) < 12, `frame ${i} chin x ${x}`);
    assert.ok(y < -35 && y > -55, `frame ${i} chin y ${y}`);
  }
});

test('every pickup kind has an icon frame', () => {
  for (const kind of 'mlcvhbw') assert.ok(ATLAS.items.frames[itemFrame(kind)], kind);
});
