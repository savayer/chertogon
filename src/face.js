import { HEAD_W, HEAD_H, EYE_Y, EYE_UNIT, eyeTransform, faceDirection, headFit, headSheet } from './face-math.js';
import { ATLAS } from './sprite-atlas.js';
import { cartoon, pixelArt } from './face-style.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const SEG_MODEL = `${MODELS}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`;
const KEY = 'chertogon.head';
const KEY_DIR = 'chertogon.head.dir';
const KEY_STYLE = 'chertogon.head.style';
const KEY_FACES = { hurt: 'chertogon.head.hurt', dead: 'chertogon.head.dead' }; // extra faces of a drawn head
const STYLES = { cartoon, pixel: pixelArt }; // 'photo' = no filter
const DEFAULT_DIR = 1; // character and ready-made heads look to the right
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

// style: 'photo' | 'cartoon' | 'pixel'. Returns a new canvas.
export function stylizeHead(src, style) {
  const filter = STYLES[style];
  if (!filter) return src;
  const img = filter(src.getContext('2d').getImageData(0, 0, src.width, src.height));
  const out = canvas(img.width, img.height);
  out.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return out;
}

// head = { img: canvas | Image, dir, style, hurt?, dead? }
export function saveHead(head) {
  try {
    localStorage.setItem(KEY, head.img.toDataURL('image/png'));
    localStorage.setItem(KEY_DIR, String(head.dir));
    localStorage.setItem(KEY_STYLE, head.style);
    for (const [face, key] of Object.entries(KEY_FACES)) {
      if (head[face]) localStorage.setItem(key, head[face].toDataURL('image/png'));
      else localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('could not save head', e);
  }
}

export function clearHead() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_DIR);
    localStorage.removeItem(KEY_STYLE);
    for (const key of Object.values(KEY_FACES)) localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing to clear
  }
}

// A drawn head picture (transparent around it, hair top to chin) -> HEAD_W x HEAD_H head canvas, null if it isn't one.
function fitHead(src) {
  const g = src.getContext('2d');
  const fit = headFit(g.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
  if (!fit) return null;
  const head = canvas(HEAD_W, HEAD_H);
  head.getContext('2d').drawImage(src, fit.x, fit.y, src.width * fit.scale, src.height * fit.scale);
  return head;
}

function crop(src, x, y, w, h) {
  const c = canvas(w, h);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

// A ready-made head drawn in the game's style (e.g. by ChatGPT), looking right: a transparent PNG
// or a flat magenta background, one head or a row of three (normal, hurt, dead). Null if no head is found.
export async function readyHead(file) {
  const src = await loadImage(file);
  const g = src.getContext('2d');
  const pic = g.getImageData(0, 0, src.width, src.height);
  const spans = headSheet(pic.data, src.width, src.height);
  g.putImageData(pic, 0, 0);
  const [img, hurt, dead] = spans.slice(0, 3).map(([x0, x1]) => fitHead(crop(src, x0, 0, x1 - x0, src.height)));
  return img ? { img, hurt, dead, dir: DEFAULT_DIR, style: 'sprite' } : null;
}

export const CHARACTERS = ATLAS.heads.chars; // the first is the default

// A character's head from the sprite sheet, with its hurt and dead faces.
export async function characterHead(id) {
  const i = Math.max(0, CHARACTERS.indexOf(id));
  const sheet = await imageFrom(ATLAS.heads.src);
  const faces = ATLAS.heads.frames.slice(i * 3, i * 3 + 3);
  const [img, hurt, dead] = faces.map((f) => fitHead(crop(sheet, f.x, f.y, f.w, f.h)));
  return { img, hurt, dead, dir: DEFAULT_DIR, style: 'sprite', character: CHARACTERS[i] };
}

// The uploaded head if there is one, else the character's.
export async function loadHead(character) {
  let saved = null;
  let dir = 0;
  let style = 'photo';
  const faces = {};
  try {
    saved = localStorage.getItem(KEY);
    dir = Number(localStorage.getItem(KEY_DIR)) || 0;
    style = localStorage.getItem(KEY_STYLE) || style;
    for (const [face, key] of Object.entries(KEY_FACES)) faces[face] = localStorage.getItem(key);
  } catch {
    // storage blocked: use default
  }
  if (saved) {
    try {
      const head = { img: await imageFrom(saved), dir, style };
      for (const [face, url] of Object.entries(faces)) if (url) head[face] = await imageFrom(url);
      return head;
    } catch {
      clearHead();
    }
  }
  return characterHead(character);
}
