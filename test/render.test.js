import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headFor, mirroredTiles } from '../src/render.js';

test('headFor shows the hurt and dead faces when the head has them', () => {
  const head = { img: 'normal', hurt: 'hurt', dead: 'dead' };
  assert.equal(headFor(head, {}), 'normal');
  assert.equal(headFor(head, { hurt: true }), 'hurt');
  assert.equal(headFor(head, { lying: 0.5 }), 'dead');
  assert.equal(headFor({ img: 'photo' }, { hurt: true, lying: 1 }), 'photo'); // uploaded heads have one face
});

test('mirroredTiles covers the view with copies, every other one mirrored, wherever the scroll is', () => {
  assert.deepEqual(mirroredTiles(0, 100, 250), [{ x: 0, flip: false }, { x: 100, flip: true }, { x: 200, flip: false }]);
  assert.deepEqual(mirroredTiles(150, 100, 250), [{ x: -50, flip: true }, { x: 50, flip: false }, { x: 150, flip: true }]);
  assert.deepEqual(mirroredTiles(-30, 100, 100), [{ x: -70, flip: true }, { x: 30, flip: false }]);
});
