// The 3D world's view: the arena (ground, blocks, the border fence, the canal) under a camera fixed up high in the
// south; characters, items and the head are the game's sprites on upright planes facing it, as in src/render3d.js.
// world/main.js loads it with import(): 'three' comes from the importmap in world/index.html.
// Scene axes are the game's: x east, y up, z south (towards the camera).
import * as THREE from 'three';
import { TILE, VIEW_W, VIEW_H } from '../src/game.js';
import { HEAD_W, HEAD_H, CHIN_Y } from '../src/face-math.js';
import { ATLAS } from '../src/sprite-atlas.js';
import { frameQuad, heroFrame, heroChin, itemFrame, demonFrame, bossFrame } from '../src/sprites.js';
import { HEAD_SCALE, headFor, slabTile } from '../src/render.js';
import { buildBackdrop } from '../src/backdrop3d.js';
import { heightAt, floorAt } from './game.js';

const CAM = { up: 420, back: 520, look: 40, follow: 0.12 }; // offset from the point it follows, look-at height, lerp per frame
// how close to the west/east fence and the south fence the camera's point may come: the screen stops at the fences
// instead of showing the empty ground behind them
const CAM_EDGE = { x: 380, south: 240 };
const PAD = 20; // ground cells past the arena on every side, fading into the fog
const DEEP = -300; // bottom of the pits
const FENCE = 2 * TILE; // the border wall: low, so it never hides the hero from the camera
const WALL = 3 * TILE; // a '#' inside the arena

let renderer, scene, camera, hemi, sun;
let defOf = null; // arena definition the world was built for (state.level is reparsed on every respawn)
let world = null; // ground, blocks, flags and backdrop of that arena
let flags = []; // { mat, col, row }: checkpoint flags, recolored every frame
let particles = null;
let cam = null; // the point the camera follows: x, z after the hero, y after the ground he stands on

const sheets = {}; // name -> { tex, mat, geos }
const heads = new Map(); // image of the current head (normal, hurt, dead) -> { mat, soul }
let headOf = null; // the head those belong to
const pools = {}; // key -> { list, used }: meshes reused frame to frame
const toScreen = new THREE.Vector3();
const dummy = new THREE.Object3D();

// shared, never disposed
const unit = { box: new THREE.BoxGeometry(1, 1, 1), disc: new THREE.CircleGeometry(1, 16) };
const blobGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const headGeo = new THREE.PlaneGeometry(HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE).translate(0, (CHIN_Y - HEAD_H / 2) * HEAD_SCALE, 0);
const soulGeo = new THREE.PlaneGeometry(HEAD_W * HEAD_SCALE, HEAD_H * HEAD_SCALE);

const srgb = (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};
// Sprites are cut out by alpha and unlit, as in the 2D view. They cast no shadow: a blob under each one grounds it.
const spriteMat = (map) => new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });

