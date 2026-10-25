// The world behind the street in the 3D view: the level's ChatGPT backdrop (BACKDROP_ART in sprites.js, the same
// pictures the 2D view draws) as a sky that stays put and cut-out layers on planes at their depths, so they scroll
// slower than the street. Built once per level.
import * as THREE from 'three';
import { VIEW_W, VIEW_H } from './game.js';
import { BACKDROP_ART } from './sprites.js';
import { paintOver, landmarkSpan } from './render.js';

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
// opts: bg, gy (ground top), levelW, span(z) -> [x0, x1] the camera can see at depth z.
export function buildBackdrop(group, { bg, gy, levelW, span }) {
  generation++;
  const look = BACKDROP_ART[bg];
  // a picture standing on the ground line from x0 to x1, shown once it has loaded
  const stand = (x0, x1, h, z, material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), material);
    mesh.position.set((x0 + x1) / 2, gy - 6 + h / 2, z);
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };

  // each layer repeats mirrored, so neighbouring copies meet without a seam; its haze is painted in, not fog
  for (const l of look.layers) {
    const [lx0, lx1] = span(l.z);
    const tone = (img) => paintOver(img, look.haze, l.haze);
    const gap = l.landmark && landmarkSpan(levelW, l.landmark.w);
    const material = new THREE.MeshBasicMaterial({ alphaTest: 0.5, fog: false });
    const parts = (gap ? [[lx0, gap[0]], [gap[1], lx1]] : [[lx0, lx1]]).map(([x0, x1]) => {
      const mesh = stand(x0, x1, l.h, l.z, material);
      const uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, x0 - lx0 + uv.getX(i) * (x1 - x0)); // px from the layer's start
      return mesh;
    });
    material.map = picture(l.src, tone, (tex, img) => {
      tex.repeat.x = img.height / (l.h * img.width); // a copy per picture width
      for (const mesh of parts) mesh.visible = true;
    });
    material.map.wrapS = THREE.MirroredRepeatWrapping;
    if (gap) {
      const mark = stand(gap[0], gap[1], l.landmark.h, l.z, new THREE.MeshBasicMaterial({ alphaTest: 0.5, fog: false }));
      mark.material.map = picture(l.landmark.src, tone, () => (mark.visible = true));
    }
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
