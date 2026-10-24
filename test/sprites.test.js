import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS } from '../src/sprite-atlas.js';
import { heroFrame, heroChin, itemFrame } from '../src/sprites.js';

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
