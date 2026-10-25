// 3D view: draws the same state as render.js as a Three.js scene seen straight from the side.
// Blocks, backdrop and lights are 3D; characters, items and the head stay sprites on planes at z=0.
// main.js loads it with import() only for the 3D view: 'three' comes from the importmap in index.html.
// Scene axes: x as in the game, y up (level bottom at 0), z towards the camera.
import * as THREE from 'three';
import { TILE, VIEW_W, VIEW_H } from './game.js';
import { HEAD_W, HEAD_H, CHIN_Y } from './face-math.js';
import { ATLAS } from './sprite-atlas.js';
import { frameQuad, heroFrame, heroChin, itemFrame, demonFrame, bossFrame, BACKDROP_ART } from './sprites.js';
import { HEAD_SCALE, CAMERA_FOV, CAMERA_DIST, headFor, heroOpts, streetTile, slabTile } from './render.js';
import { buildBackdrop, canvasTexture } from './backdrop3d.js';

const FRONT = TILE / 2; // z of the blocks' front faces
// Characters, items and shots stand just in front of the blocks, so blocks never cut them, as in 2D where they
// are drawn over the tiles: the hero's head rises 60 px above his hitbox and would go through a platform overhead.
const SPRITE_Z = FRONT + 1;
// render.js draws them in this order, later on top; here each layer stands a hair closer to the camera instead.
const Z = { pickup: 0, enemy: 0.1, boss: 0.2, shot: 0.3, shotCore: 0.35, aura: 0.4, hero: 0.5, soul: 0.7, particle: 1.5 };
const STREET_D = 96; // depth of the street the hero runs on; the courtyard starts behind it
const PLATFORM_D = 64;
const PAD = 20; // edge columns repeated past both ends of a level so the perspective shows no cliff
const DEEP = -300; // y of the floor seen down the pits; buildings start here
const SHOT_LIGHTS = 3; // fixed number of lights, so shaders never recompile mid-game

let renderer, scene, camera, hemi, sun;
const shotLights = [];
let levelOf = null; // level definition the world was built for (state.level is reparsed on every respawn)
let world = null; // blocks, checkpoints and backdrop of that level
let levelH = 0;
let flags = []; // { mat, col }: checkpoint flags, recolored every frame
let embers = null;
let particles = null;

const sheets = {}; // name -> { tex, mat, geos }
const heads = new Map(); // image of the current head (normal, hurt, dead) -> { mat, soul }
let headOf = null; // the head those belong to: the sliders make a new one on every step
const pools = {}; // key -> { list, used }: meshes reused frame to frame
const toScreen = new THREE.Vector3();
const dummy = new THREE.Object3D();
const Y = (y) => levelH - y; // game y (down) -> scene y (up)

// shared, never disposed; shots are flat discs, like the 2D circles, so they never poke through a sprite
const unit = { box: new THREE.BoxGeometry(1, 1, 1), disc: new THREE.CircleGeometry(1, 16) };
const headGeo = new THREE.PlaneGeometry(HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE).translate(0, (CHIN_Y - HEAD_H / 2) * HEAD_SCALE, 0);
const soulGeo = new THREE.PlaneGeometry(HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE);

const srgb = (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};
// Sprites are cut out by alpha (alpha-to-coverage smooths the cut edge with MSAA) and unlit: their art
// keeps the 2D colors whatever the sunset does to the world.
const spriteMat = (map) => new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });

export function init3d(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // one render pixel per world px whatever the screen: upscaled without smoothing, it reads as pixel art
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, VIEW_W / VIEW_H, 10, 8000);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
  sun = new THREE.DirectionalLight(0xfff1e0, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 700, bottom: -700, near: 10, far: 3000 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  scene.add(hemi, sun, sun.target);
  for (let i = 0; i < SHOT_LIGHTS; i++) {
    shotLights.push(new THREE.PointLight(0xff8a00, 0, 170, 0));
    scene.add(shotLights[i]);
  }
}

// ---- sprites -------------------------------------------------------------------------------------------

function sheet(name) {
  sheets[name] ??= (() => {
    const tex = srgb(new THREE.TextureLoader().load(ATLAS[name].src));
    return { tex, mat: spriteMat(tex), geos: [] };
  })();
  return sheets[name];
}

