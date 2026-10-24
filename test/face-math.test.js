import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEAD_W, EYE_Y, EYE_UNIT, eyeTransform, mapPoint, faceDirection } from '../src/face-math.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('level eyes 100px apart scale to EYE_UNIT and land on the eye line', () => {
  const t = eyeTransform({ x: 200, y: 300 }, { x: 300, y: 300 });
  close(t.angle, 0);
  close(t.scale, EYE_UNIT / 100);
  const mid = mapPoint(t, { x: 250, y: 300 });
  close(mid.x, HEAD_W / 2);
  close(mid.y, EYE_Y);
});

test('swapped eyes give the same transform', () => {
  const a = eyeTransform({ x: 200, y: 310 }, { x: 300, y: 290 });
  const b = eyeTransform({ x: 300, y: 290 }, { x: 200, y: 310 });
  close(a.angle, b.angle);
  close(a.scale, b.scale);
  close(a.tx, b.tx);
  close(a.ty, b.ty);
});

test('tilted head is leveled: both eyes end on the eye line', () => {
  const e1 = { x: 100, y: 100 };
  const e2 = { x: 100 + 60, y: 100 + 60 };
  const t = eyeTransform(e1, e2);
  close(t.angle, Math.PI / 4);
  const p1 = mapPoint(t, e1);
  const p2 = mapPoint(t, e2);
  close(p1.y, EYE_Y);
  close(p2.y, EYE_Y);
  close(p1.x, HEAD_W / 2 - EYE_UNIT / 2);
  close(p2.x, HEAD_W / 2 + EYE_UNIT / 2);
});

test('zoom scales, dx/dy shift the output', () => {
  const base = eyeTransform({ x: 0, y: 0 }, { x: 100, y: 0 });
  const t = eyeTransform({ x: 0, y: 0 }, { x: 100, y: 0 }, { zoom: 2, dx: 7, dy: -3 });
  close(t.scale, base.scale * 2);
  const mid = mapPoint(t, { x: 50, y: 0 });
  close(mid.x, HEAD_W / 2 + 7);
  close(mid.y, EYE_Y - 3);
});

test('nose off the eye midpoint tells which way the face looks', () => {
  const t = eyeTransform({ x: 100, y: 100 }, { x: 200, y: 100 });
  assert.equal(faceDirection(t, { x: 130, y: 150 }), -1);
  assert.equal(faceDirection(t, { x: 170, y: 150 }), 1);
  assert.equal(faceDirection(t, { x: 152, y: 150 }), 0);
});

test('face direction is measured after leveling a tilted head', () => {
  const t = eyeTransform({ x: 0, y: 0 }, { x: 100, y: 100 });
  assert.equal(faceDirection(t, { x: 10, y: 90 }), 0);
  assert.equal(faceDirection(t, { x: -10, y: 70 }), -1);
});
