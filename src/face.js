import { HEAD_W, HEAD_H, EYE_Y, EYE_UNIT, CHIN_Y, eyeTransform, faceDirection } from './face-math.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const SEG_MODEL = `${MODELS}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`;
const KEY = 'chertogon.head';
const KEY_DIR = 'chertogon.head.dir';
const DEFAULT_DIR = 1; // the drawn default head looks to the right
const SS = 3; // cutout resolution multiplier, keeps detail when zooming in
const CTX = 1.6; // how much wider than the final head the segmenter sees
const HAIR = 1;
const BODY_SKIN = 2;
const FACE_SKIN = 3;
const ACCESSORIES = 5;

let tasks = null;

// Lazy: ~27 MB of wasm + models, only when someone uploads a photo.
function loadTasks() {
  tasks ??= (async () => {
    const { FilesetResolver, FaceDetector, ImageSegmenter } = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = (delegate) => Promise.all([
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: 'IMAGE',
      }),
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    ]);
    const [detector, segmenter] = await make('GPU').catch(() => make('CPU'));
    return { detector, segmenter };
  })();
  tasks.catch(() => { tasks = null; });
  return tasks;
}

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

const imageFrom = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// Downscaled to <= 1280px so phone photos don't choke detection. <img> applies EXIF rotation.
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await imageFrom(url);
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fallbackEyes(img) {
  return {
    eyeA: { x: img.width * 0.4, y: img.height * 0.4 },
    eyeB: { x: img.width * 0.6, y: img.height * 0.4 },
  };
}

// Biggest face wins. Keypoints (normalized): 0/1 eyes (order fixed later by x), 2 nose tip.
export async function detectFace(img) {
  const { detector } = await loadTasks();
  const { detections } = detector.detect(img);
  const area = (d) => (d.boundingBox?.width ?? 0) * (d.boundingBox?.height ?? 0);
  const best = detections.reduce((a, d) => (!a || area(d) > area(a) ? d : a), null);
  if (!best || best.keypoints.length < 3) return null;
  const [k0, k1, k2] = best.keypoints;
  return {
    eyeA: { x: k0.x * img.width, y: k0.y * img.height },
    eyeB: { x: k1.x * img.width, y: k1.y * img.height },
    nose: { x: k2.x * img.width, y: k2.y * img.height },
  };
}

// Cut space: the aligned photo zoomed out by CTX, so the model sees shoulders and background
// around the head (it fails on tight close-ups). Contract point (u, v) lands at
// (W/2 + (u - HEAD_W/2) * SS / CTX, (EYE_Y + (v - EYE_Y) / CTX) * SS).
const cutY = (v) => (EYE_Y + (v - EYE_Y) / CTX) * SS;

function segmentHead(segmenter, src) {
  const res = segmenter.segment(src);
  try {
    const m = res.confidenceMasks;
    const w = m[0].width;
    const h = m[0].height;
    const hair = m[HAIR].getAsFloat32Array();
    const face = m[FACE_SKIN].getAsFloat32Array();
    const acc = m[ACCESSORIES].getAsFloat32Array();
    const body = m[BODY_SKIN].getAsFloat32Array();
    // Bald scalp and ears come out as body-skin; take it only above nose level so the neck stays out.
    const scalpRows = Math.floor((cutY(EYE_Y + EYE_UNIT * 0.6) / src.height) * h);
    const data = new Float32Array(hair.length);
    for (let i = 0; i < data.length; i++) {
      data[i] = hair[i] + face[i] + acc[i] + (i < scalpRows * w ? body[i] : 0);
    }
    return { data, w, h };
  } finally {
    res.close();
  }
}

function applyAlpha(c, mask) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  const { width: W, height: H } = c;
  const oy = cutY(EYE_Y);
  const rx = (EYE_UNIT * 1.6 * SS) / CTX;
  const ry = (EYE_UNIT * 2 * SS) / CTX;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Soft head-sized oval keeps stray blobs (other people, background hair) out.
      const r = Math.hypot((x - W / 2) / rx, (y - oy) / ry);
      let a = Math.min(1, Math.max(0, (1.06 - r) * 12));
      if (mask) {
        const v = mask.data[Math.floor((y * mask.h) / H) * mask.w + Math.floor((x * mask.w) / W)];
        a *= Math.min(1, Math.max(0, (v - 0.3) / 0.4));
      } else {
        a *= Math.min(1, Math.max(0, (0.95 - r) * 12));
      }
      const i = (y * W + x) * 4 + 3;
      px[i] = px[i] * a;
    }
  }
  g.putImageData(img, 0, 0);
}