export function initWorld(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // one render pixel per world px whatever the screen: upscaled without smoothing, it reads as pixel art
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, VIEW_W / VIEW_H, 10, 8000);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
  sun = new THREE.DirectionalLight(0xfff1e0, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -800, right: 800, top: 800, bottom: -800, near: 10, far: 3000 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  particles = new THREE.InstancedMesh(unit.box, new THREE.MeshBasicMaterial(), 300);
  particles.frustumCulled = false;
  scene.add(hemi, sun, sun.target, particles);
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

// Frame i of a sheet with its anchor at (x, y, z); dir -1 mirrors it.
function sprite(name, i, x, y, z, dir) {
  const geo = spriteGeo(name, i);
  if (!geo) return;
  const m = take('sprite', () => new THREE.Mesh());
  m.geometry = geo;
  m.material = sheets[name].mat;
  m.position.set(x, y, z);
  m.scale.set(dir, 1, 1);
}

// Unlit glowing disc facing the camera: shots and their flames.
function glow(color, r, x, y, z) {
  const m = take(`glow${color}`, () => new THREE.Mesh(unit.disc, new THREE.MeshBasicMaterial({ color })));
  m.scale.setScalar(r);
  m.position.set(x, y, z);
}

// A soft dark disc on whatever is under a body of half-size r, smaller the higher the body is above it.
function blob(level, x, y, z, r) {
  const floor = floorAt(level, x, z, r);
  if (floor === -Infinity || y < floor - 1) return;
  const m = take('blob', () => new THREE.Mesh(blobGeo, blobMat));
  const k = r * 1.4 * Math.max(0.4, 1 - (y - floor) / 300);
  m.scale.set(k, 1, k);
  m.position.set(x, floor + 0.5, z);
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

// ---- arena ---------------------------------------------------------------------------------------------

function dispose(group) {
  group.traverse((o) => {
    if (o.geometry !== unit.box) o.geometry?.dispose();
    if (o.isInstancedMesh) o.dispose();
    for (const m of [o.material].flat()) {
      m?.map?.dispose();
      m?.dispose();
    }
  });
}

function buildArena(state) {
  if (world) {
    scene.remove(world);
    dispose(world);
    scene.background?.dispose();
  }
  const def = state.levels[state.levelIndex];
  const lv = state.level;
  defOf = def;
  cam = null;
  world = new THREE.Group();
  flags = [];
  const pit = (c, r) => heightAt(lv, c, r) === -Infinity;

  // ground: a tile per cell but the pits, and a pad of tiles around the arena
  const cells = [];
  for (let r = -PAD; r < lv.rows + PAD; r++) {
    for (let c = -PAD; c < lv.cols + PAD; c++) if (!pit(c, r)) cells.push(c, r);
  }
  const tile = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
  const asphalt = new THREE.MeshLambertMaterial({ color: '#3e3b42' }); // the classic 3D courtyard's
  const ground = new THREE.InstancedMesh(tile, asphalt, cells.length / 2);
  for (let i = 0; i < cells.length; i += 2) {
    dummy.position.set(cells[i] * TILE + TILE / 2, 0, cells[i + 1] * TILE + TILE / 2);
    dummy.updateMatrix();
    ground.setMatrixAt(i / 2, dummy.matrix);
  }
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  world.add(ground);

  // pits: a dark floor and earth walls down to it on every side that has ground
  const pitMat = new THREE.MeshLambertMaterial({ color: '#3a2a26' });
  const pitFloorMat = new THREE.MeshLambertMaterial({ color: '#16121a' });
  const pitFloor = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
  const pitWall = new THREE.PlaneGeometry(TILE, -DEEP);
  const sides = [[0, -1, 0, 0, -0.5], [0, 1, Math.PI, 0, 0.5], [-1, 0, Math.PI / 2, -0.5, 0], [1, 0, -Math.PI / 2, 0.5, 0]];
  for (let r = 0; r < lv.rows; r++) {
    for (let c = 0; c < lv.cols; c++) {
      if (!pit(c, r)) continue;
      const [x, z] = [c * TILE + TILE / 2, r * TILE + TILE / 2];
      const f = new THREE.Mesh(pitFloor, pitFloorMat);
      f.position.set(x, DEEP, z);
      world.add(f);
      for (const [dc, dr, rot, ox, oz] of sides) {
        if (pit(c + dc, r + dr)) continue;
        const w = new THREE.Mesh(pitWall, pitMat);
        w.position.set(x + ox * TILE, DEEP / 2, z + oz * TILE);
        w.rotation.y = rot;
        world.add(w);
      }
    }
  }

  // blocks, inner walls and the border fence: boxes with the platform slabs on their sides
  const slab = slabTile(false);
  const sideMats = {};
  const sideMat = (h) => (sideMats[h] ??= (() => {
    const tex = srgb(new THREE.CanvasTexture(slab));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, h / 14); // a slab is 14 px tall
    return new THREE.MeshLambertMaterial({ map: tex });
  })());
  const topMat = new THREE.MeshLambertMaterial({ color: '#c2b8ac' });
  for (let r = 0; r < lv.rows; r++) {
    for (let c = 0; c < lv.cols; c++) {
      const h = heightAt(lv, c, r);
      const border = r === 0 || c === 0 || r === lv.rows - 1 || c === lv.cols - 1;
      const top = h === Infinity ? (border ? FENCE : WALL) : h;
      if (!(top > 0)) continue;
      const side = sideMat(top);
      const m = new THREE.Mesh(unit.box, [side, side, topMat, topMat, side, side]);
      m.scale.set(TILE, top, TILE);
      m.position.set(c * TILE + TILE / 2, top / 2, r * TILE + TILE / 2);
      m.castShadow = m.receiveShadow = true;
      world.add(m);
    }
  }

  const pole = new THREE.CylinderGeometry(2, 2, 64);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#424242' });
  const flagGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(2, 64), new THREE.Vector2(30, 54), new THREE.Vector2(2, 44)]));
  for (const c of lv.checkpoints) {
    const [x, y, z] = [c.col * TILE + TILE / 2, Math.max(0, heightAt(lv, c.col, c.row)), c.row * TILE + TILE / 2];
    const p = new THREE.Mesh(pole, poleMat);
    p.position.set(x, y + 32, z);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const f = new THREE.Mesh(flagGeo, mat);
    f.position.set(x, y, z);
    p.castShadow = f.castShadow = true;
    world.add(p, f);
    flags.push({ mat, col: c.col, row: c.row });
  }

  // the level's ChatGPT city behind the north fence, the Opera behind the north-east
  const levelW = lv.cols * TILE;
  const look = buildBackdrop(world, { bg: def.bg, gy: 0, levelW, span: () => [-PAD * TILE, levelW + PAD * TILE] });
  scene.background = look.sky;
  scene.fog = look.fog;
  hemi.color.set(look.hemi[0]);
  hemi.groundColor.set(look.hemi[1]);
  sun.color.set(look.light);
  scene.add(world);
}