// Plane for frame i, anchored like drawSprite; null until the sheet has loaded.
function spriteGeo(name, i) {
  const s = sheet(name);
  const img = s.tex.image;
  if (!img?.width) return null;
  if (!s.geos[i]) {
    const q = frameQuad(name, i, img.width, img.height);
    s.geos[i] = new THREE.PlaneGeometry(q.w, q.h).translate(q.cx, q.cy, 0);
    s.geos[i].setAttribute('uv', new THREE.Float32BufferAttribute([q.u0, q.v1, q.u1, q.v1, q.u0, q.v0, q.u1, q.v0], 2));
  }
  return s.geos[i];
}

function take(key, make) {
  const p = (pools[key] ??= { list: [], used: 0 });
  let m = p.list[p.used++];
  if (!m) {
    m = make();
    scene.add(m);
    p.list.push(m);
  }
  m.visible = true;
  return m;
}

// Frame i of a sheet with its anchor at game point (x, y); dir -1 mirrors it.
function sprite(name, i, x, y, dir, z) {
  const geo = spriteGeo(name, i);
  if (!geo) return;
  const m = take('sprite', () => Object.assign(new THREE.Mesh(), { castShadow: true }));
  m.geometry = geo;
  m.material = sheets[name].mat;
  m.position.set(x, Y(y), SPRITE_Z + z);
  m.scale.set(dir, 1, 1);
}

// Unlit glowing disc: shots and their flames.
function glow(color, r, x, y, z) {
  const m = take(`glow${color}`, () => new THREE.Mesh(unit.disc, new THREE.MeshBasicMaterial({ color })));
  m.scale.setScalar(r);
  m.position.set(x, Y(y), SPRITE_Z + z);
  return m;
}

function headEntry(img, style) {
  if (!heads.has(img)) {
    const tex = srgb(new THREE.Texture(img));
    tex.needsUpdate = true;
    if (style === 'pixel') tex.magFilter = THREE.NearestFilter;
    heads.set(img, { mat: spriteMat(tex), soul: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }) });
  }
  return heads.get(img);
}

// ---- level ---------------------------------------------------------------------------------------------