// Once per photo: aligned + segmented cutout and which way the face looks (-1/0/1).
// Without the model the head is cut as an oval.
export async function cutHead(img, eyes) {
  const t = eyeTransform(eyes.eyeA, eyes.eyeB, { zoom: 1 / CTX });
  const cut = canvas(HEAD_W * SS, HEAD_H * SS);
  const g = cut.getContext('2d');
  g.scale(SS, SS);
  g.translate(t.tx, t.ty);
  g.scale(t.scale, t.scale);
  g.rotate(-t.angle);
  g.translate(-t.midX, -t.midY);
  g.drawImage(img, 0, 0);

  let mask = null;
  try {
    const { segmenter } = await loadTasks();
    mask = segmentHead(segmenter, cut);
  } catch (e) {
    console.warn('segmentation unavailable, using oval cut', e);
  }
  applyAlpha(cut, mask);
  const dir = eyes.nose ? faceDirection(eyeTransform(eyes.eyeA, eyes.eyeB), eyes.nose) : 0;
  return { cut, segmented: !!mask, dir };
}

// Cheap, runs on every slider move: frames the cutout into a HEAD_W x HEAD_H head.
export function frameHead(cut, adj = {}) {
  const { zoom = 1, dx = 0, dy = 0 } = adj;
  const head = canvas(HEAD_W, HEAD_H);
  const g = head.getContext('2d');
  const k = (CTX * zoom) / SS;
  g.translate(HEAD_W / 2 + dx, EYE_Y + dy);
  g.scale(k, k);
  g.translate((-HEAD_W / 2) * SS, -EYE_Y * SS);
  g.drawImage(cut, 0, 0);
  return head;
}

// head = { img: canvas | Image, dir }
export function saveHead(head) {
  try {
    localStorage.setItem(KEY, head.img.toDataURL('image/png'));
    localStorage.setItem(KEY_DIR, String(head.dir));
  } catch (e) {
    console.warn('could not save head', e);
  }
}

export function clearHead() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_DIR);
  } catch {
    // storage blocked: nothing to clear
  }
}

// Neutral cartoon head drawn straight into the head contract, in the body's ink style.
function drawDefaultHead() {
  const c = canvas(HEAD_W, HEAD_H);
  const g = c.getContext('2d');
  const cx = HEAD_W / 2;
  const u = EYE_UNIT;
  const shape = (draw, fill, lw = 4) => {
    g.beginPath();
    draw();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.lineWidth = lw;
    g.stroke();
  };
  g.strokeStyle = '#111';
  g.lineJoin = 'round';
  g.lineCap = 'round';

  for (const side of [-1, 1]) shape(() => g.ellipse(cx + side * 1.42 * u, EYE_Y + 10, 12, 18, 0, 0, Math.PI * 2), '#f3d9c0');
  const top = EYE_Y - 1.6 * u;
  shape(() => g.ellipse(cx, (top + CHIN_Y) / 2, 1.45 * u, (CHIN_Y - top) / 2, 0, 0, Math.PI * 2), '#f3d9c0');

  g.globalAlpha = 0.35;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(cx + side * u, EYE_Y + 38, 10, 0, Math.PI * 2);
    g.fillStyle = '#ef9a9a';
    g.fill();
  }
  g.globalAlpha = 1;

  shape(() => {
    g.moveTo(cx - 1.5 * u, EYE_Y - 0.45 * u);
    g.bezierCurveTo(cx - 1.6 * u, EYE_Y - 2.3 * u, cx + 1.6 * u, EYE_Y - 2.3 * u, cx + 1.5 * u, EYE_Y - 0.45 * u);
    g.quadraticCurveTo(cx + u, EYE_Y - u, cx + 0.5 * u, EYE_Y - 0.85 * u);
    g.quadraticCurveTo(cx, EYE_Y - 1.25 * u, cx - 0.4 * u, EYE_Y - 0.9 * u);
    g.quadraticCurveTo(cx - u, EYE_Y - 1.2 * u, cx - 1.5 * u, EYE_Y - 0.45 * u);
    g.closePath();
  }, '#4e342e');

  for (const side of [-1, 1]) {
    const x = cx + side * 0.5 * u;
    shape(() => g.ellipse(x, EYE_Y, 12, 14, 0, 0, Math.PI * 2), '#fff', 3);
    g.beginPath();
    g.arc(x + 4, EYE_Y + 1, 6.5, 0, Math.PI * 2);
    g.fillStyle = '#111';
    g.fill();
    g.beginPath();
    g.arc(x + 6, EYE_Y - 2, 2, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    shape(() => {
      g.moveTo(x - 12, EYE_Y - 25);
      g.lineTo(x + 10, EYE_Y - 28);
    }, null, 5);
  }
  shape(() => {
    g.moveTo(cx + 6, EYE_Y + 12);
    g.quadraticCurveTo(cx + 22, EYE_Y + 32, cx + 6, EYE_Y + 36);
  });
  shape(() => g.arc(cx + 6, EYE_Y + 50, 18, 0.2 * Math.PI, 0.8 * Math.PI));
  return c;
}

export async function loadHead() {
  let saved = null;
  let dir = 0;
  try {
    saved = localStorage.getItem(KEY);
    dir = Number(localStorage.getItem(KEY_DIR)) || 0;
  } catch {
    // storage blocked: use default
  }
  if (saved) {
    try {
      return { img: await imageFrom(saved), dir };
    } catch {
      clearHead();
    }
  }
  return { img: drawDefaultHead(), dir: DEFAULT_DIR };
}
