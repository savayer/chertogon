// Sprite sheets cut from the art in assets/sprites (frame data in sprite-atlas.js).
// Images are created in loadSprites(), called by main.js, so this module also imports in node tests.
import { ATLAS } from './sprite-atlas.js';

const images = {};

// The city backdrops of both views by level backdrop: ChatGPT art, sources in docs/gen. The sky stays put behind
// everything, darkened by skyDim; layers are cut-out pictures, far to near, standing on the ground line: z is
// their depth in the 3D view (the 2D view scrolls them at the speed that depth gives), h their height in world px,
// haze how much of the level's haze colour is painted over them, so they stay behind the characters. A layer's
// landmark (w x h world px, one picture, not repeated) takes its place where the boss is fought.
export const BACKDROP_ART = {
  street: {
    sky: 'assets/backdrops/street-sky.png', skyDim: 0.18, haze: '#4a3563',
    layers: [{
      src: 'assets/backdrops/street-near.png', z: -250, h: 380, haze: 0.6,
      landmark: { src: 'assets/backdrops/street-opera.png', h: 400, w: 780 }, // Buryat Opera and Ballet Theatre, Ulan-Ude
    }],
  },
  garages: {
    sky: 'assets/backdrops/garages-sky.png', skyDim: 0.18, haze: '#2e3352',
    layers: [
      {
        src: 'assets/backdrops/garages-houses.png', z: -450, h: 400, haze: 0.55,
        landmark: { src: 'assets/backdrops/garages-geser.png', h: 500, w: 798 }, // the Geser monument, Ulan-Ude
      },
      { src: 'assets/backdrops/garages-front.png', z: -140, h: 140, haze: 0.3 },
    ],
  },
  hell: {
    sky: 'assets/backdrops/hell-sky.png', skyDim: 0.3, haze: '#3a0d12', // the fire is loud: toned down more
    layers: [{
      src: 'assets/backdrops/hell-near.png', z: -250, h: 380, haze: 0.62,
      landmark: { src: 'assets/backdrops/hell-square.png', h: 420, w: 832 }, // Square of the Soviets, Ulan-Ude, a devil's head for Lenin's
    }],
  },
};
const art = {}; // src -> Image

export function loadSprites() {
  for (const [name, sheet] of Object.entries(ATLAS)) {
    images[name] = new Image();
    images[name].src = sheet.src;
  }
  for (const look of Object.values(BACKDROP_ART)) {
    for (const src of [look.sky, ...look.layers.flatMap((l) => [l.src, l.landmark?.src].filter(Boolean))]) {
      art[src] = new Image();
      art[src].src = src;
    }
  }
}

// A backdrop picture once it has loaded, else null.
export const artImage = (src) => (art[src]?.complete && art[src].naturalWidth ? art[src] : null);

// Draws frame i of a sheet with its anchor at the current origin, in world px. Skipped until the image loads.
export function drawSprite(ctx, name, i) {
  const img = images[name];
  if (!img?.complete || !img.naturalWidth) return;
  const { res, frames } = ATLAS[name];
  const f = frames[i];
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, f.x, f.y, f.w, f.h, -f.ax / res, -f.ay / res, f.w / res, f.h / res);
}

const RUN_STEP = 26; // world px walked per run frame: 10 frames/s at full speed (faster looked twitchy)

// Hero frames: 0 idle, 1-8 run, 9 throw, 10 jump, 11 fall, 12 hurt (also lying dead).
export function heroFrame({ moving, throwing, airborne, rising, hurt, lying }, walk) {
  if (hurt || lying) return 12;
  if (throwing) return 9;
  if (airborne) return rising ? 10 : 11;
  if (moving) return 1 + (Math.floor(walk / RUN_STEP) % 8);
  return 0;
}

// Where the head's chin goes in hero frame i, relative to the feet anchor, world px.
export function heroChin(i) {
  const { res, frames } = ATLAS.hero;
  const f = frames[i];
  return [(f.nx - f.ax) / res, (f.ny - f.ay) / res];
}

export const itemFrame = (kind) => ATLAS.items.kinds.indexOf(kind);

// Plane for frame i of a sheet whose texture is texW x texH px: size in world px, its center relative to
// the anchor (y up), and UVs for a texture with flipY.
export function frameQuad(name, i, texW, texH) {
  const { res, frames } = ATLAS[name];
  const f = frames[i];
  return {
    w: f.w / res, h: f.h / res,
    cx: (f.w / 2 - f.ax) / res, cy: (f.ay - f.h / 2) / res,
    u0: f.x / texW, u1: (f.x + f.w) / texW,
    v0: 1 - (f.y + f.h) / texH, v1: 1 - f.y / texH,
  };
}

// Imp frames: 4-step walk; the fire imp has 2 walk frames and 2 spitting ones.
export function demonFrame(e, time) {
  if (!e.shooter) return Math.floor(time * 8) % 4;
  // mouth opens on the wind-up so the player sees the flame coming
  if (e.hold) return e.shootT < 0.45 ? 2 + (Math.floor(time * 10) % 2) : 0;
  return Math.floor(time * 6) % 2;
}

// Boss frames: 0-1 walk, 2 jump, 3 hurt (boss 0, who doesn't shoot) or shooting (bosses 1 and 2).
export function bossFrame(b, index, time) {
  if (index === 0 ? b.hurt > 0 : b.active && b.shootEvery - b.shootT < 0.3) return 3;
  return !b.onGround ? 2 : b.vx ? Math.floor(time * 5) % 2 : 0;
}