// Deterministic pseudo-random, same as render.js.
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// The street's tile, the same picture the 2D view tiles.
function streetTexture(hell) {
  const tex = srgb(new THREE.CanvasTexture(streetTile(hell)));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Paving slabs, 16 world px square, on the street's top: one tile's worth (32 x STREET_D), so neighbours line up.
function pavingTexture(hell) {
  const [base, seam] = hell ? ['#3e3537', '#221c1e'] : ['#5f5a5e', '#2e2a2f'];
  const tex = canvasTexture(2 * TILE, 2 * STREET_D, (g) => {
    for (let y = 0, i = 0; y < 2 * STREET_D; y += 32) {
      for (let x = 0; x < 2 * TILE; x += 32, i++) {
        g.fillStyle = base;
        g.fillRect(x, y, 32, 32);
        g.fillStyle = `rgba(0, 0, 0, ${hash(i + 50) * 0.18})`; // slabs a shade apart
        g.fillRect(x, y, 32, 32);
      }
    }
    g.fillStyle = seam;
    for (let y = 0; y < 2 * STREET_D; y += 32) g.fillRect(0, y, 2 * TILE, 2);
    for (let x = 0; x < 2 * TILE; x += 32) g.fillRect(x, 0, 2, 2 * STREET_D);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Decorations lying on the street and the courtyard, 64 px each: broken paving (2 x 2 slabs) with the earth
// showing, a pothole, a crack, a puddle.
const DECALS = {
  broken(g, missing) {
    for (const k of missing) {
      const [x, y] = [(k % 2) * 32, Math.floor(k / 2) * 32];
      g.fillStyle = '#3a2a26'; // earth where a slab is gone
      g.fillRect(x + 2, y + 2, 30, 30);
      g.fillStyle = '#5a463e';
      for (let i = 0; i < 6; i++) g.fillRect(x + 4 + hash(k * 9 + i) * 24, y + 4 + hash(k * 9 + i + 3) * 24, 3, 2);
      g.fillStyle = '#6a6468'; // a fragment left behind
      g.fillRect(x + 6, y + 18, 10, 8);
    }
    g.fillStyle = '#1c181d'; // cracks across the slabs that stayed
    for (let i = 0; i < 18; i++) g.fillRect(4 + i * 3, 30 + Math.round(Math.sin(i * 1.7) * 6), 3, 2);
  },
  pothole(g) {
    const blob = (r, color) => {
      g.fillStyle = color;
      g.beginPath();
      for (let a = 0; a < 16; a++) {
        const k = r * (0.8 + hash(a + 70) * 0.3);
        g[a ? 'lineTo' : 'moveTo'](32 + Math.cos((a / 16) * Math.PI * 2) * k, 32 + Math.sin((a / 16) * Math.PI * 2) * k);
      }
      g.fill();
    };
    blob(29, '#8a8590'); // the broken edge
    blob(23, '#0e0b10');
  },
  crack(g) {
    g.strokeStyle = '#1a161c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4, 40);
    for (let i = 1; i <= 8; i++) g.lineTo(4 + i * 7, 40 - i * 2 + (i % 2 ? 6 : -6));
    g.moveTo(32, 32);
    g.lineTo(40, 52);
    g.lineTo(46, 58);
    g.stroke();
  },
  puddle(g) {
    g.fillStyle = '#23263c';
    g.beginPath();
    g.ellipse(32, 32, 30, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(150, 160, 230, 0.4)'; // the sky in it, faint: bright stripes flicker at this angle
    g.fillRect(12, 25, 30, 4);
    g.fillRect(20, 33, 18, 3);
  },
};

// Decals over the ground with nothing on it, away from pits and walls; picked by column, like the 2D chips.
function addDecals(group, lv, groundRow, gy, yardFront) {
  const tileAt = (r, c) => lv.tiles[r * lv.cols + Math.min(lv.cols - 1, Math.max(0, c))];
  const open = (c) => tileAt(groundRow, c) === 1 && tileAt(groundRow - 1, c) !== 1;
  const kinds = { brokenA: [], brokenB: [], pothole: [], crack: [], puddle: [] };
  for (let c = -PAD; c < lv.cols + PAD; c++) {
    if (!open(c - 1) || !open(c) || !open(c + 1)) continue;
    const h = (k) => hash(c * 13.7 + k);
    if (h(1) < 0.22) {
      // where the 2D view chips the kerb; broken paving lines up with the slabs, potholes don't need to
      if (h(2) < 0.55) kinds[h(3) < 0.5 ? 'brokenA' : 'brokenB'].push({ x: c * TILE + TILE / 2, z: FRONT - 16 - 16 * Math.floor(h(4) * 4), s: 32, r: 0 });
      else kinds.pothole.push({ x: c * TILE + TILE / 2, z: FRONT - 24 - h(4) * 48, s: 26 + h(5) * 16, r: h(6) * Math.PI });
    }
    if (h(7) < 0.2) {
      const kind = ['pothole', 'puddle', 'crack', 'crack'][Math.floor(h(8) * 4)];
      kinds[kind].push({ x: c * TILE + TILE / 2, z: yardFront - 24 - h(9) * 110, s: 44 + h(10) * 40, r: h(11) * Math.PI });
    }
  }
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (const [kind, list] of Object.entries(kinds)) {
    if (!list.length) continue;
    const map = canvasTexture(64, 64, (g) => (kind.startsWith('broken') ? DECALS.broken(g, kind === 'brokenA' ? [0, 3] : [1]) : DECALS[kind](g)));
    const m = new THREE.InstancedMesh(flat, new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 }), list.length);
    list.forEach((d, i) => {
      dummy.position.set(d.x, gy + 0.2, d.z);
      dummy.rotation.set(0, d.r, 0);
      dummy.scale.set(d.s, 1, d.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }
}

// One box per cell (pairs col,row in cells); y = cell top to box center, z = box center.
function blocks(geo, mat, cells, y, z) {
  const m = new THREE.InstancedMesh(geo, mat, cells.length / 2);
  for (let i = 0; i < cells.length; i += 2) {
    dummy.position.set(cells[i] * TILE + TILE / 2, Y(cells[i + 1] * TILE + y), z);
    dummy.updateMatrix();
    m.setMatrixAt(i / 2, dummy.matrix);
  }
  m.castShadow = m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

function dispose(group) {
  group.traverse((o) => {
    if (o.geometry !== unit.box) o.geometry?.dispose();
    if (o.isInstancedMesh) o.dispose(); // its instance matrices and colors are buffers of their own
    for (const m of [o.material].flat()) {
      m?.map?.dispose();
      m?.dispose();
    }
  });
}

function buildLevel(state) {
  if (world) {
    scene.remove(world);
    dispose(world);
    scene.background?.dispose();
  }
  const lv = state.level;
  const bg = state.levels[state.levelIndex].bg;
  const hell = bg === 'hell';
  const depth = STREET_D;
  levelOf = state.levels[state.levelIndex];
  levelH = lv.rows * TILE;
  world = new THREE.Group();
  flags = [];

  const solid = [];
  const plat = [];
  for (let r = 0; r < lv.rows; r++) {
    for (let c = -PAD; c < lv.cols + PAD; c++) {
      const t = lv.tiles[r * lv.cols + Math.min(lv.cols - 1, Math.max(0, c))];
      if (t === 1) solid.push(c, r);
      else if (t === 2) plat.push(c, r);
    }
  }
  const ground = new THREE.BoxGeometry(TILE, TILE, depth);
  const uv = ground.attributes.uv;
  for (let i = 0; i < 8; i++) uv.setX(i, (uv.getX(i) * depth) / TILE); // side faces: bricks repeat along the depth
  const brick = new THREE.MeshLambertMaterial({ map: streetTexture(hell) });
  const top = new THREE.MeshLambertMaterial({ map: pavingTexture(hell) }); // charcoal in hell: the red demons stand out
  world.add(blocks(ground, [brick, brick, top, brick, brick, brick], solid, TILE / 2, FRONT - depth / 2));
  // platforms stand out like the sprites: an unlit front with the 2D slab on it and a dark underside, which is
  // what the camera sees of a platform above its eye
  const slabFront = new THREE.MeshBasicMaterial({ map: srgb(new THREE.CanvasTexture(slabTile(hell))), fog: false });
  const slabSide = new THREE.MeshBasicMaterial({ color: hell ? '#6e5e58' : '#857c72', fog: false });
  const slabUnder = new THREE.MeshBasicMaterial({ color: '#16121a', fog: false });
  const slabTop = new THREE.MeshLambertMaterial({ color: hell ? '#c8b8ae' : '#e2dacd' });
  world.add(blocks(new THREE.BoxGeometry(TILE, 14, PLATFORM_D), [slabSide, slabSide, slabTop, slabUnder, slabFront, slabSide], plat, 7, FRONT - PLATFORM_D / 2));

  // The courtyard behind the street: a column of ground behind every ground tile, reaching behind the farthest
  // backdrop layer, so a pit cuts through the whole pavement down to the dark floor, not just through its kerb.
  const groundRow = lv.rows - 2; // the top row of the level's ground
  const yardCols = [];
  for (let c = -PAD; c < lv.cols + PAD; c++) if (lv.tiles[groundRow * lv.cols + Math.min(lv.cols - 1, Math.max(0, c))] === 1) yardCols.push(c, groundRow);
  const yardD = FRONT - depth - (Math.min(...BACKDROP_ART[bg].layers.map((l) => l.z)) - 40);
  const dirt = new THREE.MeshLambertMaterial({ color: '#3a2a26' });
  const yardTop = new THREE.MeshLambertMaterial({ color: hell ? '#2a2122' : '#3e3b42' });
  world.add(blocks(new THREE.BoxGeometry(TILE, 2 * TILE, yardD), [dirt, dirt, yardTop, dirt, dirt, dirt], yardCols, TILE, FRONT - depth - yardD / 2));
  addDecals(world, lv, groundRow, Y(groundRow * TILE), FRONT - depth);

  const levelW = lv.cols * TILE;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(levelW + 6000, 3000), new THREE.MeshLambertMaterial({ color: '#1a1020' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(levelW / 2, DEEP, -1000);
  world.add(floor);

  const look = buildBackdrop(world, {
    bg,
    gy: Y(groundRow * TILE),
    span: (z) => [-0.5 * (CAMERA_DIST - z), levelW + 0.5 * (CAMERA_DIST - z)], // what the camera can see at depth z
  });
  scene.background = look.sky;
  scene.fog = look.fog;
  hemi.color.set(look.hemi[0]);
  hemi.groundColor.set(look.hemi[1]);
  sun.color.set(look.light);

  const pole = new THREE.CylinderGeometry(2, 2, 64);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#424242' });
  const flagGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(2, 64), new THREE.Vector2(30, 54), new THREE.Vector2(2, 44)]));
  for (const c of lv.checkpoints) {
    const x = c.col * TILE + TILE / 2;
    const y = Y((c.row + 1) * TILE);
    const p = new THREE.Mesh(pole, poleMat);
    p.position.set(x, y + 32, 0);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const f = new THREE.Mesh(flagGeo, mat);
    f.position.set(x, y, 0);
    p.castShadow = f.castShadow = true;
    world.add(p, f);
    flags.push({ mat, col: c.col });
  }

  embers = null;
  if (hell) {
    embers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#ffab00', size: 10 }));
    embers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30 * 3), 3));
    embers.frustumCulled = false;
    world.add(embers);
  }

  particles = new THREE.InstancedMesh(unit.box, new THREE.MeshBasicMaterial(), 300);
  particles.frustumCulled = false;
  world.add(particles);
  scene.add(world);
}

// ---- hero ----------------------------------------------------------------------------------------------

let hero = null;

function makeHero() {
  const root = new THREE.Group(); // at the feet; tips over when dead
  const flip = new THREE.Group(); // mirrors body and head to where the hero faces
  const body = Object.assign(new THREE.Mesh(), { castShadow: true });
  const headMesh = Object.assign(new THREE.Mesh(headGeo), { castShadow: true });
  const aura = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }));
  const soul = new THREE.Mesh(soulGeo);
  flip.add(body, headMesh);
  root.add(flip);
  scene.add(root, aura, soul);
  return { root, flip, body, headMesh, aura, soul };
}

