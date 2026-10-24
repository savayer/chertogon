// Head contract: every head image is HEAD_W x HEAD_H, eye midpoint at (HEAD_W/2, EYE_Y),
// eyes EYE_UNIT px apart, chin at CHIN_Y; the rest is margin for zooming. The body puts CHIN_Y on its collar.
export const HEAD_W = 200;
export const HEAD_H = 240;
export const EYE_Y = 125;
export const EYE_UNIT = 50;
export const CHIN_Y = EYE_Y + EYE_UNIT * 1.9;
export const HEAD_FIT = 185; // hair top to chin of a drawn head, like a photo head's
const JAW = 0.75;

// Fits a drawn head (RGBA bytes, opaque from hair top to chin, no neck) into the head contract: HEAD_FIT tall,
// bottom on CHIN_Y, never wider than the canvas, and centered on its jaw line (the row at JAW of its height),
// which sits over the neck; a 3/4 head's chin pokes forward, so centering on the chin pushes the skull back.
// Returns where to draw the w x h picture: x, y and scale. Null if nothing is opaque or nothing is transparent.
export function headFit(data, w, h) {
  const solid = (x, y) => data[(y * w + x) * 4 + 3] >= 128;
  let top = h, bottom = -1, left = w, right = -1, opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      opaque++;
      top = Math.min(top, y);
      bottom = y;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (bottom < 0 || opaque === w * h) return null;
  const jawY = Math.floor(top + (bottom + 1 - top) * JAW);
  let jawL = right, jawR = left;
  for (let x = left; x <= right; x++) {
    if (solid(x, jawY)) {
      jawL = Math.min(jawL, x);
      jawR = x;
    }
  }
  const midX = (jawL + jawR + 1) / 2;
  const chinY = bottom + 1;
  const scale = Math.min(HEAD_FIT / (chinY - top), HEAD_W / 2 / (midX - left), HEAD_W / 2 / (right + 1 - midX));
  return { x: HEAD_W / 2 - midX * scale, y: CHIN_Y - chinY * scale, scale };
}

// Maps source photo -> head canvas: out = R(-angle) * (p - mid) * scale + (tx, ty).
export function eyeTransform(eyeA, eyeB, adj = {}) {
  const { zoom = 1, dx = 0, dy = 0 } = adj;
  const [l, r] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
  const dist = Math.hypot(r.x - l.x, r.y - l.y) || 1;
  return {
    angle: Math.atan2(r.y - l.y, r.x - l.x),
    scale: (EYE_UNIT / dist) * zoom,
    tx: HEAD_W / 2 + dx,
    ty: EYE_Y + dy,
    midX: (l.x + r.x) / 2,
    midY: (l.y + r.y) / 2,
  };
}

// Which way the face looks once leveled: -1 left, 1 right, 0 frontal. Nose shifts toward the gaze.
export function faceDirection(t, nose) {
  const off = (mapPoint(t, nose).x - t.tx) / EYE_UNIT;
  return Math.abs(off) < 0.1 ? 0 : Math.sign(off);
}

export function mapPoint(t, p) {
  const x = p.x - t.midX;
  const y = p.y - t.midY;
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  return {
    x: (x * c + y * s) * t.scale + t.tx,
    y: (-x * s + y * c) * t.scale + t.ty,
  };
}

// A ready-made head picture -> column spans [x0, x1) of its heads, left to right (one head, or normal/hurt/dead).
// ChatGPT can't draw transparency, so an opaque picture gets its flat magenta background keyed out
// (edges unmixed from it) and full-width/height bars, like a screenshot's letterbox, cleared. Edits data in place.
export function headSheet(data, w, h) {
  const opaqueAt = (x, y) => data[(y * w + x) * 4 + 3] >= 128;
  let transparent = false;
  for (let i = 3; i < data.length && !transparent; i += 4) transparent = data[i] < 128;
  if (!transparent) {
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const a = Math.min(1, Math.max(0, (235 - (Math.min(r, b) - g)) / 205));
      const k = a || 1;
      data[i] = (r - (1 - a) * 255) / k;
      data[i + 1] = g / k;
      data[i + 2] = (b - (1 - a) * 255) / k;
      data[i + 3] = a * 255;
    }
    const clear = (x, y) => { data[(y * w + x) * 4 + 3] = 0; };
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w && opaqueAt(x, y)) x++;
      if (x === w) for (x = 0; x < w; x++) clear(x, y);
    }
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h && opaqueAt(x, y)) y++;
      if (y === h) for (y = 0; y < h; y++) clear(x, y);
    }
  }
  const spans = [];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h && !opaqueAt(x, y)) y++;
    if (y === h) continue;
    const last = spans.at(-1);
    if (last && x - last[1] < w * 0.01) last[1] = x + 1; // a stray hair still belongs to its head
    else spans.push([x, x + 1]);
  }
  return spans.filter(([x0, x1]) => x1 - x0 >= w * 0.04);
}