// ---- hero ----------------------------------------------------------------------------------------------

let hero = null;

function makeHero() {
  const root = new THREE.Group(); // at the feet; tips over when dead
  const flip = new THREE.Group(); // mirrors body and head to where the hero faces
  const body = new THREE.Mesh();
  const headMesh = new THREE.Mesh(headGeo);
  const aura = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }));
  const soul = new THREE.Mesh(soulGeo);
  flip.add(body, headMesh);
  root.add(flip);
  scene.add(root, aura, soul);
  return { root, flip, body, headMesh, aura, soul };
}

// Pose flags for heroFrame: like heroOpts in src/render.js, but running north or south is running too and y is up.
function heroPose(state) {
  const p = state.player;
  const dead = state.mode === 'dead';
  return {
    moving: !dead && p.onGround && (p.vx !== 0 || p.vz !== 0),
    airborne: !dead && !p.onGround,
    rising: p.vy > 0,
    hurt: !dead && p.knock > 0,
    throwing: !dead && p.fireCd > 0.1,
    lying: dead ? Math.min(1, state.deadT / 0.35) : 0,
  };
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
  const opts = heroPose(state);
  const frame = heroFrame(opts, p.walk);
  const { root, flip, body, headMesh, aura, soul } = hero;

  root.position.set(p.x, p.y + 14 * opts.lying, p.z);
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
    aura.position.set(p.x, p.y + 28, p.z + 1);
    aura.scale.set(40, 60, 1);
  }

  soul.visible = dead && state.deathCause === 'hp' && !!head?.img && state.deadT > 0.3;
  if (soul.visible) {
    // the soul leaves the body
    const t = state.deadT - 0.3;
    soul.material = headEntry(head.img, head.style).soul;
    soul.material.opacity = Math.max(0, 0.6 - t * 0.35);
    soul.position.set(p.x, p.y + 50 + t * 50 + Math.sin(t * 4) * 4 + (HEAD_H * HEAD_SCALE) / 2, p.z + 2);
  }
}

