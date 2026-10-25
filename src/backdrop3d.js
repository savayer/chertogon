// The world behind the street in the 3D view: the level's ChatGPT backdrop (BACKDROP_ART in sprites.js, the same
// pictures the 2D view draws) as a sky that stays put and cut-out layers on planes at their depths, so they scroll
// slower than the street. Built once per level.
import * as THREE from 'three';
import { VIEW_W, VIEW_H } from './game.js';
import { BACKDROP_ART } from './sprites.js';
import { paintOver } from './render.js';

// The 3D view's own lights per backdrop.
const LIGHTS = {
  street: { hemi: ['#c9a6d6', '#3a2638'], light: '#ffa870' },
  garages: { hemi: ['#a6b0d6', '#2a2a3a'], light: '#ffb88a' },
  hell: { hemi: ['#d8b0a8', '#2a1414'], light: '#ffa070' }, // not too red: the demons are
};
let generation = 0; // a picture that loads after its level was rebuilt is dropped

export function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// An empty texture that gets picture src, toned by tone(img) -> canvas, once it has loaded.
function picture(src, tone, onLoad) {
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  const gen = generation;
  const img = new Image();
  img.onload = () => {
    if (gen !== generation) return;
    tex.image = tone(img);
    tex.needsUpdate = true;
    onLoad(tex, img);
  };
  img.src = src;
  return tex;
}

// Fills group and returns the look: { sky, fog, hemi: [sky, ground], light }.
// opts: bg, gy (ground top), span(z) -> [x0, x1] the camera can see at depth z.
export function buildBackdrop(group, { bg, gy, span }) {
  generation++;
  const look = BACKDROP_ART[bg];

  // each layer repeats mirrored, so neighbouring copies meet without a seam; its haze is painted in, not fog
  for (const l of look.layers) {
    const [lx0, lx1] = span(l.z);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lx1 - lx0, l.h));
    mesh.material = new THREE.MeshBasicMaterial({ alphaTest: 0.5, fog: false });
    mesh.material.map = picture(l.src, (img) => paintOver(img, look.haze, l.haze), (tex, img) => {
      tex.repeat.x = (lx1 - lx0) / ((l.h * img.width) / img.height);
      mesh.visible = true;
    });
    mesh.material.map.wrapS = THREE.MirroredRepeatWrapping;
    mesh.position.set((lx0 + lx1) / 2, gy - 6 + l.h / 2, l.z);
    mesh.visible = false;
    group.add(mesh);
  }

  // the sky fills the screen and stays put: its 3:2 picture loses a strip at the top and bottom
  const sky = picture(look.sky, (img) => paintOver(img, '#000', look.skyDim), (tex, img) => {
    const k = img.width / img.height / (VIEW_W / VIEW_H);
    tex.repeat.y = k;
    tex.offset.y = (1 - k) / 2;
  });
  const lights = LIGHTS[bg];
  return { sky, fog: new THREE.Fog(look.haze, 1100, 2600), hemi: lights.hemi, light: lights.light };
}
