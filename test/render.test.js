import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headFor } from '../src/render.js';

test('headFor shows the hurt and dead faces when the head has them', () => {
  const head = { img: 'normal', hurt: 'hurt', dead: 'dead' };
  assert.equal(headFor(head, {}), 'normal');
  assert.equal(headFor(head, { hurt: true }), 'hurt');
  assert.equal(headFor(head, { lying: 0.5 }), 'dead');
  assert.equal(headFor({ img: 'photo' }, { hurt: true, lying: 1 }), 'photo'); // uploaded heads have one face
});