// ---- frame ---------------------------------------------------------------------------------------------

function drawShots(state) {
  for (const s of state.shots) {
    if (s.pierce) {
      glow('#ff6d00', 10, s.x, s.y, s.z);
      glow('#ffee58', 5, s.x, s.y, s.z + 0.5);
    } else {
      glow('#ffcc80', 3, s.x, s.y, s.z);
      glow('#ff9100', 4 + Math.random() * 2, s.x + s.vx * 0.006, s.y + s.vy * 0.006, s.z + s.vz * 0.006 + 0.5); // the lit head
    }
  }
}

function drawParticles(state) {
  const m = particles;
  const color = new THREE.Color();
  const n = Math.min(state.particles.length, m.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const q = state.particles[i];
    dummy.position.set(q.x, q.y, q.z);
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

// Renders the frame; returns where the top middle of the player's hitbox is on screen, for drawOverlay.
export function drawWorld(state, head) {
  if (state.levels[state.levelIndex] !== defOf) buildArena(state);
  for (const pool of Object.values(pools)) pool.used = 0;
  const lv = state.level;
  const def = state.levels[state.levelIndex];
  const p = state.player;
  const t = state.time;

  for (const f of flags) f.mat.color.set(state.checkpoint?.col === f.col && state.checkpoint?.row === f.row ? '#43a047' : '#9e9e9e');
  for (const k of state.pickups) {
    sprite('items', itemFrame(k.kind), k.x, k.y + k.h / 2 + Math.sin(t * 4 + k.x) * 3, k.z, 1);
    blob(lv, k.x, k.y, k.z, 8);
  }
  for (const e of state.enemies) {
    sprite('imp', demonFrame(e, t), e.x, e.y, e.z, e.vx > 0 ? 1 : -1);
    blob(lv, e.x, e.y, e.z, e.r);
  }
  const b = state.boss;
  if (b) {
    const i = def.boss ?? 0;
    sprite(`boss${i}`, bossFrame({ ...b, vx: b.vx || b.vz }, i, t), b.x, b.y, b.z, b.facing); // walking north is walking
    blob(lv, b.x, b.y, b.z, b.r);
  }
  drawShots(state);
  drawHero(state, head);
  blob(lv, p.x, p.y, p.z, p.r);
  drawParticles(state);
  for (const pool of Object.values(pools)) for (let i = pool.used; i < pool.list.length; i++) pool.list[i].visible = false;

  const tx = Math.min(Math.max(p.x, CAM_EDGE.x), lv.cols * TILE - CAM_EDGE.x);
  const tz = Math.min(p.z, lv.rows * TILE - CAM_EDGE.south);
  if (!cam) cam = { x: tx, y: Math.max(0, p.y), z: tz };
  cam.x += (tx - cam.x) * CAM.follow;
  cam.z += (tz - cam.z) * CAM.follow;
  if (p.onGround) cam.y += (p.y - cam.y) * CAM.follow; // not after every jump, only to the height he lands on
  camera.position.set(cam.x, cam.y + CAM.up, cam.z + CAM.back);
  camera.lookAt(cam.x, cam.y + CAM.look, cam.z);
  if (p.buffs.whiskey > 0) camera.rotateZ(Math.sin(t * 2.5) * 0.035);
  sun.position.set(cam.x - 500, cam.y + 900, cam.z + 400); // high, from the front left
  sun.target.position.set(cam.x, cam.y, cam.z);

  renderer.render(scene, camera);
  toScreen.set(p.x, p.y + p.h, p.z).project(camera);
  return { x: ((toScreen.x + 1) / 2) * VIEW_W, y: ((1 - toScreen.y) / 2) * VIEW_H };
}
