import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEAD_W, EYE_Y, EYE_UNIT, CHIN_Y, HEAD_FIT, eyeTransform, mapPoint, faceDirection, headFit, headSheet } from '../src/face-math.js';

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

// RGBA bytes of a w x h image with the given rects ([x0, y0, x1, y1), end exclusive) opaque
function picture(w, h, rects) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * w + x) * 4 + 3] = 255;
  }
  return data;
}

test('headFit puts the middle of the lower head on the collar point and makes the head HEAD_FIT tall', () => {
  const fit = headFit(picture(100, 100, [[20, 10, 80, 90]]), 100, 100);
  close(fit.scale, HEAD_FIT / 80);
  close(fit.x + 50 * fit.scale, HEAD_W / 2);
  close(fit.y + 90 * fit.scale, CHIN_Y);
});

test('headFit centers a 3/4 head on its jaw line, not on the chin poking forward', () => {
  // skull 0..60 wide, chin sticking out under its front part
  const fit = headFit(picture(100, 100, [[0, 10, 60, 80], [40, 80, 60, 90]]), 100, 100);
  close(fit.x + 30 * fit.scale, HEAD_W / 2);
});

test('headFit shrinks a head too wide for the canvas', () => {
  const fit = headFit(picture(100, 100, [[0, 10, 100, 80], [80, 80, 100, 90]]), 100, 100);
  close(fit.scale, HEAD_W / 100);
  close(fit.x, 0);
});

test('headFit gives null for a fully transparent picture', () => {
  assert.equal(headFit(picture(10, 10, []), 10, 10), null);
});

test('headFit gives null for a picture with no transparent surround (a photo, a JPEG)', () => {
  assert.equal(headFit(picture(10, 10, [[0, 0, 10, 10]]), 10, 10), null);
});

// opaque RGBA picture filled with `bg`, with rects ([x0, y0, x1, y1], end exclusive) painted `color`
function opaque(w, h, bg, rects) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
  for (const [x0, y0, x1, y1, color] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...color, 255], (y * w + x) * 4);
  }
  return data;
}
const MAGENTA = [253, 3, 249];
const SKIN = [230, 160, 120];

test('headSheet keys out a flat magenta background and finds the heads left to right', () => {
  const data = opaque(100, 40, MAGENTA, [[5, 10, 25, 30, SKIN], [40, 10, 60, 30, SKIN], [75, 10, 95, 30, SKIN]]);
  assert.deepEqual(headSheet(data, 100, 40), [[5, 25], [40, 60], [75, 95]]);
  assert.equal(data[3], 0); // background gone
  assert.equal(data[(20 * 100 + 10) * 4 + 3], 255); // head kept
});

test('headSheet clears letterbox bars of a screenshot', () => {
  const data = opaque(100, 40, MAGENTA, [[0, 0, 100, 3, [0, 0, 0]], [5, 10, 25, 30, SKIN], [75, 10, 95, 30, SKIN], [0, 37, 100, 40, [0, 0, 0]]]);
  assert.deepEqual(headSheet(data, 100, 40), [[5, 25], [75, 95]]);
  assert.equal(data[(1 * 100 + 50) * 4 + 3], 0);
});

test('headSheet unmixes an antialiased edge from the magenta behind it', () => {
  const data = opaque(10, 10, MAGENTA, [[2, 2, 8, 8, [0, 0, 0]], [1, 5, 2, 6, [128, 0, 128]]]);
  headSheet(data, 10, 10);
  const i = (5 * 10 + 1) * 4;
  assert.ok(data[i + 3] > 100 && data[i + 3] < 160, `alpha ${data[i + 3]}`);
  assert.ok(data[i] < 20 && data[i + 2] < 20, `rgb ${data.slice(i, i + 3)}`); // half-covered black stays black
});

test('headSheet leaves an already transparent picture alone, pink included', () => {
  const data = picture(20, 20, [[5, 5, 15, 15]]);
  data.set([255, 0, 255, 255], (10 * 20 + 10) * 4);
  assert.deepEqual(headSheet(data, 20, 20), [[5, 15]]);
  assert.equal(data[(10 * 20 + 10) * 4 + 3], 255);
});
