// Pure pixel filters that make a photo head look drawn, so it matches the cartoon body.
// Images are ImageData-like { width, height, data: Uint8ClampedArray RGBA }; every filter returns a new one.
const INK = [17, 17, 17]; // head outline, same as the body's
const LINE = [40, 25, 22]; // facial feature lines: softer than the outline
const SOLID = 128; // alpha at or above this counts as part of the head

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Alpha-weighted box blur, so transparent surroundings don't bleed dark color into the face edge.
export function blur(img, r) {
  const { width: w, height: h, data } = img;
  let buf = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = data[i + 3] / 255;
    buf[i] = data[i] * a;
    buf[i + 1] = data[i + 1] * a;
    buf[i + 2] = data[i + 2] * a;
    buf[i + 3] = data[i + 3];
  }
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const out = new Float32Array(buf.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        const o = (y * w + x) * 4;
        for (let k = -r; k <= r; k++) {
          const sx = x + k * dx;
          const sy = y + k * dy;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const s = (sy * w + sx) * 4;
          for (let c = 0; c < 4; c++) out[o + c] += buf[s + c];
          n++;
        }
        for (let c = 0; c < 4; c++) out[o + c] /= n;
      }
    }
    buf = out;
  }
  const res = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < res.length; i += 4) {
    const a = buf[i + 3];
    if (a <= 0) continue;
    const k = 255 / a;
    res[i] = buf[i] * k;
    res[i + 1] = buf[i + 1] * k;
    res[i + 2] = buf[i + 2] * k;
    res[i + 3] = a;
  }
  return { width: w, height: h, data: res };
}

// Flattens shading into `levels` brightness bands (centered, so skin never turns pure white) and keeps hue.
// floor (0..1) lifts the darkest band: flat, light cartoon fills instead of muddy shadows.
export function posterizeLuma(img, levels, floor = 0) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const y = luma(data, i);
    const band = Math.min(levels - 1, Math.floor((y / 256) * levels));
    const target = (floor + (1 - floor) * ((band + 0.5) / levels)) * 255;
    if (y < 1) {
      data.fill(target, i, i + 3); // pure black has no hue to keep
      continue;
    }
    const k = target / y;
    data[i] *= k;
    data[i + 1] *= k;
    data[i + 2] *= k;
  }
  return { width: img.width, height: img.height, data };
}

// Pulls every pixel's brightness toward the head's mean by factor k (hue kept): evens out side lighting,
// so one half of the face doesn't turn into a dark blotch.
export function compressLuma(img, k) {
  const data = new Uint8ClampedArray(img.data);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < SOLID) continue;
    sum += luma(data, i);
    n++;
  }
  const mean = n ? sum / n : 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const y = luma(data, i);
    const target = mean + (y - mean) * k;
    if (y < 1) {
      data.fill(target, i, i + 3);
      continue;
    }
    const s = target / y;
    data[i] *= s;
    data[i + 1] *= s;
    data[i + 2] *= s;
  }
  return { width: img.width, height: img.height, data };
}

const mix = (a, b, t) => {
  const data = new Uint8ClampedArray(a.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = a.data[i + c] * (1 - t) + b.data[i + c] * t;
  }
  return { width: a.width, height: a.height, data };
};

// Pushes each color away from its own gray by factor k.
export function saturate(img, k) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data, i);
    for (let c = 0; c < 3; c++) data[i + c] = y + (data[i + c] - y) * k;
  }
  return { width: img.width, height: img.height, data };
}

// Draws ink on the strongest brightness edges (Sobel) of `edgesFrom`, inside the head only: the top `share`
// of edge pixels, so eyes, brows and mouth get lines on any photo; flat areas (below MIN_EDGE) never do.
const MIN_EDGE = 60;
function inkEdges(img, edgesFrom, share, ink = INK) {
  const { width: w, height: h } = img;
  const src = edgesFrom.data;
  const data = new Uint8ClampedArray(img.data);
  const L = (x, y, fallback) => {
    const i = (y * w + x) * 4;
    return src[i + 3] >= SOLID ? luma(src, i) : fallback; // silhouette is the outline's job
  };
  const mag = new Float32Array(w * h);
  const solidMags = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] < SOLID) continue;
      const c = luma(src, i);
      const gx = L(x + 1, y - 1, c) + 2 * L(x + 1, y, c) + L(x + 1, y + 1, c) - L(x - 1, y - 1, c) - 2 * L(x - 1, y, c) - L(x - 1, y + 1, c);
      const gy = L(x - 1, y + 1, c) + 2 * L(x, y + 1, c) + L(x + 1, y + 1, c) - L(x - 1, y - 1, c) - 2 * L(x, y - 1, c) - L(x + 1, y - 1, c);
      mag[y * w + x] = Math.hypot(gx, gy);
      solidMags.push(mag[y * w + x]);
    }
  }
  solidMags.sort((a, b) => a - b);
  const threshold = Math.max(MIN_EDGE, solidMags[Math.floor(solidMags.length * (1 - share))] ?? Infinity);
  for (let p = 0; p < w * h; p++) if (mag[p] > threshold) data.set(ink, p * 4);
  return { width: w, height: h, data };
}

// Ink ring `t` px thick (square neighbourhood) around everything solid. Dilation is separable: rows, then columns.
export function outline(img, t, ink = INK) {
  const { width: w, height: h } = img;
  const solid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) solid[p] = img.data[p * 4 + 3] >= SOLID ? 1 : 0;
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = Math.max(0, x - t); k <= Math.min(w - 1, x + t) && !rows[y * w + x]; k++) rows[y * w + x] = solid[y * w + k];
    }
  }
  const data = new Uint8ClampedArray(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (solid[p]) continue;
      for (let k = Math.max(0, y - t); k <= Math.min(h - 1, y + t); k++) {
        if (rows[k * w + x]) {
          data.set([...ink, 255], p * 4);
          break;
        }
      }
    }
  }
  return { width: w, height: h, data };
}

// Each block x block square becomes its average color; alpha snaps to fully on or off by majority.
export function pixelate(img, block) {
  const { width: w, height: h } = img;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let y = by; y < Math.min(h, by + block); y++) {
        for (let x = bx; x < Math.min(w, bx + block); x++) {
          const i = (y * w + x) * 4;
          const a = img.data[i + 3];
          sum[0] += img.data[i] * a;
          sum[1] += img.data[i + 1] * a;
          sum[2] += img.data[i + 2] * a;
          sum[3] += a;
          n++;
        }
      }
      const color = sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : [0, 0, 0];
      const px = [...color, sum[3] / n >= SOLID ? 255 : 0];
      for (let y = by; y < Math.min(h, by + block); y++) {
        for (let x = bx; x < Math.min(w, bx + block); x++) data.set(px, (y * w + x) * 4);
      }
    }
  }
  return { width: w, height: h, data };
}

// Readable toon: even light, half-flattened shading, thin lines on the strongest features, ink outline.
export function cartoon(img) {
  const flat = compressLuma(saturate(blur(img, 1), 1.1), 0.6);
  const toon = mix(flat, posterizeLuma(flat, 5, 0.2), 0.5);
  return outline(inkEdges(toon, blur(img, 2), 0.045, LINE), 5);
}

export function pixelArt(img) {
  return outline(posterizeLuma(pixelate(img, 6), 5), 6);
}