function drawHero(state, head) {
  hero ??= makeHero();
  if (head !== headOf) {
    for (const e of heads.values()) {
      e.mat.map.dispose();
      e.mat.dispose();
      e.soul.dispose();
    }
    heads.clear();
    headOf = head;
  }
  const p = state.player;
  const opts = heroOpts(state);
  const frame = heroFrame(opts, p.walk);
  const { root, flip, body, headMesh, aura, soul } = hero;

  root.position.set(p.x + p.w / 2, Y(p.y + p.h) + 14 * opts.lying, SPRITE_Z + Z.hero);
  root.rotation.z = p.facing * (Math.PI / 2) * opts.lying;
  flip.scale.x = p.facing < 0 ? -1 : 1;
  const geo = spriteGeo('hero', frame);
  body.visible = !!geo;
  if (geo) {
    body.geometry = geo;
    body.material = sheets.hero.mat;
  }

  const img = head?.img && headFor(head, opts);
  headMesh.visible = !!img;
  if (img) {
    headMesh.material = headEntry(img, head.style).mat;
    const [cx, cy] = heroChin(frame);
    headMesh.position.set(cx, -cy, 0.1);
    headMesh.scale.x = head.dir < 0 ? -1 : 1;
  }

  const dead = state.mode === 'dead';
  aura.visible = !dead && p.buffs.whiskey > 0;
  if (aura.visible) {
    aura.material.color.setStyle(`hsl(${Math.round(state.time * 300) % 360}, 90%, 60%)`);
    aura.position.set(p.x + p.w / 2, Y(p.y), SPRITE_Z + Z.aura);
    aura.scale.set(40, 60, 1);
  }

  soul.visible = dead && state.deathCause === 'hp' && !!head?.img && state.deadT > 0.3;
  if (soul.visible) {
    // the soul leaves the body
    const t = state.deadT - 0.3;
    soul.material = headEntry(head.img, head.style).soul;
    soul.material.opacity = Math.max(0, 0.6 - t * 0.35);
    soul.position.set(p.x + p.w / 2, Y(p.y - 50 - t * 50 + Math.sin(t * 4) * 4 + (HEAD_H * HEAD_SCALE) / 2), SPRITE_Z + Z.soul);
  }
}

