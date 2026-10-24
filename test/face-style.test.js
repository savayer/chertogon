import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelate, posterizeLuma, outline, blur, saturate, compressLuma, cartoon, pixelArt } from '../src/face-style.js';

// ImageData-like test image; fill(x, y) -> [r, g, b, a]
function image(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const luma = ([r, g, b]) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

test('pixelate makes every block one color and hardens alpha', () => {
  const src = image(16, 16, (x, y) => [x * 16, y * 16, 100, x < 8 ? 255 : (y < 6 ? 255 : 0)]);
  const out = pixelate(src, 8);
  for (const [bx, by] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
    const first = px(out, bx, by);
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) assert.deepEqual(px(out, x, y), first);
  }
  assert.equal(px(out, 0, 0)[3], 255);
  assert.equal(px(out, 8, 8)[3], 0); // fully transparent block stays transparent
  assert.equal(px(out, 8, 0)[3], 255); // 6 of 8 rows opaque: majority wins
});

test('posterizeLuma leaves at most `levels` brightness bands and skips transparent pixels', () => {
  const src = image(64, 1, (x) => [x * 4, x * 4, x * 4, x === 63 ? 0 : 255]);
  const out = posterizeLuma(src, 4);
  const bands = new Set();
  for (let x = 0; x < 63; x++) bands.add(luma(px(out, x, 0)));
  assert.ok(bands.size <= 4, `got ${bands.size} bands: ${[...bands]}`);
  assert.deepEqual(px(out, 63, 0), px(src, 63, 0));
});

test('outline paints an ink ring of the given thickness around opaque pixels', () => {
  const src = image(11, 11, (x, y) => (x === 5 && y === 5 ? [200, 150, 100, 255] : [0, 0, 0, 0]));
  const out = outline(src, 2);
  assert.deepEqual(px(out, 5, 5), [200, 150, 100, 255]);
  assert.deepEqual(px(out, 7, 7), [17, 17, 17, 255]);
  assert.deepEqual(px(out, 3, 5), [17, 17, 17, 255]);
  assert.equal(px(out, 8, 5)[3], 0);
});

test('blur keeps a uniform opaque area uniform and does not darken its edge', () => {
  const src = image(10, 10, (x) => (x < 6 ? [200, 100, 50, 255] : [0, 0, 0, 0]));
  const out = blur(src, 1);
  assert.deepEqual(px(out, 2, 5).slice(0, 3), [200, 100, 50]);
  assert.deepEqual(px(out, 5, 5).slice(0, 3), [200, 100, 50]); // edge pixel: color kept, only alpha softens
});

test('cartoon and pixel styles keep size and add an ink outline', () => {
  const face = image(40, 48, (x, y) => ((x - 20) ** 2 / 225 + (y - 24) ** 2 / 361 <= 1 ? [230, 190, 160, 255] : [0, 0, 0, 0]));
  for (const style of [cartoon, pixelArt]) {
    const out = style(face);
    assert.equal(out.width, 40);
    assert.equal(out.height, 48);
    assert.deepEqual(px(out, 20, 2).slice(0, 3), [17, 17, 17]); // just above the top of the oval
  }
});

test('posterizeLuma floor keeps the darkest band light', () => {
  const src = image(1, 1, () => [10, 10, 10, 255]);
  const out = posterizeLuma(src, 3, 0.35);
  assert.ok(luma(px(out, 0, 0)) >= 0.35 * 255, `luma ${luma(px(out, 0, 0))}`);
});

test('saturate pushes colors away from gray and leaves gray alone', () => {
  const src = image(2, 1, (x) => (x === 0 ? [128, 128, 128, 255] : [180, 120, 100, 255]));
  const out = saturate(src, 1.5);
  assert.deepEqual(px(out, 0, 0), [128, 128, 128, 255]);
  const [r, g, b] = px(out, 1, 0);
  assert.ok(r - b > 80, `spread ${r - b}`);
});

test('compressLuma evens out side lighting: keeps the mean, shrinks the spread', () => {
  const src = image(4, 1, (x) => [[40, 40, 40, 255], [100, 100, 100, 255], [160, 160, 160, 255], [220, 220, 220, 255]][x]);
  const out = compressLuma(src, 0.5);
  const ys = [0, 1, 2, 3].map((x) => luma(px(out, x, 0)));
  assert.ok(Math.abs(ys.reduce((a, b) => a + b) / 4 - 130) <= 1, `mean ${ys}`);
  assert.ok(Math.abs(ys[3] - ys[0] - 90) <= 2, `spread ${ys[3] - ys[0]}`);
});
