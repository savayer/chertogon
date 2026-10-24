// Sprite sheets cut from the art in assets/sprites (frame data in sprite-atlas.js).
// Images are created in loadSprites(), called by main.js, so this module also imports in node tests.
import { ATLAS } from './sprite-atlas.js';

const images = {};

export function loadSprites() {
  for (const [name, sheet] of Object.entries(ATLAS)) {
    images[name] = new Image();
    images[name].src = sheet.src;
  }
}

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