// ---- frame ---------------------------------------------------------------------------------------------

function drawShots(state) {
  for (const s of state.shots) {
    const cy = s.y + s.h / 2;
    if (s.pierce) {
      glow('#ff6d00', 10, s.x + s.w / 2, cy, Z.shot);
      glow('#ffee58', 5, s.x + s.w / 2, cy, Z.shotCore);
      continue;
    }
    const stick = take('stick', () => new THREE.Mesh(unit.box, new THREE.MeshBasicMaterial({ color: '#ffcc80' })));
    stick.scale.set(s.w, 2, 0.01);
    stick.position.set(s.x + s.w / 2, Y(s.y + 3), SPRITE_Z + Z.shot);
    glow('#ff9100', 4 + Math.random() * 2, s.vx > 0 ? s.x + s.w : s.x, s.y + 3, Z.shotCore);
  }
  for (const s of state.enemyShots) {
    glow(s.flame ? '#ff6d00' : '#d500f9', 9, s.x + s.w / 2, s.y + s.h / 2, Z.shot);
    glow(s.flame ? '#ffeb3b' : '#ffffff', 4, s.x + s.w / 2, s.y + s.h / 2, Z.shotCore);
  }
  const fires = [...state.shots, ...state.enemyShots.filter((s) => s.flame)];
  shotLights.forEach((l, i) => {
    const s = fires[i];
    l.intensity = s ? 4 : 0;
    if (s) l.position.set(s.x + s.w / 2, Y(s.y + s.h / 2), SPRITE_Z + 40);
  });
}

