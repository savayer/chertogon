// Head contract: every head image is HEAD_W x HEAD_H, eye midpoint at (HEAD_W/2, EYE_Y),
// eyes EYE_UNIT px apart, chin at CHIN_Y; the rest is margin for zooming. The body puts CHIN_Y on its collar.
export const HEAD_W = 200;
export const HEAD_H = 240;
export const EYE_Y = 125;
export const EYE_UNIT = 50;
export const CHIN_Y = EYE_Y + EYE_UNIT * 1.9;

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