function drawParticles(state) {
  const m = particles;
  const color = new THREE.Color();
  const n = Math.min(state.particles.length, m.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const q = state.particles[i];
    dummy.position.set(q.x, Y(q.y), SPRITE_Z + Z.particle);
    dummy.scale.setScalar(Math.max(0.01, (q.size * q.life) / q.max));
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    m.setColorAt(i, color.set(q.color));
  }
  dummy.scale.set(1, 1, 1);
  m.count = n;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

function drawEmbers(state) {
  const pos = embers.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = (((hash(i) * VIEW_W * 2 - state.camX * 0.3) % VIEW_W) + VIEW_W) % VIEW_W;
    const y = (state.time * 40 * (0.5 + hash(i + 9)) + hash(i + 3) * VIEW_H) % VIEW_H;
    pos.setXYZ(i, state.camX + x, levelH - VIEW_H + y, -150);
  }
  pos.needsUpdate = true;
}

// Renders the frame; returns where the top middle of the player's hitbox is on screen, for drawOverlay.
export function draw3d(state, head) {
  if (state.levels[state.levelIndex] !== levelOf) buildLevel(state);
  for (const p of Object.values(pools)) p.used = 0;
  const lvl = state.levels[state.levelIndex];
  const p = state.player;

  for (const f of flags) f.mat.color.set(state.checkpoint && state.checkpoint.col >= f.col ? '#43a047' : '#9e9e9e');
  for (const k of state.pickups) sprite('items', itemFrame(k.kind), k.x + k.w / 2, k.y + k.h / 2 + Math.sin(state.time * 4 + k.x) * 3, 1, Z.pickup);
  for (const e of state.enemies) {
    if (e.type === 'flyer') {
      // the bat's anchor is its eyes, ahead of the body's center, so it faces the player
      const dir = p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1;
      sprite('bat', Math.floor(state.time * 12 + e.phase) % 4, e.x + e.w / 2 + 6 * dir, e.y + e.h / 2, dir, Z.enemy);
    } else {
      sprite(e.shooter ? 'fire-imp' : 'imp', demonFrame(e, state.time), e.x + e.w / 2, e.y + e.h, e.hold ? e.aim : e.vx > 0 ? 1 : -1, Z.enemy);
    }
  }
  const b = state.boss;
  if (b) sprite(`boss${lvl.boss ?? 0}`, bossFrame(b, lvl.boss ?? 0, state.time), b.x + b.w / 2, b.y + b.h, b.facing, Z.boss);
  drawShots(state);
  drawHero(state, head);
  drawParticles(state);
  if (embers) drawEmbers(state);
  for (const pool of Object.values(pools)) for (let i = pool.used; i < pool.list.length; i++) pool.list[i].visible = false;

  const tx = state.camX + VIEW_W / 2;
  const ty = levelH / 2;
  camera.position.set(tx, ty, CAMERA_DIST); // eye level with the middle of the level, straight from the side
  camera.lookAt(tx, ty, 0);
  if (p.buffs.whiskey > 0) camera.rotateZ(Math.sin(state.time * 2.5) * 0.035);
  sun.position.set(tx - 500, ty + 350, 600); // low, from the front left
  sun.target.position.set(tx, ty, 0);

  renderer.render(scene, camera);
  toScreen.set(p.x + p.w / 2, Y(p.y), SPRITE_Z).project(camera);
  return { x: ((toScreen.x + 1) / 2) * VIEW_W, y: ((1 - toScreen.y) / 2) * VIEW_H };
}
