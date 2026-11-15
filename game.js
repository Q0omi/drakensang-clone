// =====================================================================================
//  KRONIKY POPOLA – izometrické 3D ARPG (Three.js)
//  Štruktúra: jadro → VFX → hrdinovia → nepriatelia → boj → predmety → mapy → UI → slučka
// =====================================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------ utils
const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randS = (a = 1) => (Math.random() * 2 - 1) * a;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const TAU = Math.PI * 2;
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
const _c = new THREE.Color();
/** hex → linear RGB * intensity (HDR hodnoty > 1 rozsvieti bloom) */
function rgb(hex, k = 1) { _c.setHex(hex); return [_c.r * k, _c.g * k, _c.b * k]; }
function hdr(hex, k = 1) { return new THREE.Color(hex).multiplyScalar(k); }
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ global state
const G = { regionSeen: {},
  state: 'select',          // select | playing | dead | victory | transition
  time: 0, dt: 0, hitStop: 0, slowMo: 1,
  zoneIndex: 0, zone: null,
  player: null, heroId: 'aurora',
  enemies: [], projectiles: [], drops: [], boss: null,
  quality: 2,               // 2 = vysoká, 1 = stredná, 0 = nízka
  invOpen: false,
};

// ------------------------------------------------------------------ renderer / scene / camera
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
const CAM = { pitch: THREE.MathUtils.degToRad(50), dist: 27, target: new V3(), shake: 0, shakeT: 0, off: new V3() };

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// persistent lights (colour/intensity is set per zone)
const hemi = new THREE.HemisphereLight(0xffffff, 0x223322, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
const sunDir = new V3(18, 34, 14);
scene.add(hemi, sun, sun.target);

function applyQuality() {
  const q = G.quality;
  const pr = Math.min(window.devicePixelRatio || 1, q === 2 ? 1.5 : q === 1 ? 1.25 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = q >= 1;
  sun.shadow.mapSize.set(q === 2 ? 2048 : 1024, q === 2 ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  document.documentElement.style.setProperty('--hs', Math.min(1, innerWidth / 1180, innerHeight / 820).toFixed(3));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (typeof onQualityChanged === 'function') onQualityChanged();
}
addEventListener('resize', applyQuality);

function updateCamera(dt, snap) {
  const p = G.player;
  if (p) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 7); let tx = p.pos.x, tz = p.pos.z;
    const b = G.boss; // keep the colossus in frame during the boss fight
    if (b && b.aggro && !b.dead) { let dx = (b.pos.x - tx) * 0.38, dz = (b.pos.z - tz) * 0.38; const l = Math.hypot(dx, dz); if (l > 7) { dx *= 7 / l; dz *= 7 / l; } tx += dx; tz += dz; }
    CAM.target.x = lerp(CAM.target.x, tx, snap ? 1 : k * 0.6);
    CAM.target.z = lerp(CAM.target.z, tz, snap ? 1 : k * 0.6);
  }
  // trauma-based shake
  CAM.shake = Math.max(0, CAM.shake - dt * 1.9);
  const s = CAM.shake * CAM.shake;
  CAM.shakeT += dt * 38;
  CAM.off.set(Math.sin(CAM.shakeT * 1.3) * s, Math.sin(CAM.shakeT * 1.7 + 2) * s * 0.8, Math.cos(CAM.shakeT * 1.1 + 1) * s);
  camera.position.set(CAM.target.x + CAM.off.x, Math.sin(CAM.pitch) * CAM.dist + CAM.off.y, CAM.target.z + Math.cos(CAM.pitch) * CAM.dist + CAM.off.z);
  camera.lookAt(CAM.target.x + CAM.off.x, 1.0, CAM.target.z + CAM.off.z);
  sun.target.position.set(CAM.target.x, 0, CAM.target.z);
  sun.position.copy(sun.target.position).add(sunDir);
}
function shake(a) { if (typeof SETTINGS !== 'undefined' && !SETTINGS.shake) return; CAM.shake = Math.min(1.25, Math.max(CAM.shake, a)); }
function hitStop(sec) { G.hitStop = Math.max(G.hitStop, sec); }

// ------------------------------------------------------------------ scheduler (game time, cleared on zone change)
const timers = [];
function after(delay, fn) { timers.push({ t: G.time + delay, fn }); }
function updateTimers() {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].t <= G.time) { const f = timers[i].fn; timers[i] = timers[timers.length - 1]; timers.pop(); f(); }
  }
}

// ------------------------------------------------------------------ input
const keys = {};
const mouse = { x: 0, y: 0, ndc: new THREE.Vector2(), ground: new V3(), l: false, r: false, lPressed: false, overUI: false };
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new V3(0, 1, 0), 0);
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (!keys[e.code]) onKeyPress(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (e.button === 0) { mouse.l = true; mouse.lPressed = true; }
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (G.state === 'playing') CAM.dist = clamp(CAM.dist + Math.sign(e.deltaY) * 2, 19, 39); }, { passive: true });
function updateMouseGround() {
  mouse.ndc.set((mouse.x / innerWidth) * 2 - 1, -(mouse.y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse.ndc, camera);
  raycaster.ray.intersectPlane(groundPlane, mouse.ground);
}
const _proj = new V3();
/** world → screen px; returns false when behind the camera */
function toScreen(x, y, z, out) {
  _proj.set(x, y, z).project(camera);
  out.x = (_proj.x * 0.5 + 0.5) * innerWidth; out.y = (-_proj.y * 0.5 + 0.5) * innerHeight;
  return _proj.z < 1;
}

// ------------------------------------------------------------------ procedural canvas textures
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const TEX = {};
TEX.glow = canvasTex(128, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});
TEX.ring = canvasTex(256, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.62, 'rgba(255,255,255,.10)'); g.addColorStop(0.86, 'rgba(255,255,255,1)'); g.addColorStop(0.93, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
});
TEX.rune = canvasTex(512, (x, s) => {
  const c = s / 2; x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round';
  const g = x.createRadialGradient(c, c, 0, c, c, c); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.9, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  for (const [r, w] of [[0.94, 5], [0.86, 2], [0.62, 3], [0.3, 2]]) { x.lineWidth = w; x.beginPath(); x.arc(c, c, c * r, 0, TAU); x.stroke(); }
  x.lineWidth = 3;
  for (let k = 0; k < 2; k++) { x.beginPath(); for (let i = 0; i <= 3; i++) { const a = k * Math.PI + i * TAU / 3 - Math.PI / 2; x[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * c * 0.62, c + Math.sin(a) * c * 0.62); } x.stroke(); }
  x.lineWidth = 3.5;
  for (let i = 0; i < 16; i++) { // rune glyphs between the two outer circles
    const a = i * TAU / 16; x.save(); x.translate(c + Math.cos(a) * c * 0.74, c + Math.sin(a) * c * 0.74); x.rotate(a + Math.PI / 2);
    x.beginPath(); const n = 2 + (i * 7) % 3;
    for (let j = 0; j < n; j++) { x.moveTo(((i * 13 + j * 5) % 5 - 2) * 4, -11); x.lineTo(((i * 3 + j * 11) % 5 - 2) * 4, 11); }
    x.moveTo(-8, ((i * 5) % 3 - 1) * 7); x.lineTo(8, ((i * 11) % 3 - 1) * 7); x.stroke(); x.restore();
  }
  for (let i = 0; i < 48; i++) { const a = i * TAU / 48; x.lineWidth = i % 4 ? 1 : 3; x.beginPath(); x.moveTo(c + Math.cos(a) * c * 0.88, c + Math.sin(a) * c * 0.88); x.lineTo(c + Math.cos(a) * c * 0.92, c + Math.sin(a) * c * 0.92); x.stroke(); }
});
TEX.scorch = canvasTex(256, (x, s) => {
  const c = s / 2; const g = x.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(0.5, 'rgba(8,4,2,.8)'); g.addColorStop(0.8, 'rgba(10,5,2,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) { const a = rand(TAU), r = rand(c * 0.85); x.fillStyle = `rgba(0,0,0,${rand(0.2, 0.5)})`; x.beginPath(); x.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rand(4, 18), 0, TAU); x.fill(); }
});
TEX.cracks = canvasTex(256, (x, s) => { // glowing cracks (used additively over scorch marks)
  const c = s / 2; x.strokeStyle = '#fff'; x.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    let a = i * TAU / 11 + randS(0.2), px = c, py = c; x.lineWidth = 3.2; x.beginPath(); x.moveTo(px, py);
    for (let j = 0; j < 7; j++) { a += randS(0.5); const l = rand(8, 18); px += Math.cos(a) * l; py += Math.sin(a) * l; x.lineTo(px, py); }
    x.stroke();
  }
  const g = x.createRadialGradient(c, c, c * 0.5, c, c, c); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = g; x.fillRect(0, 0, s, s);
});
TEX.beam = canvasTex(64, (x, s) => { // vertical beam: fades toward the top and toward the sides
  const g = x.createLinearGradient(0, 0, s, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const v = x.createLinearGradient(0, 0, 0, s); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, s, s);
});
TEX.trail = canvasTex(64, (x, s) => {
  const g = x.createLinearGradient(0, 0, s, 0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const v = x.createLinearGradient(0, 0, 0, s); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, s, s);
});
TEX.frost = canvasTex(256, (x, s) => {
  const c = s / 2; const g = x.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.75, 'rgba(255,255,255,.22)'); g.addColorStop(0.92, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s); x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9); x.stroke();
    for (let j = 1; j < 4; j++) for (const d of [-0.6, 0.6]) { const r = c * 0.25 * j; x.beginPath(); x.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); x.lineTo(c + Math.cos(a) * r + Math.cos(a + d) * 22, c + Math.sin(a) * r + Math.sin(a + d) * 22); x.stroke(); } }
});
// =====================================================================================
//  VFX – pooled particles, lights, ground decals, slashes, lightning, trails, telegraphs
// =====================================================================================
const fxRoot = new THREE.Group();
scene.add(fxRoot);

// ---- generic effect list: update(dt) returns false when finished; cleanup always runs once
const FX = [];
function addFx(update, cleanup) { FX.push({ u: update, c: cleanup }); }
function updateFx(dt) {
  for (let i = FX.length - 1; i >= 0; i--) {
    if (FX[i].u(dt) === false) { const f = FX[i]; FX[i] = FX[FX.length - 1]; FX.pop(); if (f.c) f.c(); }
  }
}
function clearFx() { for (const f of FX) if (f.c) f.c(); FX.length = 0; sparks.clear(); smoke.clear(); }

// ---- GPU point particles (ring buffer, zero allocations at runtime)
class Particles {
  constructor(max, additive) {
    this.max = max; this.i = 0;
    this.p = new Float32Array(max * 3).fill(-9999); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const attr = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('position', (this.aP = attr(this.p, 3)));
    g.setAttribute('aColor', (this.aC = attr(this.c, 3)));
    g.setAttribute('aSize', (this.aS = attr(this.size, 1)));
    g.setAttribute('aAlpha', (this.aA = attr(this.alpha, 1)));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main(){ vColor=aColor; vAlpha=aAlpha; if(aAlpha<0.003||aSize<=0.0){ gl_Position=vec4(0.0,0.0,2.0,1.0); gl_PointSize=1.0; return; } vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(aSize*uScale/max(0.5,-mv.z),1.0,320.0); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=1.0-smoothstep(0.0,1.0,d); gl_FragColor=vec4(vColor,a*a*vAlpha); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 30 : 20;
  }
  emit(x, y, z, vx, vy, vz, col, life, s0, s1, drag, grav) {
    const i = this.i; this.i = (i + 1) % this.max; const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.c[j] = col[0]; this.c[j + 1] = col[1]; this.c[j + 2] = col[2];
    this.life[i] = this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    const { p, v, life, maxLife, s0, s1, drag, grav, size, alpha, max } = this;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      const j = i * 3; life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; p[j + 1] = -9999; continue; }
      const d = Math.max(0, 1 - drag[i] * dt);
      v[j] *= d; v[j + 1] = v[j + 1] * d - grav[i] * dt; v[j + 2] *= d;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < 0.03 && grav[i] > 0) { p[j + 1] = 0.03; v[j + 1] *= -0.35; v[j] *= 0.6; v[j + 2] *= 0.6; }
      const k = 1 - life[i] / maxLife[i];
      size[i] = s0[i] + (s1[i] - s0[i]) * k;
      alpha[i] = Math.min(1, k * 10) * (1 - k) * (1.6 - k * 0.6);
    }
    this.aP.needsUpdate = this.aC.needsUpdate = this.aS.needsUpdate = this.aA.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.size.fill(0); for (let i = 1; i < this.p.length; i += 3) this.p[i] = -9999; this.aP.needsUpdate = this.aS.needsUpdate = this.aA.needsUpdate = true; }
}
const sparks = new Particles(5000, true);
const smoke = new Particles(1400, false);
scene.add(smoke.points, sparks.points);

/** omnidirectional / upward particle burst. o: n,color,color2,int,s0,s1,l0,l1,size,size1,drag,grav,up,flat,r,h,smoke,vx,vy,vz */
function burst(x, y, z, o) {
  const sys = o.smoke ? smoke : sparks;
  const k = (o.int ?? 2) * (o.smoke ? 1 : 0.72), c1 = rgb(o.color ?? 0xffffff, k), c2 = o.color2 !== undefined ? rgb(o.color2, k) : c1;
  const n = Math.max(1, Math.round((o.n ?? 12) * (G.quality === 0 ? 0.5 : 1)));
  for (let i = 0; i < n; i++) {
    let dx = randS(), dy = randS(), dz = randS(); const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    if (o.flat) dy *= 0.12;
    if (o.up) dy = Math.abs(dy) * o.up;
    const sp = rand(o.s0 ?? 2, o.s1 ?? 6), r = o.r ? Math.sqrt(Math.random()) * o.r : 0, ra = rand(TAU);
    sys.emit(x + Math.cos(ra) * r, y + (o.h ? rand(o.h) : 0), z + Math.sin(ra) * r,
      dx * sp + (o.vx || 0), dy * sp + (o.vy || 0), dz * sp + (o.vz || 0),
      Math.random() < 0.5 ? c1 : c2, rand(o.l0 ?? 0.3, o.l1 ?? 0.7), o.size ?? 0.5, o.size1 ?? 0, o.drag ?? 2, o.grav ?? 0);
  }
}

// ---- pooled point lights (fixed count → no shader recompiles while fighting)
const lightPool = [];
for (let i = 0; i < 5; i++) { const L = new THREE.PointLight(0xffffff, 0, 16, 2); L.userData.free = true; scene.add(L); lightPool.push(L); }
function getLight(color, intensity, dist) {
  const L = lightPool.find((l) => l.userData.free); if (!L) return null;
  L.userData.free = false; L.color.setHex(color); L.intensity = intensity; L.distance = dist; return L;
}
function freeLight(L) { if (L) { L.intensity = 0; L.userData.free = true; } }
function flashLight(x, y, z, color, intensity, dist, dur) {
  intensity *= 0.42; const L = getLight(color, intensity, dist); if (!L) return;
  L.position.set(x, y, z); let t = 0;
  addFx((dt) => { t += dt; const k = 1 - t / dur; L.intensity = intensity * k * k; return t < dur; }, () => freeLight(L));
}

// ---- pooled flat ground quads (rings, runes, glows, scorch marks)
const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const flatPool = [];
let flatN = 0;
function getFlat(tex, color, int = 1, additive = true) {
  let m = flatPool.pop();
  if (!m) { m = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); }
  const mt = m.material; mt.map = tex; mt.color.setHex(color).multiplyScalar(int); mt.opacity = 1;
  mt.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  m.renderOrder = additive ? 6 : 4; m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
  m.position.y = 0.04 + (flatN++ % 12) * 0.006;
  fxRoot.add(m); return m;
}
function freeFlat(m) { fxRoot.remove(m); flatPool.push(m); }
/** expanding / fading ground ring or decal */
function ringFx(x, z, o) {
  const m = getFlat(o.tex || TEX.ring, o.color ?? 0xffffff, o.int ?? 2, o.additive !== false);
  m.position.x = x; m.position.z = z; if (o.y) m.position.y = o.y;
  m.rotation.y = o.rot ?? rand(TAU);
  const r0 = o.r0 ?? 0.5, r1 = o.r1 ?? 5, dur = o.dur ?? 0.5, spin = o.spin ?? 0, hold = o.hold ?? 0; let t = -(o.delay ?? 0);
  m.visible = t >= 0;
  addFx((dt) => {
    t += dt; if (t < 0) return true; m.visible = true;
    const k = Math.min(1, t / dur), e = o.linear ? k : easeOut(k), r = lerp(r0, r1, e);
    m.scale.set(r * 2, 1, r * 2); m.rotation.y += spin * dt;
    m.material.opacity = t < dur ? (o.fadeIn ? Math.min(1, k * 4) : 1) * (o.keep ? 1 : 1 - k * k) : Math.max(0, 1 - (t - dur) / Math.max(0.001, hold));
    return t < dur + hold;
  }, () => freeFlat(m));
  return m;
}

// ---- pooled glow sprites
const spritePool = [];
function flash(x, y, z, color, size, dur = 0.25, int = 3) {
  let s = spritePool.pop();
  if (!s) s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.material.color.setHex(color).multiplyScalar(int * 0.42); size *= 0.75; s.position.set(x, y, z); s.renderOrder = 31; fxRoot.add(s);
  let t = 0;
  addFx((dt) => { t += dt; const k = t / dur; s.scale.setScalar(size * (0.45 + 0.55 * easeOut(Math.min(1, k)))); s.material.opacity = Math.max(0, 1 - k * k); return t < dur; },
    () => { fxRoot.remove(s); spritePool.push(s); });
}

// ---- sweeping slash arcs (shader moves a hot leading edge through the crescent)
const arcGeoCache = {};
function arcGeo(arc, inner = 0.42) {
  const key = arc.toFixed(2) + '_' + inner; if (arcGeoCache[key]) return arcGeoCache[key];
  const seg = 40, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = -arc / 2 + arc * i / seg, s = Math.sin(th), c = Math.cos(th);
    pos.push(s * inner, 0, c * inner, s, 0, c); uv.push(i / seg, 0, i / seg, 1);
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return (arcGeoCache[key] = g);
}
const slashPool = [];
function getSlash(arc, color, color2, inner) {
  let m = slashPool.pop();
  if (!m) {
    m = new THREE.Mesh(arcGeo(arc, inner), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uProg: { value: 0 }, uAlpha: { value: 1 }, uTail: { value: 0.7 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uProg; uniform float uAlpha; uniform float uTail; varying vec2 vUv;
        void main(){ float head=uProg*(1.0+uTail); float on=step(vUv.x,head);
          float along=smoothstep(head-uTail,head,vUv.x)*on; float lead=smoothstep(head-0.09,head,vUv.x)*on;
          float radial=pow(vUv.y,2.4)*(1.0-smoothstep(0.9,1.0,vUv.y));
          vec3 col=mix(uColor,uColor2,pow(vUv.y,3.0))*(1.0+lead*2.5);
          gl_FragColor=vec4(col,clamp((along+lead)*radial*uAlpha,0.0,1.0)); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    m.frustumCulled = false; m.renderOrder = 25;
  }
  m.geometry = arcGeo(arc, inner);
  m.material.uniforms.uColor.value.copy(color); m.material.uniforms.uColor2.value.copy(color2);
  m.material.uniforms.uProg.value = 0; m.material.uniforms.uAlpha.value = 1; m.material.uniforms.uTail.value = 0.7;
  m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
  return m;
}
function freeSlash(m) { m.removeFromParent(); slashPool.push(m); }
/** one sweeping crescent in world space. o: r, arc, color, color2, dur, dir(±1), tilt, y, int */
function slashFx(x, z, facing, o) {
  const m = getSlash(o.arc ?? 2.6, hdr(o.color ?? 0x66e0ff, o.int ?? 2.2), hdr(o.color2 ?? 0xffe9a8, (o.int ?? 2.2) * 1.4), o.inner ?? 0.42);
  const r = o.r ?? 3.5, dir = o.dir ?? 1, dur = o.dur ?? 0.22; let t = 0;
  m.position.set(x, o.y ?? 1.15, z); m.rotation.order = 'YXZ'; m.rotation.y = facing; m.rotation.z = (o.tilt ?? 0.22) * dir; m.rotation.x = o.pitch ?? 0;
  m.scale.set(r * dir, r, r); fxRoot.add(m);
  addFx((dt) => { t += dt; const k = Math.min(1, t / dur); m.material.uniforms.uProg.value = easeOut(k); m.material.uniforms.uAlpha.value = 1 - k * k * k; return t < dur; }, () => freeSlash(m));
}

// ---- procedural jagged lightning (two crossed quads per segment → readable from any angle)
const LSEG = 12;
const boltPool = [];
const _la = new V3(), _lb = new V3(), _ld = new V3(), _ls1 = new V3(), _ls2 = new V3(), _up = new V3(0, 1, 0);
function getBolt() {
  let m = boltPool.pop();
  if (!m) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LSEG * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let s = 0; s < LSEG; s++) { const a = s * 8; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a + 4, a + 5, a + 6, a + 5, a + 7, a + 6); }
    g.setIndex(idx);
    m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    m.frustumCulled = false; m.renderOrder = 28; m.userData.pts = Array.from({ length: LSEG + 1 }, () => new V3());
  }
  fxRoot.add(m); return m;
}
function shapeBolt(m, a, b, jitter, width) {
  const pts = m.userData.pts, arr = m.geometry.attributes.position.array;
  for (let i = 0; i <= LSEG; i++) { const t = i / LSEG, amp = jitter * Math.sin(Math.PI * t); pts[i].lerpVectors(a, b, t); pts[i].x += randS(amp); pts[i].y += randS(amp * 0.7); pts[i].z += randS(amp); }
  for (let s = 0; s < LSEG; s++) {
    const p = pts[s], q = pts[s + 1]; _ld.subVectors(q, p);
    _ls1.crossVectors(_ld, _up); if (_ls1.lengthSq() < 1e-6) _ls1.set(1, 0, 0); _ls1.setLength(width);
    _ls2.crossVectors(_ld, _ls1).setLength(width);
    const o = s * 24, put = (k, v, sd, sg) => { arr[o + k * 3] = v.x + sd.x * sg; arr[o + k * 3 + 1] = v.y + sd.y * sg; arr[o + k * 3 + 2] = v.z + sd.z * sg; };
    put(0, p, _ls1, 1); put(1, p, _ls1, -1); put(2, q, _ls1, 1); put(3, q, _ls1, -1);
    put(4, p, _ls2, 1); put(5, p, _ls2, -1); put(6, q, _ls2, 1); put(7, q, _ls2, -1);
  }
  m.geometry.attributes.position.needsUpdate = true;
}
function lightning(a, b, o = {}) {
  const main = getBolt(), glow = getBolt(), A = a.clone(), B = b.clone();
  const dur = o.dur ?? 0.3, w = o.width ?? 0.09, jit = o.jitter ?? Math.min(1.1, A.distanceTo(B) * 0.12);
  main.material.color.copy(hdr(0xffffff, 3)); glow.material.color.copy(hdr(o.color ?? 0x7fb4ff, o.int ?? 2.5));
  let t = 0, re = 0;
  addFx((dt) => {
    t += dt; re -= dt;
    if (re <= 0) { re = 0.045; shapeBolt(main, A, B, jit, w); shapeBolt(glow, A, B, jit * 1.25, w * 3.2); }
    const k = 1 - t / dur; main.material.opacity = k; glow.material.opacity = k * 0.55; return t < dur;
  }, () => { fxRoot.remove(main, glow); boltPool.push(main, glow); });
}

// ---- camera-facing ribbon trails for projectiles
const _td = new V3(), _tc = new V3(), _ts = new V3();
class Trail {
  constructor(n = 14) {
    this.n = n; this.pts = Array.from({ length: n }, () => new V3());
    const g = new THREE.BufferGeometry(), uv = [], idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < n; i++) { uv.push(i / (n - 1), 0, i / (n - 1), 1); if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: TEX.trail, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 24;
  }
  start(pos, width, color, int, spacing = 0.28) {
    for (const p of this.pts) p.copy(pos);
    this.width = width; this.spacing = spacing; this.mesh.material.color.setHex(color).multiplyScalar(int); this.mesh.material.opacity = 1;
    fxRoot.add(this.mesh); this.update(pos);
  }
  update(pos) {
    const pts = this.pts, n = this.n;
    if (pos.distanceTo(pts[1]) > this.spacing) { const last = pts.pop(); last.copy(pos); pts.splice(1, 0, last); }
    pts[0].copy(pos);
    const arr = this.mesh.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; _td.subVectors(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]);
      _tc.subVectors(camera.position, p); _ts.crossVectors(_td, _tc);
      if (_ts.lengthSq() < 1e-8) _ts.set(1, 0, 0);
      _ts.setLength(this.width * (1 - i / (n - 1) * 0.85));
      arr[i * 6] = p.x + _ts.x; arr[i * 6 + 1] = p.y + _ts.y; arr[i * 6 + 2] = p.z + _ts.z;
      arr[i * 6 + 3] = p.x - _ts.x; arr[i * 6 + 4] = p.y - _ts.y; arr[i * 6 + 5] = p.z - _ts.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
const trailPool = [];
function getTrail(pos, width, color, int, spacing) { const t = trailPool.pop() || new Trail(); t.start(pos, width, color, int, spacing); return t; }
function freeTrail(t) { if (t) { fxRoot.remove(t.mesh); trailPool.push(t); } }

// ---- vertical light beams (two crossed quads)
const beamGeo = (() => {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...a.attributes.uv.array, ...b.attributes.uv.array], 2));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + 4)]);
  return g;
})();
function makeBeam(color, int, w, h) {
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: TEX.beam, color: hdr(color, int), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  m.scale.set(w, h, w); m.renderOrder = 22; return m;
}
function beamFx(x, z, color, w, h, dur, int = 2.5) {
  const m = makeBeam(color, int, w, h); m.position.set(x, 0, z); fxRoot.add(m); let t = 0;
  addFx((dt) => { t += dt; const k = t / dur; m.material.opacity = 1 - k; m.scale.x = m.scale.z = w * (1 - k * 0.6); return t < dur; }, () => { fxRoot.remove(m); m.material.dispose(); });
}

// ---- telegraphed danger zones (circle or cone) with a fill that sweeps outward until the hit lands
const teleGeoCache = {};
function telegraph(x, z, r, dur, o = {}) {
  const arc = o.arc ?? TAU, key = arc.toFixed(3);
  const geo = teleGeoCache[key] || (teleGeoCache[key] = new THREE.CircleGeometry(1, 56, -Math.PI / 2 - arc / 2, arc).rotateX(-Math.PI / 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: hdr(o.color ?? 0xff2a1a, 1.6) }, uFill: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFill; uniform float uAlpha; varying vec2 vUv;
      void main(){ float r=length(vUv-0.5)*2.0; float edge=smoothstep(0.9,0.975,r); float fill=step(r,uFill); float line=1.0-smoothstep(0.0,0.05,abs(r-uFill));
        gl_FragColor=vec4(uColor*(1.0+edge*1.5+line*2.0),(0.14+fill*0.24+edge*0.55+line*0.45)*uAlpha); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat); m.position.set(x, 0.07, z); m.rotation.y = o.facing ?? 0; m.scale.set(r, 1, r); m.renderOrder = 7; fxRoot.add(m);
  let t = 0;
  addFx((dt) => { t += dt; mat.uniforms.uFill.value = Math.min(1, t / dur); mat.uniforms.uAlpha.value = Math.min(1, t * 6) * (t > dur ? Math.max(0, 1 - (t - dur) * 8) : 1); if (o.follow) { m.position.x = o.follow.x; m.position.z = o.follow.z; } return t < dur + 0.12; },
    () => { fxRoot.remove(m); mat.dispose(); });
  return m;
}

// ---- pooled solid debris: ice shards / rock spikes
const shardGeos = {
  ice: new THREE.OctahedronGeometry(0.5, 0).scale(0.55, 1.5, 0.55).translate(0, 0.5, 0),
  rock: new THREE.ConeGeometry(0.5, 1, 5).translate(0, 0.5, 0),
};
const shardPools = { ice: [], rock: [] };
function getShard(kind) {
  let m = shardPools[kind].pop();
  if (!m) {
    const mat = kind === 'ice'
      ? new THREE.MeshPhongMaterial({ color: 0xbfe9ff, emissive: 0x2f8fe0, emissiveIntensity: 0.9, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.8, flatShading: true })
      : new THREE.MeshLambertMaterial({ color: 0x4b4038, emissive: 0xff5a14, emissiveIntensity: 0.0, transparent: true, flatShading: true });
    m = new THREE.Mesh(shardGeos[kind], mat); m.userData.kind = kind; m.castShadow = kind === 'rock';
  }
  m.material.opacity = kind === 'ice' ? 0.8 : 1; m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); fxRoot.add(m); return m;
}
function freeShard(m) { fxRoot.remove(m); shardPools[m.userData.kind].push(m); }

/** blackened ground with glowing cracks that cool down */
function scorch(x, z, r, dur = 7, color = 0xff6a1a) {
  ringFx(x, z, { tex: TEX.scorch, color: 0xffffff, int: 1, additive: false, r0: r, r1: r, dur: dur * 0.7, hold: dur * 0.3, keep: true });
  ringFx(x, z, { tex: TEX.cracks, color, int: 3, r0: r * 0.9, r1: r * 0.9, dur: dur * 0.55, linear: true });
  let t = 0, acc = 0;
  addFx((dt) => { t += dt; acc += dt; if (acc > 0.09) { acc = 0; burst(x, 0.1, z, { n: 1, color, int: 2.5, r: r * 0.7, up: 1, s0: 0.5, s1: 2, l0: 0.6, l1: 1.3, size: 0.22, drag: 0.5 }); } return t < dur * 0.5; });
}
/** common impact: glow flash + sparks + light */
function impactFx(x, y, z, color, size = 1) {
  flash(x, y, z, color, 2.6 * size, 0.2, 3);
  burst(x, y, z, { n: Math.round(10 * size), color, color2: 0xffffff, int: 2.5, s0: 3, s1: 10 * size, l0: 0.15, l1: 0.4, size: 0.3, drag: 4 });
  flashLight(x, y + 0.5, z, color, 30 * size, 9, 0.22);
}
// =====================================================================================
//  Procedural stylized meshes (enemies, boss, fallback heroes) + limb animation
// =====================================================================================
const GEO = {};
const geo = (key, make) => GEO[key] || (GEO[key] = make());
const boxG = (w, h, d) => geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
function part(g, mat, x, y, z, parent) {
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
function matFactory(mats) {
  return (color, emissive = 0x000000, ei = 1) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive, emissiveIntensity: ei });
    m.userData.base = { c: color, e: emissive, ei }; mats.push(m); return m;
  };
}

/** Stylized humanoid. o: scale, skin, cloth, dark, metal, eye, robe, hood, helm, armor, horns, ears, weapon('sword'|'club'|'bow'|'staff'|'dagger'), shield, orb */
function buildBiped(o) {
  const root = new THREE.Group(), mats = [], M = matFactory(mats);
  const skin = M(o.skin), cloth = M(o.cloth), dark = M(o.dark ?? 0x1c1a18), metal = M(o.metal ?? 0x7d8288), glow = M(0x111111, o.eye ?? 0xff3020, 3.5);
  const hipY = 0.9, hips = new THREE.Group(); hips.position.y = hipY; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  part(boxG(0.62, 0.72, 0.36), o.armor ? metal : cloth, 0, 0.42, 0, torso);
  part(boxG(0.5, 0.14, 0.38), dark, 0, 0.05, 0, torso);
  if (o.armor) { part(boxG(0.3, 0.17, 0.42), metal, -0.42, 0.78, 0, torso); part(boxG(0.3, 0.17, 0.42), metal, 0.42, 0.78, 0, torso); }
  const head = new THREE.Group(); head.position.y = 0.98; torso.add(head);
  part(boxG(0.38, 0.38, 0.38), skin, 0, 0, 0, head);
  part(boxG(0.09, 0.06, 0.04), glow, -0.09, 0.03, 0.2, head); part(boxG(0.09, 0.06, 0.04), glow, 0.09, 0.03, 0.2, head);
  if (o.hood) part(geo('hood', () => new THREE.ConeGeometry(0.36, 0.56, 6)), cloth, 0, 0.2, -0.05, head);
  if (o.helm) { part(boxG(0.44, 0.2, 0.44), metal, 0, 0.17, 0, head); part(boxG(0.06, 0.3, 0.06), metal, 0, 0.36, 0, head); }
  if (o.ears) for (const s of [-1, 1]) { const e = part(geo('ear', () => new THREE.ConeGeometry(0.08, 0.34, 4)), skin, s * 0.27, 0.08, 0, head); e.rotation.z = -s * 1.2; }
  if (o.horns) for (const s of [-1, 1]) { const h = part(geo('horn', () => new THREE.ConeGeometry(0.07, 0.36, 5)), dark, s * 0.15, 0.3, 0.02, head); h.rotation.z = -s * 0.4; }
  if (o.jaw) part(boxG(0.3, 0.1, 0.3), skin, 0, -0.25, 0.04, head);
  const mkArm = (s) => { const a = new THREE.Group(); a.position.set(s * 0.42, 0.7, 0); torso.add(a); part(boxG(0.17, 0.66, 0.17), o.sleeve ? cloth : skin, 0, -0.3, 0, a); return a; };
  const armL = mkArm(-1), armR = mkArm(1);
  let legL = null, legR = null;
  if (o.robe) part(geo('robe', () => new THREE.CylinderGeometry(0.22, 0.52, 0.9, 7)), cloth, 0, -0.45, 0, hips);
  else {
    const mkLeg = (s) => { const l = new THREE.Group(); l.position.set(s * 0.17, 0, 0); hips.add(l); part(boxG(0.2, 0.86, 0.2), dark, 0, -0.45, 0, l); return l; };
    legL = mkLeg(-1); legR = mkLeg(1);
  }
  // weapons live in the right hand, pointing forward (+Z) when the arm hangs down
  if (o.weapon === 'sword') { part(boxG(0.07, 0.1, 1.25), metal, 0, -0.62, 0.62, armR); part(boxG(0.3, 0.07, 0.07), dark, 0, -0.62, 0.04, armR); }
  if (o.weapon === 'club') { part(boxG(0.1, 0.1, 0.8), dark, 0, -0.62, 0.38, armR); part(boxG(0.22, 0.22, 0.3), metal, 0, -0.62, 0.8, armR); }
  if (o.weapon === 'dagger') part(boxG(0.05, 0.07, 0.5), metal, 0, -0.62, 0.26, armR);
  if (o.weapon === 'staff') {
    part(geo('staff', () => new THREE.CylinderGeometry(0.035, 0.045, 1.9, 6)), dark, 0, -0.35, 0.14, armR);
    part(geo('orb', () => new THREE.IcosahedronGeometry(0.15, 1)), M(0x222222, o.orb ?? 0xb04dff, 4), 0, 0.68, 0.14, armR);
  }
  if (o.weapon === 'bow') { const b = part(geo('bow', () => new THREE.TorusGeometry(0.5, 0.03, 4, 10, Math.PI)), dark, 0, -0.6, 0.12, armL); b.rotation.set(0, Math.PI / 2, -Math.PI / 2); }
  if (o.shield) part(boxG(0.09, 0.72, 0.56), metal, -0.14, -0.38, 0.1, armL);
  root.scale.setScalar(o.scale ?? 1);
  return { root, mats, P: { hips, hipY, torso, head, armL, armR, legL, legR }, kind: 'biped' };
}

/** t: time, o: { walk 0..1, freq, atk 0..1 (impact ≈ .65), cast 0..1, aim 0..1 } */
function poseBiped(P, t, o) {
  const w = o.walk || 0, f = o.freq || 9, sw = Math.sin(t * f) * 0.8 * w;
  if (P.legL) { P.legL.rotation.x = sw; P.legR.rotation.x = -sw; }
  P.armL.rotation.set(-sw * 0.8, 0, 0); P.armR.rotation.set(sw * 0.8, 0, 0);
  P.hips.position.y = P.hipY + Math.abs(Math.cos(t * f)) * 0.07 * w + Math.sin(t * 2.2) * 0.015;
  P.torso.rotation.set(0.14 * w, 0, 0); P.head.rotation.x = 0;
  if (o.atk !== undefined) {
    const a = o.atk; let ang, tw;
    if (a < 0.55) { const k = easeOut(a / 0.55); ang = -2.9 * k; tw = -0.55 * k; }
    else if (a < 0.7) { const k = (a - 0.55) / 0.15; ang = lerp(-2.9, -0.45, k); tw = lerp(-0.55, 0.5, k); }
    else { const k = (a - 0.7) / 0.3; ang = lerp(-0.45, 0, k); tw = lerp(0.5, 0, k); }
    P.armR.rotation.x = ang; P.torso.rotation.y = tw; P.torso.rotation.x = a > 0.55 && a < 0.8 ? 0.3 : 0.05;
  }
  if (o.cast !== undefined) { const k = Math.sin(Math.PI * Math.min(1, o.cast)); P.armL.rotation.x = P.armR.rotation.x = -2.5 * k; P.armL.rotation.z = -0.5 * k; P.armR.rotation.z = 0.5 * k; P.head.rotation.x = -0.3 * k; }
  if (o.aim !== undefined) { const k = Math.min(1, o.aim * 1.6); P.armL.rotation.x = -1.55 * k; P.armR.rotation.x = -1.4 * k; P.armR.rotation.z = -0.5 * k; P.torso.rotation.y = 0.5 * k; }
}

function buildWolf(o) {
  const root = new THREE.Group(), mats = [], M = matFactory(mats);
  const fur = M(o.fur ?? 0x4a4f58), dark = M(o.dark ?? 0x2a2d33), glow = M(0x111111, o.eye ?? 0xffb020, 3.5);
  const body = new THREE.Group(); body.position.y = 0.78; root.add(body);
  part(boxG(0.5, 0.48, 1.1), fur, 0, 0, -0.1, body); part(boxG(0.58, 0.56, 0.55), fur, 0, 0.05, 0.42, body);
  part(boxG(0.3, 0.14, 0.9), dark, 0, 0.3, 0.0, body);
  const head = new THREE.Group(); head.position.set(0, 0.2, 0.75); body.add(head);
  part(boxG(0.4, 0.36, 0.42), fur, 0, 0, 0.1, head); part(boxG(0.2, 0.17, 0.34), dark, 0, -0.07, 0.42, head);
  for (const s of [-1, 1]) { part(geo('wear', () => new THREE.ConeGeometry(0.07, 0.2, 4)), dark, s * 0.14, 0.26, 0.02, head); part(boxG(0.07, 0.05, 0.04), glow, s * 0.11, 0.05, 0.32, head); }
  const legs = [];
  for (const [x, z] of [[-0.2, 0.42], [0.2, 0.42], [-0.2, -0.5], [0.2, -0.5]]) { const l = new THREE.Group(); l.position.set(x, -0.15, z); body.add(l); part(boxG(0.14, 0.62, 0.14), dark, 0, -0.31, 0, l); legs.push(l); }
  const tail = new THREE.Group(); tail.position.set(0, 0.12, -0.65); body.add(tail); part(boxG(0.11, 0.11, 0.6), fur, 0, 0, -0.3, tail); tail.rotation.x = 0.5;
  root.scale.setScalar(o.scale ?? 1);
  return { root, mats, P: { body, head, legs, tail }, kind: 'wolf' };
}
function poseWolf(P, t, o) {
  const w = o.walk || 0, f = o.freq || 14;
  P.legs[0].rotation.x = Math.sin(t * f) * 0.9 * w; P.legs[1].rotation.x = Math.sin(t * f + 0.6) * 0.9 * w;
  P.legs[2].rotation.x = -Math.sin(t * f + 0.3) * 0.9 * w; P.legs[3].rotation.x = -Math.sin(t * f + 0.9) * 0.9 * w;
  P.body.position.y = 0.78 + Math.abs(Math.sin(t * f)) * 0.1 * w; P.body.position.z = 0; P.body.rotation.x = Math.sin(t * f) * 0.08 * w;
  P.tail.rotation.y = Math.sin(t * 6) * 0.4; P.head.rotation.x = 0;
  if (o.atk !== undefined) { // crouch back, then lunge + bite
    const a = o.atk;
    if (a < 0.55) { const k = easeOut(a / 0.55); P.body.position.z = -0.35 * k; P.body.position.y = 0.78 - 0.16 * k; P.head.rotation.x = -0.3 * k; }
    else { const k = Math.min(1, (a - 0.55) / 0.15), b = a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1; P.body.position.z = lerp(-0.35, 0.8, k) * b; P.body.position.y = 0.78 + 0.25 * Math.sin(k * Math.PI) * b; P.head.rotation.x = 0.5 * k * b; }
  }
}

// ---- Balgor, the Ash Colossus
TEX.lava = canvasTex(256, (x, s) => {
  x.fillStyle = '#000'; x.fillRect(0, 0, s, s); x.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 9; i++) {
    let px = rand(s), py = rand(s), a = rand(TAU);
    x.strokeStyle = pass ? '#ffe9a0' : '#ff4a0a'; x.lineWidth = pass ? 1.5 : 5; x.shadowColor = '#ff3a00'; x.shadowBlur = pass ? 0 : 12;
    if (pass) { /* reuse the same seeds by re-walking deterministically is unnecessary – thin bright veins add extra variety */ }
    x.beginPath(); x.moveTo(px, py);
    for (let j = 0; j < 8; j++) { a += randS(0.9); px += Math.cos(a) * rand(12, 34); py += Math.sin(a) * rand(12, 34); x.lineTo(px, py); }
    x.stroke();
  }
});
TEX.lava.wrapS = TEX.lava.wrapT = THREE.RepeatWrapping;
function buildBalgor() {
  const root = new THREE.Group(), mats = [];
  const rock = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.92, metalness: 0.05, flatShading: true, emissive: 0xff5a14, emissiveMap: TEX.lava, emissiveIntensity: 2.2 });
  rock.userData.base = { c: 0x2b2420, e: 0xff5a14, ei: 2.2 }; mats.push(rock);
  const M = matFactory(mats), ash = M(0x16120f), core = M(0x220800, 0xff7a20, 5), eye = M(0x220800, 0xffd060, 6);
  const dod = (r) => geo('dod' + r, () => new THREE.DodecahedronGeometry(r, 0));
  const hips = new THREE.Group(); hips.position.y = 3.0; root.add(hips);
  part(boxG(2.6, 1.1, 1.7), ash, 0, 0.2, 0, hips);
  const mkLeg = (s) => { const l = new THREE.Group(); l.position.set(s * 0.95, 0, 0); hips.add(l); part(boxG(1.15, 2.2, 1.25), rock, 0, -1.3, 0, l); part(boxG(1.45, 0.75, 1.9), ash, 0, -2.62, 0.2, l); return l; };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = part(dod(2.0), rock, 0, 2.1, 0, torso); chest.scale.set(1.3, 1.05, 0.95);
  part(boxG(2.2, 1.2, 1.5), rock, 0, 0.9, 0, torso);
  part(geo('core', () => new THREE.IcosahedronGeometry(0.62, 1)), core, 0, 2.1, 1.55, torso);
  for (const s of [-1, 1]) { const sp = part(geo('spike', () => new THREE.ConeGeometry(0.5, 1.9, 5)), ash, s * 2.3, 3.6, -0.2, torso); sp.rotation.z = -s * 0.5; const sp2 = part(geo('spike'), ash, s * 1.3, 4.0, -0.7, torso); sp2.rotation.z = -s * 0.2; sp2.scale.setScalar(0.7); }
  const head = new THREE.Group(); head.position.set(0, 3.75, 0.5); torso.add(head);
  part(boxG(1.35, 1.2, 1.3), rock, 0, 0, 0, head);
  const jaw = part(boxG(1.1, 0.4, 1.0), ash, 0, -0.75, 0.25, head);
  part(boxG(0.8, 0.22, 0.2), core, 0, -0.52, 0.62, head);
  for (const s of [-1, 1]) { part(boxG(0.3, 0.16, 0.1), eye, s * 0.34, 0.18, 0.66, head); const h = part(geo('bhorn', () => new THREE.ConeGeometry(0.28, 1.7, 5)), ash, s * 0.85, 0.75, -0.1, head); h.rotation.z = -s * 0.75; h.rotation.x = -0.25; }
  const mkArm = (s) => { const a = new THREE.Group(); a.position.set(s * 2.75, 3.0, 0); torso.add(a); part(boxG(1.05, 2.3, 1.05), rock, 0, -1.0, 0, a); const f = part(dod(1.05), rock, 0, -2.9, 0.1, a); f.scale.set(1, 1.15, 1); part(boxG(1.3, 0.4, 1.3), ash, 0, -1.95, 0, a); return a; };
  const armL = mkArm(-1), armR = mkArm(1);
  return { root, mats, P: { hips, hipY: 3.0, torso, head, armL, armR, legL, legR, jaw }, kind: 'boss' };
}
/** o: walk, slam 0..1 (impact .7), breath 0..1, swipe 0..1 (impact .6), roar 0..1 */
function poseBalgor(P, t, o) {
  const w = o.walk || 0, sw = Math.sin(t * 3.2) * 0.45 * w;
  P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
  P.armL.rotation.set(-sw * 0.6, 0, 0.12 + Math.sin(t * 1.3) * 0.03); P.armR.rotation.set(sw * 0.6, 0, -0.12 - Math.sin(t * 1.3) * 0.03);
  P.hips.position.y = P.hipY + Math.abs(Math.cos(t * 3.2)) * 0.12 * w + Math.sin(t * 1.3) * 0.05;
  P.torso.rotation.set(0.06 + Math.sin(t * 1.3) * 0.02, 0, 0); P.head.rotation.set(0, 0, 0); P.jaw.position.y = -0.75;
  if (o.slam !== undefined) {
    const a = o.slam; let ang;
    if (a < 0.6) ang = -3.0 * easeOut(a / 0.6); else if (a < 0.7) ang = lerp(-3.0, -0.75, (a - 0.6) / 0.1); else ang = lerp(-0.75, 0, (a - 0.7) / 0.3);
    P.armL.rotation.x = P.armR.rotation.x = ang; P.torso.rotation.x = a < 0.6 ? -0.25 * easeOut(a / 0.6) : a < 0.7 ? lerp(-0.25, 0.5, (a - 0.6) / 0.1) : lerp(0.5, 0.06, (a - 0.7) / 0.3);
  }
  if (o.swipe !== undefined) {
    const a = o.swipe;
    if (a < 0.5) { const k = easeOut(a / 0.5); P.armR.rotation.x = -1.5 * k; P.armR.rotation.z = -1.1 * k; P.torso.rotation.y = -0.7 * k; }
    else if (a < 0.65) { const k = (a - 0.5) / 0.15; P.armR.rotation.x = -1.5; P.armR.rotation.z = lerp(-1.1, 0.9, k); P.torso.rotation.y = lerp(-0.7, 0.8, k); }
    else { const k = 1 - (a - 0.65) / 0.35; P.armR.rotation.x = -1.5 * k; P.armR.rotation.z = 0.9 * k; P.torso.rotation.y = 0.8 * k; }
  }
  if (o.breath !== undefined) { const k = Math.min(1, o.breath * 3) * Math.min(1, (1 - o.breath) * 6); P.torso.rotation.x = 0.42 * k; P.head.rotation.x = 0.1 * k; P.jaw.position.y = -0.75 - 0.35 * k; P.armL.rotation.z = 0.5 * k; P.armR.rotation.z = -0.5 * k; }
  if (o.roar !== undefined) { const k = Math.sin(Math.PI * Math.min(1, o.roar)); P.torso.rotation.x = -0.35 * k; P.head.rotation.x = -0.4 * k; P.jaw.position.y = -0.75 - 0.4 * k; P.armL.rotation.z = 0.9 * k; P.armR.rotation.z = -0.9 * k; P.armL.rotation.x = P.armR.rotation.x = -0.4 * k; }
}
// =====================================================================================
//  Heroes – definitions, .glb loading, smart animation mapping, afterimage ghosts
// =====================================================================================
const HEROES = {
  aurora: {
    id: 'aurora', name: 'Aurora', cls: 'Čarodejník', role: 'Mág na diaľku · arkánová a ohnivá mágia',
    desc: 'Majsterka arkánovej a ohnivej mágie. Spaľuje a zmrazuje celé svorky z bezpečnej vzdialenosti a zmizne skôr, než sa k nej niekto dostane.',
    files: ['aurora.glb'], height: 2.3, color: 0x9a6bff, css: '#a98bff',
    resName: 'Mana', res: ['#a9c0ff', '#3b55e0', '#0e1658'],
    hp: 320, mana: 160, manaRegen: 9, hpRegen: 2.5, speed: 7.4,
    anim: { idle: ['Idle_Base'], run: ['run_new_4'], death: ['Death'] },
    fallback: { skin: 0xe8d8ff, cloth: 0x5a3ca8, dark: 0x2a1c50, eye: 0x9fd0ff, hood: true, robe: true, sleeve: true, weapon: 'staff', orb: 0x8f7bff, scale: 1.25 },
    abilities: [
      { key: 'ĽTM', icon: 'orb', name: 'Arkánová strela', desc: 'Žiariaca guľa arkánovej energie, ktorá preletí bojiskom a vybuchne pri zásahu.', cd: 0, cost: 0, cast: 0.40, impact: 0.17, track: true, fn: 'arcaneBolt', anim: { clips: ['Attack1a', 'Attack2a'], kw: 'attack', at: 0.43, after: 0.45 } },
      { key: 'PTM', icon: 'snow', name: 'Mrazivá nova', desc: 'Prstenec ľadových úlomkov okolo Aurory. Zmrazí nepriateľov na 2,5 s.', cd: 7, cost: 30, cast: 0.55, impact: 0.24, fn: 'frostNova', anim: { clips: ['Spell3'], kw: 'cast', at: 0.38, after: 0.1 } },
      { key: '1', icon: 'meteor', name: 'Úder meteoru', desc: 'Na zemi sa rozžiari runový kruh a po chvíli doň dopadne horiaci meteor.', cd: 10, cost: 45, cast: 0.6, impact: 0.27, fn: 'meteor', anim: { clips: ['Spell1'], kw: 'cast', at: 0.57, after: 0.25 } },
      { key: '2', icon: 'bolt', name: 'Reťazový blesk', desc: 'Blesk, ktorý preskakuje až medzi 4 nepriateľmi.', cd: 5, cost: 25, cast: 0.42, impact: 0.16, track: true, fn: 'chainLightning', anim: { clips: ['Spell1'], kw: 'cast', at: 0.32, after: 0.4 } },
      { key: 'MEDZ', icon: 'blink', name: 'Arkánový skok', desc: 'Okamžitá teleportácia smerom ku kurzoru.', cd: 4, cost: 15, cast: 0.16, impact: 0.01, fn: 'blink', anim: null },
    ],
  },
  gwen: {
    id: 'gwen', name: 'Gwen', cls: 'Bojovník', role: 'Bojovníčka na blízko · seky a rázové vlny',
    desc: 'Neohrozená bojovníčka, ktorá sa vrhá do stredu boja. Ťažké seky, otrasy zeme a víriace čepele drvia všetko naokolo.',
    files: ['gwen.glb', 'battle_queen_gwen.glb'], height: 2.05, color: 0xffc64a, css: '#ffcf6a',
    resName: 'Zúrivosť', res: ['#ffe9a0', '#d98a14', '#4f2c05'],
    hp: 520, mana: 120, manaRegen: 8, hpRegen: 4, speed: 7.7,
    anim: { idle: ['Idle', 'Idle.anm'], run: ['Run', 'Run.anm'], death: ['Death'] },
    fallback: { skin: 0xf0d0b8, cloth: 0x8a1c24, dark: 0x30181a, metal: 0xc9a45c, eye: 0xffe9a0, armor: true, helm: true, weapon: 'sword', shield: true, scale: 1.3 },
    abilities: [
      { key: 'ĽTM', icon: 'slash', name: 'Mocný sek', desc: 'Široký žiariaci oblúk, ktorý zasiahne všetkých nepriateľov pred Gwen.', cd: 0, cost: 0, cast: 0.44, impact: 0.18, track: true, fn: 'cleave', anim: { clips: ['Attack1', 'Attack2', 'Attack3'], kw: 'attack', at: 0.40, after: 0.5 } },
      { key: 'PTM', icon: 'slam', name: 'Seizmický úder', desc: 'Gwen vyskočí a udrie do zeme. Vlna skál odhodí a omráči nepriateľov.', cd: 7, cost: 25, cast: 0.8, impact: 0.5, fn: 'seismicSlam', anim: { clips: ['Spell2'], kw: 'cast', at: 0.88, after: 0.3 } },
      { key: '1', icon: 'vortex', name: 'Vír čepelí', desc: '2,5 sekundy víriacej búrky čepelí. Počas nej sa dá voľne pohybovať.', cd: 12, cost: 40, cast: 2.5, impact: 0.12, mobile: true, fn: 'bladeVortex', anim: { clips: ['Spell1_0'], kw: 'attack', at: 0.7, after: 0.004 } },
      { key: '2', icon: 'roar', name: 'Dračí rev', desc: 'Zlatá aura zrýchli útoky a pohyb na 6 s. Rázová vlna zastraší okolie.', cd: 14, cost: 30, cast: 0.55, impact: 0.25, fn: 'dragonRoar', anim: { clips: ['Spell2'], kw: 'cast', at: 0.42, after: 0.1 } },
      { key: 'MEDZ', icon: 'charge', name: 'Výpad', desc: 'Bleskový výpad vpred, ktorý zraní všetkých v ceste.', cd: 5, cost: 15, cast: 0.3, impact: 0.01, mobile: true, fn: 'charge', anim: { clips: ['Spell3_Dash'], kw: 'dash', at: 0.12, after: 0.3 } },
    ],
  },
  ashe: {
    id: 'ashe', name: 'Ashe', cls: 'Lukostrelec', role: 'Strelkyňa na diaľku · mráz a pohyblivosť',
    desc: 'Presná lukostrelkyňa. Mrazivé šípy spomaľujú, salvy prerážajú celé rady a rýchly kotúľ ju dostane z každej pasce.',
    files: ['ashe.glb', 'sherwood_forest_ashe.glb'], height: 2.1, color: 0x6fe3ff, css: '#7fe6ff',
    resName: 'Energia', res: ['#b6fff4', '#17a89a', '#063d3a'],
    hp: 380, mana: 140, manaRegen: 10, hpRegen: 3, speed: 7.9,
    anim: { idle: ['Idle1'], run: ['Run'], death: ['Death'] },
    fallback: { skin: 0xf0d8c0, cloth: 0x2f6a3c, dark: 0x1a2a1c, eye: 0x9ff0ff, hood: true, weapon: 'bow', scale: 1.25 },
    abilities: [
      { key: 'ĽTM', icon: 'arrow', name: 'Mrazivý šíp', desc: 'Rýchly ľadový šíp, ktorý sa pri zásahu roztriešti a spomalí cieľ.', cd: 0, cost: 0, cast: 0.36, impact: 0.15, track: true, fn: 'frostArrow', anim: { clips: ['Attack1', 'Attack2'], kw: 'attack', at: 0.35, after: 0.5 } },
      { key: 'PTM', icon: 'volley', name: 'Salva', desc: 'Vejár 5 prerážajúcich mrazivých šípov.', cd: 5, cost: 22, cast: 0.48, impact: 0.2, track: true, fn: 'volley', anim: { clips: ['Spell2'], kw: 'cast', at: 0.3, after: 0.5 } },
      { key: '1', icon: 'rain', name: 'Dážď kryštálových šípov', desc: 'Svetlica vyletí k oblohe a na označený kruh 2 sekundy padajú ľadové oštepy.', cd: 11, cost: 45, cast: 0.6, impact: 0.3, fn: 'arrowRain', anim: { clips: ['Spell3'], kw: 'cast', at: 0.86, after: 0.2 } },
      { key: '2', icon: 'hawk', name: 'Jastrabí duch', desc: 'Prízračný jastrab nad Ashe zvyšuje šancu na kritický zásah a strieľa navádzané iskry.', cd: 16, cost: 30, cast: 0.4, impact: 0.18, fn: 'hawkshot', anim: { clips: ['Spell1'], kw: 'cast', at: 0.3, after: 0.3 } },
      { key: 'MEDZ', icon: 'roll', name: 'Tieňový kotúľ', desc: 'Kotúľ ku kurzoru. Na pôvodnom mieste zostane spomaľujúca ľadová pasca.', cd: 4, cost: 12, cast: 0.32, impact: 0.01, mobile: true, fn: 'shadowRoll', anim: { clips: [], kw: 'dash', at: 0.1, after: 1 } },
    ],
  },
};
const HERO_ORDER = ['aurora', 'gwen', 'ashe'];

// ------------------------------------------------------------------ smart animation mapper
const FADE = 0.15;
const SLOT_KEYWORDS = { idle: ['idle'], run: ['run', 'walk'], attack: ['attack', 'slash', 'shoot'], cast: ['skill', 'cast', 'spell'], dash: ['dash', 'roll'], hit: ['hit'], death: ['death', 'die'] };
const normName = (n) => n.toLowerCase().replace(/\.anm$/, '');
const tokens = (n) => n.replace(/\.anm$/i, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** score a clip for a slot: keyword must start a token; transitions / variants / directional copies are penalised */
function scoreClip(name, kws) {
  const tk = tokens(name); let best = -1;
  kws.forEach((kw, ki) => { if (tk.some((t) => t.startsWith(kw))) best = Math.max(best, 100 - ki * 8); });
  if (best < 0) return -1;
  const n = normName(name);
  if (tk.some((t) => /^(to|into)$/.test(t) || /^to(run|idle|walk|homeguard)/.test(t))) best -= 60;      // transitions
  if (tk.some((t) => /^in\d?$/.test(t) || /[a-z]{3,}in\d?$/.test(t))) best -= 30;                       // intro clips
  if (/passive|homeguard|wndup|winddown|recast|catch/.test(n)) best -= 45;
  if (/var|fast|slow/.test(n)) best -= 12;
  if (/(^|[^a-z])-?(90|179|180)/.test(n)) best -= 40;
  if (kws.some((kw) => n === kw || n === kw + '1' || n === kw + '_base' || n === kw + '_0')) best += 20;
  return best - n.length * 0.6;
}

class AnimCtl {
  constructor(model, clips, def, quiet) {
    this.mixer = new THREE.AnimationMixer(model);
    this.byName = {}; for (const c of clips) this.byName[normName(c.name)] = c;
    this.slots = {}; this.actions = new Map(); this.cycle = {}; this.base = null; this.one = null;
    for (const slot in SLOT_KEYWORDS) {
      let clip = this.find(def.anim?.[slot]);
      if (!clip) { let bs = -1; for (const c of clips) { const s = scoreClip(c.name, SLOT_KEYWORDS[slot]); if (s > bs) { bs = s; clip = c; } } if (bs < 0) clip = null; }
      this.slots[slot] = clip;
    }
    if (!quiet) console.log(`[${def.name}] mapovanie animácií:`, Object.fromEntries(Object.entries(this.slots).map(([k, v]) => [k, v ? v.name : '— (procedurálny pohyb)'])));
  }
  find(names) { if (!names) return null; for (const n of names) { const c = this.byName[normName(n)]; if (c) return c; } return null; }
  action(clip) { let a = this.actions.get(clip); if (!a) { a = this.mixer.clipAction(clip); this.actions.set(clip, a); } return a; }
  has(slot) { return !!this.slots[slot]; }
  /** looping base state (idle / run) with 0.15 s crossfade */
  setBase(slot, timeScale = 1) {
    const clip = this.slots[slot] || this.slots.idle; if (!clip) return;
    const a = this.action(clip); a.timeScale = timeScale;
    if (this.base === a) return;
    const prev = this.base; this.base = a;
    if (this.one) return;                       // a one-shot is playing; base resumes on release()
    a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play();
    if (prev) prev.fadeOut(FADE);
  }
  /** one-shot scaled so that clip time `spec.at` is reached exactly `impact` seconds from now (VFX sync) */
  playOnce(spec, impact) {
    if (!spec) return false;
    let clip = null;
    const list = (spec.clips || []).map((n) => this.byName[normName(n)]).filter(Boolean);
    if (list.length) { const k = spec.clips.join(); this.cycle[k] = ((this.cycle[k] ?? -1) + 1) % list.length; clip = list[this.cycle[k]]; }
    else if (spec.kw) clip = this.slots[spec.kw];
    if (!clip) return false;
    const a = this.action(clip), at = Math.min(spec.at ?? clip.duration * 0.4, clip.duration * 0.96), ts = at / Math.max(0.04, impact);
    const prev = this.one ? this.one.a : this.base, fade = Math.min(FADE, Math.max(0.05, impact * 0.6));
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts;
    if (prev === a) a.setEffectiveWeight(1).play();
    else { a.fadeIn(fade).play(); if (prev) prev.fadeOut(fade); }
    this.one = { a, at, tsAfter: ts * (spec.after ?? 1), switched: false };
    return true;
  }
  release() {
    if (!this.one) return; const a = this.one.a; this.one = null;
    a.fadeOut(FADE);
    if (this.base && this.base !== a) this.base.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play();
    else if (this.base) { a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play(); }
  }
  playDeath() {
    const clip = this.slots.death; if (!clip) return false;
    const a = this.action(clip), prev = this.one ? this.one.a : this.base; this.one = { a, at: 1e9, tsAfter: 1, switched: true };
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 1; a.fadeIn(FADE).play(); if (prev && prev !== a) prev.fadeOut(FADE);
    return true;
  }
  stopAll() { this.mixer.stopAllAction(); this.one = null; this.base = null; }
  update(dt) {
    const o = this.one;
    if (o && !o.switched && o.a.time >= o.at) { o.a.timeScale = o.tsAfter; o.switched = true; }
    this.mixer.update(dt);
  }
}

/** same interface as AnimCtl, but drives the procedural biped (used when a .glb is missing) */
class ProcAnim {
  constructor(P) { this.P = P; this.t = 0; this.walk = 0; this.wantWalk = 0; this.one = null; this.dead = -1; }
  has() { return false; }
  setBase(slot, ts = 1) { this.wantWalk = slot === 'run' ? 1 : 0; this.freq = 10 * ts; }
  playOnce(spec, impact) { this.one = { t: 0, impact, kind: spec && spec.kw === 'cast' ? 'cast' : 'atk' }; return true; }
  release() { this.one = null; }
  playDeath() { this.dead = 0; return false; }
  stopAll() { this.one = null; this.dead = -1; }
  update(dt) {
    this.t += dt; this.walk = lerp(this.walk, this.wantWalk, 1 - Math.exp(-dt / FADE * 3));
    const o = { walk: this.walk, freq: this.freq };
    if (this.one) { this.one.t += dt; const a = Math.min(1, (this.one.t / this.one.impact) * 0.65); if (this.one.kind === 'cast') o.cast = a * 0.8; else o.atk = a; }
    poseBiped(this.P, this.t, o);
  }
}

// ------------------------------------------------------------------ model loading (./models/ first, then ./)
const gltfLoader = new GLTFLoader();
const heroCache = {};
function convertUnlit(src, out) {
  if (/smear/i.test(src.name)) { // weapon swing smear → glowing additive trail
    const m = new THREE.MeshBasicMaterial({ map: src.map || null, color: hdr(0xbff4ff, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.name = src.name; m.userData.fx = true; return m;
  }
  // LoL-style exports are unlit; give them a lit material that keeps part of the baked look as emissive
  const m = new THREE.MeshLambertMaterial({
    map: src.map || null, color: src.map ? 0xffffff : src.color, emissive: 0xffffff, emissiveMap: src.map || null, emissiveIntensity: 0.34,
    alphaTest: src.transparent || src.alphaTest > 0 ? 0.4 : 0, side: src.side, transparent: false,
  });
  m.name = src.name; out.push(m); return m;
}
const heroPending = {};
/** one load per hero at a time; a failed download is NOT cached, so the next attempt tries the real model again */
function loadHero(id, onStatus) {
  if (heroCache[id]) return Promise.resolve(heroCache[id]);
  if (!heroPending[id]) heroPending[id] = loadHeroOnce(id, onStatus).finally(() => { delete heroPending[id]; });
  return heroPending[id];
}
async function fetchHeroGLTF(def, onStatus) {
  let netError = false;
  for (const base of ['./', './models/']) for (const f of def.files) {
    const url = base + f;
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!head.ok) continue;                                   // missing file → try the next location quietly
    } catch (e) { netError = true; continue; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        onStatus && onStatus(`Načítavam ${f} …`);
        const g = await gltfLoader.loadAsync(url, (e) => { if (e.total && onStatus) onStatus(`Načítavam ${f} … ${Math.round(e.loaded / e.total * 100)} %`); });
        g.url = url; return { gltf: g };
      } catch (e) { netError = true; console.warn(`[${def.name}] pokus ${attempt + 1} o načítanie ${url} zlyhal`, e); await new Promise((r) => setTimeout(r, 600)); }
    }
  }
  return { gltf: null, netError };
}
async function loadHeroOnce(id, onStatus) {
  const def = HEROES[id];
  const { gltf, netError } = await fetchHeroGLTF(def, onStatus);
  const url = gltf ? gltf.url : '';
  const rig = { def, root: new THREE.Group(), pivot: new THREE.Group(), holder: new THREE.Group(), mats: [], ghosts: [], gi: 0, isGltf: !!gltf };
  rig.pivot.position.y = 1; rig.holder.position.y = -1; rig.root.add(rig.pivot); rig.pivot.add(rig.holder);
  if (gltf) {
    const model = gltf.scene;
    console.log(`%c[${def.name}] ${url} – ${gltf.animations.length} animácií:`, 'color:#c9a45c;font-weight:bold');
    console.log(gltf.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`).join(', '));
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      if (/smear/i.test([].concat(o.material)[0].name)) o.castShadow = o.receiveShadow = false;
      o.material = Array.isArray(o.material) ? o.material.map((m) => convertUnlit(m, rig.mats)) : convertUnlit(o.material, rig.mats);
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(def.height / Math.max(0.01, box.max.y));
    rig.model = model; rig.anim = new AnimCtl(model, gltf.animations, def);
  } else {
    console.warn(`[${def.name}] model sa nenašiel (${def.files.join(', ')}) v ./models/ ani v ./ – používam náhradnú procedurálnu postavu.`);
    const b = buildBiped(def.fallback);
    b.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    rig.model = b.root; rig.mats = b.mats; rig.anim = new ProcAnim(b.P);
  }
  rig.holder.add(rig.model);
  // afterimage ghosts: pose snapshots of the rig rendered additively
  rig.nodes = []; rig.model.traverse((o) => rig.nodes.push(o));
  for (let i = 0; i < 5; i++) {
    const g = SkeletonUtils.clone(rig.model), mats = [], wrap = new THREE.Group(), nodes = [];
    g.traverse((o) => {
      nodes.push(o); if (!o.isMesh) return;
      const mk = (s) => { const m = new THREE.MeshBasicMaterial({ map: s.map || null, alphaTest: s.alphaTest || 0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); mats.push(m); return m; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material); o.castShadow = o.receiveShadow = false; o.frustumCulled = false;
    });
    wrap.add(g); wrap.matrixAutoUpdate = false; wrap.visible = false; fxRoot.add(wrap);
    rig.ghosts.push({ wrap, nodes, mats, busy: false });
  }
  rig.netError = !gltf && netError;
  if (gltf) heroCache[id] = rig;          // fallbacks are not cached → a later attempt loads the real model
  return rig;
}
/** freeze the current pose into a fading additive afterimage */
function spawnGhost(rig, color, dur = 0.35, opacity = 0.7) {
  const g = rig.ghosts[rig.gi]; rig.gi = (rig.gi + 1) % rig.ghosts.length;
  rig.holder.updateWorldMatrix(true, false);
  g.wrap.matrix.copy(rig.holder.matrixWorld); g.wrap.matrixWorldNeedsUpdate = true;
  for (let i = 0; i < g.nodes.length; i++) { const s = rig.nodes[i], d = g.nodes[i]; d.position.copy(s.position); d.quaternion.copy(s.quaternion); d.scale.copy(s.scale); }
  const c = hdr(color, 1.6); for (const m of g.mats) m.color.copy(c);
  g.wrap.visible = true; g.token = (g.token || 0) + 1; const tok = g.token; let t = 0;
  addFx((dt) => { if (g.token !== tok) return false; t += dt; const o = opacity * (1 - t / dur); for (const m of g.mats) m.opacity = o; return t < dur; }, () => { if (g.token === tok) g.wrap.visible = false; });
}
function flashRig(rig, r, g, b, k) {
  for (const m of rig.mats) {
    if (rig.isGltf) { m.color.setRGB(lerp(1, r, k), lerp(1, g, k), lerp(1, b, k)); m.emissiveIntensity = 0.34 + k * 0.9; }
    else { const bs = m.userData.base; m.emissive.setHex(bs.e).lerp(_c.setRGB(r, g, b), k); m.emissiveIntensity = lerp(bs.ei, 1.5, k); }
  }
}
// =====================================================================================
//  MONSTER MODELS (./monsters/*.glb) – loading, per-instance clones, animation specs
//  "at" = clip time of the hit frame; the clip is time-scaled so that frame lands exactly
//  on the gameplay impact (wind-up) moment.  If a file is missing the procedural mesh is used.
// =====================================================================================
const MONSTER_MODELS = {
  wolf: { files: ['murk_wolf_(mini).glb', 'murk_wolf_mini.glb'], scale: 1.45,
    idle: ['SRU_MurkwolfMini_idle_aggro1.anm', 'SRU_MurkwolfMini_idle1.anm'], run: ['Run_Base'], death: ['Death_Base', 'SRU_Murkwolf_death2.anm'],
    attacks: [{ clips: ['Attack1_BASE'], at: 0.66 }, { clips: ['Attack2_BASE'], at: 0.66 }], runSpeed: 8 },
  alpha: { files: ['murk_wolf.glb'], scale: 1.9,
    idle: ['SRU_Murkwolf_idle_aggro1.anm', 'SRU_Murkwolf_idle1.anm'], run: ['Run_Base'], death: ['SRU_Murkwolf_Death.anm', 'SRU_Murkwolf_death2.anm'],
    attacks: [{ clips: ['Attack1_BASE'], at: 0.66 }, { clips: ['SRU_Murkwolf_pounce.anm'], at: 0.36 }], runSpeed: 8 },
  wolfLord: { files: ['murk_wolf.glb'], scale: 3.0,
    idle: ['SRU_Murkwolf_idle_aggro2.anm', 'SRU_Murkwolf_idle_aggro1.anm'], run: ['Run_Base'], death: ['SRU_Murkwolf_Death.anm'],
    attacks: [{ clips: ['Attack1_BASE'], at: 0.66 }, { clips: ['Attack2_BASE'], at: 0.66 }], runSpeed: 8,
    moves: { pounce: { clips: ['SRU_Murkwolf_pounce.anm', 'Attack2_BASE'], at: 0.36, after: 0.6 } } },
  krugKing: { files: ['krug.glb'], scale: 2.5,
    idle: ['Krug_Idle_Aggro3.anm', 'Krug_Idle_Aggro.anm'], run: ['Run'], death: ['Death'],
    attacks: [{ clips: ['Attack1'], at: 0.9 }, { clips: ['Attack3'], at: 0.9 }], runSpeed: 6,
    moves: { quake: { clips: ['Attack2', 'Attack1'], at: 0.9, after: 0.5 } } },
  scarecrow: { files: ['fiddlesticks mini boss.glb'], scale: 1.75,
    idle: ['IdleA', 'Fiddlesticks_Idle2_Loop.anm'], run: ['Run_Base'], death: ['Death'],
    attacks: [{ clips: ['Fiddlesticks_Attack_Melee_1_A.anm'], at: 0.3, after: 0.6 }, { clips: ['Fiddlesticks_Attack_Melee_2_A.anm'], at: 0.33, after: 0.6 }], runSpeed: 6,
    moves: { storm: { clips: ['Spell4'], at: 1.1, after: 0.3 }, fear: { clips: ['Spell1'], at: 0.22, after: 0.5 }, wind: { clips: ['Spell3_Long'], at: 0.35, after: 0.7 } } },
  goblin: { files: ['krug.glb'], scale: 1.3,
    idle: ['Krug_Idle_Aggro2.anm', 'Krug_Idle_Aggro.anm'], run: ['Run'], death: ['Death'],
    attacks: [{ clips: ['Attack2'], at: 0.5 }, { clips: ['Attack1'], at: 0.9 }], runSpeed: 6 },
  skeleton: { files: ['red_brambleback.glb'], scale: 2.15,
    idle: ['SRU_Red_Idle1_aggro.anm', 'SRU_Red_Idle1.anm'], run: ['Run'], death: ['Death'],
    attacks: [{ clips: ['Attack1'], at: 0.72 }, { clips: ['Attack2'], at: 0.9 }, { clips: ['Attack3'], at: 0.9 }], runSpeed: 4.5 },
  cultist: { files: ['blue_sentinel.glb'], scale: 1.25,
    idle: ['SRU_Blue_Idle_aggro.anm', 'Idle1_Base'], run: ['Run'], death: ['Death'],
    attacks: [{ clips: ['Attack2'], at: 0.62 }, { clips: ['Attack1'], at: 0.62 }], runSpeed: 4.5 },
  archer: { files: ['drakling.glb', 'dragon.glb'], scale: 0.62,
    idle: ['SRU_dragon_idle_aggro1.anm', 'SRU_dragon_idle_normal.anm'], run: ['Run', 'SRU_Dragon_flying_Run.anm'], death: ['Death'],
    attacks: [{ clips: ['Boss_Bite'], at: 0.55 }], runSpeed: 7 },
  imp: { files: ['drakling.glb', 'dragon.glb'], scale: 0.85,
    idle: ['SRU_dragon_idle_aggro1.anm', 'SRU_dragon_idle_normal.anm'], run: ['Run', 'SRU_Dragon_flying_Run.anm'], death: ['Death'],
    attacks: [{ clips: ['Boss_Bite'], at: 0.55 }], runSpeed: 7 },
  boss: { files: ['fire_drake.glb', 'dragon_(fire).glb', 'dragon_fire.glb'], scale: 2.7,
    idle: ['SRU_dragon_idle_aggro1.anm', 'SRU_dragon_idle_normal.anm'], run: ['Run', 'SRU_Dragon_flying_Run.anm'], death: ['Death'],
    attacks: [{ clips: ['Boss_Bite'], at: 0.55 }], runSpeed: 4,
    moves: { slam: { clips: ['Boss_Slam', 'Landing'], at: 1.15 }, swipe: { clips: ['Boss_TailSwipe'], at: 0.65 }, bite: { clips: ['Boss_Bite'], at: 0.55 },
      breath: { clips: ['Boss_Breath'], at: 0.9, fireLen: 1.6 }, roar: { clips: ['Boss_Roar'], at: 0.45 }, summon: { clips: ['Boss_Roar'], at: 0.45 }, meteors: { clips: ['Boss_Roar'], at: 0.45 } } },
};
const MONSTER_CACHE = {}, monsterPending = {}, monsterFiles = {};
function loadMonsterFile(f) {
  if (!monsterFiles[f]) monsterFiles[f] = (async () => {
    const url = './monsters/' + encodeURIComponent(f);
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (!head.ok) return null;
    return gltfLoader.loadAsync(url);
  })().catch((e) => { console.warn(`[príšera] ${f} sa nepodarilo načítať`, e); delete monsterFiles[f]; return null; });
  return monsterFiles[f];
}
function loadMonster(type) {
  const M = MONSTER_MODELS[type]; if (!M) return Promise.resolve(null);
  if (type in MONSTER_CACHE) return Promise.resolve(MONSTER_CACHE[type]);
  if (!monsterPending[type]) monsterPending[type] = (async () => {
    for (const f of M.files) {
      try {
        const g = await loadMonsterFile(f); if (!g) continue;
        if (g.userData.converted) { console.log(`[príšera] ${type}: ${f} (zdieľaný model)`); return (MONSTER_CACHE[type] = { gltf: g, file: f }); }
        g.userData.converted = true;
        const mats = new Map();
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          const conv = (m) => { if (!mats.has(m)) mats.set(m, convertUnlit(m, [])); return mats.get(m); };
          o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        });
        console.log(`[príšera] ${type}: ${f} – ${g.animations.length} animácií`);
        return (MONSTER_CACHE[type] = { gltf: g, file: f });
      } catch (e) { console.warn(`[príšera] ${type}: ${f} sa nepodarilo načítať`, e); }
    }
    console.warn(`[príšera] ${type}: model sa nenašiel v ./monsters/ – používam procedurálnu postavu`);
    return (MONSTER_CACHE[type] = null);
  })();
  return monsterPending[type];
}
const ZONE_MONSTERS = { wild: ['wolf', 'alpha', 'goblin', 'archer', 'wolfLord', 'krugKing', 'scarecrow'], crypt: ['skeleton', 'cultist'], sanctum: ['boss', 'imp'], town: [] };
function loadZoneMonsters(id) { return Promise.all((ZONE_MONSTERS[id] || []).map(loadMonster)); }

/** builds a skinned clone with its own materials (hit flash / freeze tint) and animation controller */
function buildMonster(type) {
  const C = MONSTER_CACHE[type]; if (!C) return null;
  const M = MONSTER_MODELS[type], root = new THREE.Group(), model = SkeletonUtils.clone(C.gltf.scene), mats = [];
  model.scale.setScalar(M.scale);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const cl = (m) => { const c = m.clone(); c.userData.base = { c: m.color ? m.color.getHex() : 0xffffff, e: m.emissive ? m.emissive.getHex() : 0, ei: m.emissiveIntensity ?? 0 }; mats.push(c); return c; };
    o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
  });
  root.add(model);
  const anim = new AnimCtl(model, C.gltf.animations, { name: type, anim: { idle: M.idle, run: M.run, death: M.death } }, true);
  anim.setBase('idle');
  const bone = (n) => { let r = null; model.traverse((o) => { if (!r && o.name === n) r = o; }); return r; };
  return { root, mats, P: null, kind: 'gltf', anim, model, M, mouth: bone('Buffbone_Cstm_FireStart') || bone('Jaw') || bone('Head') };
}
// =====================================================================================
//  Enemies – definitions, AI, status effects, boss
// =====================================================================================
const actorRoot = new THREE.Group();
scene.add(actorRoot);

const ENEMY_DEFS = {
  wolf: { name: 'Šerý vlk', hp: 55, dmg: 12, speed: 8.4, radius: 0.8, h: 1.5, range: 2.0, windup: 0.34, recover: 0.5, cd: 1.1, aggro: 15, loot: 0.2,
    build: () => buildWolf({ fur: 0x4d525c, dark: 0x2b2e35, eye: 0xffb020, scale: 1.15 }) },
  alpha: { name: 'Vodca svorky', hp: 170, dmg: 22, speed: 8.0, radius: 1.0, h: 1.9, range: 2.6, windup: 0.4, recover: 0.5, cd: 1.3, aggro: 16, loot: 0.45, kbRes: 0.4,
    build: () => buildWolf({ fur: 0x3a3d44, dark: 0x1e2026, eye: 0xff5020, scale: 1.5 }) },
  goblin: { name: 'Skalný krug', hp: 85, dmg: 15, speed: 6.0, radius: 0.85, h: 1.8, range: 1.9, windup: 0.42, recover: 0.45, cd: 1.2, aggro: 14, loot: 0.22,
    build: () => buildBiped({ skin: 0x5f8a3a, cloth: 0x4a3424, dark: 0x2a2018, eye: 0xffe040, ears: true, weapon: 'club', scale: 0.88 }) },
  archer: { name: 'Ohnivé dráča', hp: 64, dmg: 16, speed: 5.2, radius: 0.9, h: 1.7, ranged: true, range: 17, pref: [8, 12.5], windup: 0.7, recover: 0.45, cd: 2.3, aggro: 17, proj: 'fireBolt', projSpeed: 19, loot: 0.26,
    build: () => buildBiped({ skin: 0x8a7a70, cloth: 0x2a2338, dark: 0x15131c, eye: 0xb04dff, hood: true, sleeve: true, weapon: 'bow', scale: 1.1 }) },
  skeleton: { name: 'Tŕňochrbát', hp: 260, dmg: 32, speed: 4.2, radius: 1.25, h: 2.6, range: 3.2, windup: 0.8, recover: 0.6, cd: 1.7, aggro: 15, heavy: true, kbRes: 0.55, loot: 0.32,
    build: () => buildBiped({ skin: 0xd8d2be, cloth: 0x3b3f48, dark: 0x8c8674, metal: 0x596070, eye: 0x40e0ff, armor: true, helm: true, jaw: true, weapon: 'sword', shield: true, scale: 1.48 }) },
  cultist: { name: 'Modrý strážca', hp: 170, dmg: 24, speed: 4.0, radius: 1.3, h: 2.8, ranged: true, range: 18, pref: [8.5, 13], windup: 0.95, recover: 0.5, cd: 2.7, aggro: 17, proj: 'runeOrb', projSpeed: 13, loot: 0.32,
    build: () => buildBiped({ skin: 0x3a2a40, cloth: 0x3a1030, dark: 0x1a0818, eye: 0xff3080, hood: true, robe: true, sleeve: true, weapon: 'staff', orb: 0xb020ff, scale: 1.25 }) },
  imp: { name: 'Dráčatko', hp: 100, dmg: 16, speed: 7.2, radius: 0.95, h: 1.9, range: 2.3, windup: 0.36, recover: 0.45, cd: 1.1, aggro: 60, loot: 0.08,
    build: () => { const b = buildBiped({ skin: 0x3a1a10, cloth: 0x2a120a, dark: 0x1a0a06, eye: 0xffa020, horns: true, weapon: 'dagger', scale: 0.92 }); b.mats[0].emissive.setHex(0xff4a10); b.mats[0].emissiveIntensity = 0.6; b.mats[0].userData.base.e = 0xff4a10; b.mats[0].userData.base.ei = 0.6; return b; } },
  wolfLord: { name: 'Šedohrivý, vodca svorky', hp: 1100, dmg: 34, speed: 7.4, radius: 1.6, h: 3.0, range: 3.4, windup: 0.5, recover: 0.6, cd: 1.5, aggro: 16, loot: 1, kbRes: 0.85, mini: true,
    build: () => buildWolf({ fur: 0x2a2c33, dark: 0x15161a, eye: 0xff3010, scale: 2.4 }) },
  krugKing: { name: 'Gromm, kamenný kráľ', hp: 1400, dmg: 42, speed: 4.4, radius: 1.8, h: 3.4, range: 3.6, windup: 0.75, recover: 0.7, cd: 1.8, aggro: 16, loot: 1, kbRes: 0.9, heavy: true, mini: true,
    build: () => buildBiped({ skin: 0x6a6258, cloth: 0x4a4038, dark: 0x2a2420, eye: 0xffa020, armor: true, weapon: 'club', scale: 1.9 }) },
  scarecrow: { name: 'Fiddlesticks, Prastarý strach', hp: 1300, dmg: 36, speed: 5.4, radius: 1.3, h: 3.4, range: 3.4, windup: 0.42, recover: 0.6, cd: 1.4, aggro: 16, loot: 1, kbRes: 0.9, mini: true,
    build: () => buildBiped({ skin: 0x6a4a30, cloth: 0x3a2a1a, dark: 0x1a1008, eye: 0x7fff40, hood: true, robe: true, sleeve: true, weapon: 'staff', orb: 0x7fff40, scale: 1.7 }) },
  boss: { name: 'Ignarax, Ohnivý drak', hp: 5200, dmg: 55, speed: 3.3, radius: 3.0, h: 6.5, range: 7, aggro: 26, boss: true, kbRes: 1, build: buildBalgor },
};

function spawnEnemy(type, x, z, o = {}) {
  const def = ENEMY_DEFS[type], b = buildMonster(type) || def.build();
  const e = {
    type, def, root: b.root, mats: b.mats, P: b.P, kind: b.kind, pos: b.root.position, anim: b.anim || null, M: b.M || null, mouthBone: b.mouth || null,
    hp: def.hp * tierHp(), maxHp: def.hp * tierHp(), radius: def.radius, facing: o.facing ?? rand(TAU), state: 'idle', st: 0, hit: false,
    atkCd: rand(0.2, 1.0), frozen: 0, stun: 0, slow: 0, slowF: 1, kb: new V3(), flash: 0, dead: false, deadT: 0,
    aggro: !!o.aggro, opt: !!o.opt, animT: rand(10), walk: 0, moving: false, home: new V3(x, 0, z), wanderT: rand(1, 5), wander: null, strafe: Math.random() < 0.5 ? 1 : -1, ice: null,
  };
  e.root.position.set(x, 0, z); e.root.rotation.order = 'YXZ'; e.root.rotation.y = e.facing;
  if (def.boss) { e.summons = [0.75, 0.5, 0.25]; e.act = null; e.atkCd = 1.5; }
  if (def.mini) { e.howls = type === 'scarecrow' ? [] : [0.6, 0.3]; e.specCd = 3; e.sp = null; e.spN = 0; }
  actorRoot.add(e.root); G.enemies.push(e);
  if (o.fx) { burst(x, 0.5, z, { n: 26, color: 0xff5a14, color2: 0x30100a, int: 2.5, up: 1.4, s0: 2, s1: 8, size: 0.5, l0: 0.3, l1: 0.8, r: 0.6 }); ringFx(x, z, { color: 0xff4a10, r0: 0.5, r1: 3, dur: 0.4 }); }
  return e;
}
const aliveEnemies = () => G.enemies.filter((e) => !e.dead);
function nearestEnemy(x, z, maxD, skip) {
  let best = null, bd = maxD;
  for (const e of G.enemies) { if (e.dead || (skip && skip.has(e))) continue; const d = Math.hypot(e.pos.x - x, e.pos.z - z) - e.radius; if (d < bd) { bd = d; best = e; } }
  return best;
}
function alertPack(e) { for (const o of G.enemies) if (!o.dead && !o.aggro && dist2D(o.pos, e.pos) < 10) o.aggro = true; e.aggro = true; }
function faceTo(e, target, dt, rate) { const want = Math.atan2(target.x - e.pos.x, target.z - e.pos.z); e.facing += clamp(angDiff(e.facing, want), -rate * dt, rate * dt); }
function moveEnemy(e, dx, dz, speed, dt) { const l = Math.hypot(dx, dz) || 1; e.pos.x += dx / l * speed * dt; e.pos.z += dz / l * speed * dt; e.moving = true; }

function freezeEnemy(e, sec) {
  if (e.def.boss) { e.slow = Math.max(e.slow, 1.5); e.slowF = Math.min(e.slowF, 0.55); return; }
  e.frozen = Math.max(e.frozen, sec);
  if (!e.ice) { e.ice = getShard('ice'); e.ice.scale.set(e.radius * 3.1, e.def.h * 0.8, e.radius * 3.1); e.ice.position.copy(e.pos); e.ice.rotation.y = rand(TAU); e.ice.material.opacity = 0.5; }
}
function unfreeze(e, shatter = true) {
  e.frozen = 0;
  if (e.ice) { freeShard(e.ice); e.ice = null; if (shatter) burst(e.pos.x, 1, e.pos.z, { n: 14, color: 0xbfe9ff, color2: 0x4aa8ff, int: 2, s0: 2, s1: 7, size: 0.35, grav: 14, l0: 0.3, l1: 0.7, h: 1 }); }
}

/** all damage dealt by the player goes through here */
function damageEnemy(e, base, o = {}) {
  if (e.dead) return 0;
  const p = G.player, st = p.st;
  let dmg = base * st.dmgMul * rand(0.92, 1.08);
  const crit = Math.random() < st.crit + (p.focusT > 0 ? 0.3 : 0);
  if (crit) dmg *= st.critDmg;
  if (e.frozen > 0) dmg *= 1.15;
  dmg = Math.max(1, Math.round(dmg)); e.hp -= dmg; e.flash = 1;
  if (!e.aggro) alertPack(e);
  dmgNumber(e.pos.x + randS(0.4), e.def.h, e.pos.z, crit ? dmg + '!' : dmg, crit ? 'crit' : ''); sfx(crit ? 'crit' : 'hit', e.pos, 0.7);
  if (o.kb && !e.def.boss) { const f = o.from || p.pos; _ld.set(e.pos.x - f.x, 0, e.pos.z - f.z); if (_ld.lengthSq() < 1e-4) _ld.set(0, 0, 1); e.kb.addScaledVector(_ld.normalize(), o.kb * (1 - (e.def.kbRes || 0))); }
  if (o.freeze) freezeEnemy(e, o.freeze);
  if (o.stun && !e.def.boss) { e.stun = Math.max(e.stun, o.stun); if (e.state === 'attack' && !e.hit) e.state = 'chase'; }
  if (o.slow) { e.slow = Math.max(e.slow, o.slowT || 2); e.slowF = Math.min(e.slowF, 1 - o.slow * (e.def.boss ? 0.4 : 1)); }
  if (crit) shake(0.16);
  if (e.def.boss || e === G.miniBoss) updateBossBar();
  if (e.hp <= 0) killEnemy(e);
  return dmg;
}
function killEnemy(e) {
  if (e.dead) return; e.dead = true; e.deadT = 0; e.hp = 0; unfreeze(e); sfx('death', e.pos, e.def.boss ? 1.5 : 0.8);
  if (e.anim) e.hasDeathClip = e.anim.playDeath();
  burst(e.pos.x, 1, e.pos.z, { n: 12, color: 0xff8a40, color2: 0xffffff, int: 1.6, s0: 2, s1: 6, size: 0.3, l0: 0.2, l1: 0.5 });
  gainXP(XP_OF[e.type] || 10, e.pos.x, e.pos.z);
  if (e.def.boss) { bossDeath(e); return; }
  rollLoot(e);
  if (e === G.miniBoss) { G.miniBoss = null; showBossBar(false); banner(e.def.name.split(',')[0] + ' padol!', 'Voliteľná výzva splnená'); shake(0.6); sfx('levelUp', null, 0.6); }
  if (!G.boss && !G.zone.def.boss && !G.zone.portalOpen && aliveEnemies().filter((o) => !o.opt).length === 0) openPortal();
  updateObjective();
}

function enemyStrike(e) {
  const p = G.player, def = e.def, fx = Math.sin(e.facing), fz = Math.cos(e.facing);
  if (def.ranged) {
    const orb = def.proj === 'darkOrb' || def.proj === 'runeOrb' || def.proj === 'fireBolt';
    sfx(orb ? 'enemyCast' : 'enemyBow', e.pos, 0.7);
    let y = def.h * 0.62, ox = e.pos.x + fx * (e.radius + 0.4), oz = e.pos.z + fz * (e.radius + 0.4);
    if (e.mouthBone && def.proj === 'fireBolt') { e.mouthBone.getWorldPosition(_bm); ox = _bm.x; oz = _bm.z; y = Math.max(0.8, _bm.y); }
    let dx = p.pos.x - ox, dz = p.pos.z - oz; const l = Math.hypot(dx, dz) || 1;
    spawnProjectile({ kind: def.proj, x: ox, y, z: oz, dx: dx / l, dz: dz / l, speed: def.projSpeed, dmg: def.dmg, team: 'enemy', range: 26, homing: orb ? (def.proj === 'fireBolt' ? 0.7 : 1.3) : 0 });
    flash(ox, y, oz, def.proj === 'fireBolt' ? 0xff7a20 : def.proj === 'runeOrb' ? 0x3a8cff : def.proj === 'darkOrb' ? 0xb020ff : 0x8a4dff, 1.6, 0.18);
    return;
  }
  sfx('enemySwing', e.pos, def.heavy ? 1 : 0.6);
  slashFx(e.pos.x, e.pos.z, e.facing, { r: def.range + 0.4, arc: def.heavy ? 2.2 : 1.6, color: 0xff5030, color2: 0xffd0a0, dur: 0.18, y: def.h * 0.45, int: 1.6, tilt: 0.1 });
  const d = dist2D(e.pos, p.pos);
  if (d <= def.range + p.radius + 0.5) {
    const a = Math.abs(angDiff(e.facing, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z)));
    if (a < (def.heavy ? 1.15 : 1.3)) damagePlayer(def.dmg, e.pos, def.heavy ? 9 : 3);
  }
  if (def.heavy) { shake(0.25); burst(e.pos.x + fx * 2, 0.2, e.pos.z + fz * 2, { n: 10, smoke: true, color: 0x6a6258, int: 1, s0: 1, s1: 4, size: 1.2, size1: 2.5, l0: 0.4, l1: 0.9, flat: true }); }
}

function updateAI(e, dt) {
  const p = G.player, def = e.def, d = dist2D(e.pos, p.pos);
  if (!e.aggro) {
    if (!p.dead && d < def.aggro) { alertPack(e); return; }
    e.wanderT -= dt;
    if (e.wanderT <= 0) { e.wanderT = rand(2.5, 6); e.wander = Math.random() < 0.7 ? new V3(e.home.x + randS(4), 0, e.home.z + randS(4)) : null; }
    if (e.wander) { if (dist2D(e.pos, e.wander) < 0.5) e.wander = null; else { faceTo(e, e.wander, dt, 5); moveEnemy(e, e.wander.x - e.pos.x, e.wander.z - e.pos.z, def.speed * 0.3, dt); } }
    return;
  }
  if (p.dead) { e.state = 'idle'; return; }
  const sp = def.speed * e.slowF;
  if (e.state === 'attack') {
    e.st += dt * (e.slowF < 1 ? 0.75 : 1);
    if (e.st < def.windup * (def.ranged ? 0.95 : 0.55)) faceTo(e, p.pos, dt, def.heavy ? 3 : 7);
    if (!e.hit && e.st >= def.windup) { e.hit = true; enemyStrike(e); }
    if (e.st >= def.windup + def.recover) { e.state = 'chase'; e.atkCd = def.cd * rand(0.8, 1.25); if (e.anim) e.anim.release(); }
    return;
  }
  e.atkCd -= dt; faceTo(e, p.pos, dt, 8);
  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
  if (def.ranged) {
    if (d > def.pref[1]) moveEnemy(e, dx, dz, sp, dt);
    else if (d < def.pref[0]) moveEnemy(e, -dx, -dz, sp * 0.75, dt);
    else moveEnemy(e, -dz * e.strafe, dx * e.strafe, sp * 0.35, dt);
    if (Math.random() < dt * 0.25) e.strafe *= -1;
    if (e.atkCd <= 0 && d < def.range) { e.state = 'attack'; e.st = 0; e.hit = false; if (e.anim) e.anim.playOnce(pick(e.M.attacks), def.windup); }
  } else {
    if (d > def.range * 0.8 + p.radius) moveEnemy(e, dx, dz, sp, dt);
    if (e.atkCd <= 0 && d <= def.range + p.radius) {
      e.state = 'attack'; e.st = 0; e.hit = false; if (e.anim) e.anim.playOnce(pick(e.M.attacks), def.windup);
      if (def.heavy) telegraph(e.pos.x, e.pos.z, def.range + 1.2, def.windup, { arc: 2.2, facing: Math.atan2(dx, dz), follow: e.pos });
    }
  }
}

// ------------------------------------------------------------------ Balgor
function bossMouth(e, out) {
  if (e.mouthBone) { e.mouthBone.getWorldPosition(out); return out; }
  return out.set(e.pos.x + Math.sin(e.facing) * 2.2, 6.3, e.pos.z + Math.cos(e.facing) * 2.2);
}
/** play the drake's Blender-authored clip for an attack so its key frame lands on the gameplay hit */
function bossAnim(e, name, impact) {
  if (!e.anim || !e.M.moves || !e.M.moves[name]) return;
  const spec = { ...e.M.moves[name] };
  if (name === 'breath' && e.act && e.act.fire) spec.after = (spec.fireLen / e.act.fire) / (spec.at / impact);
  e.anim.playOnce(spec, impact);
}
function startAct(e, name) {
  const enr = e.hp / e.maxHp < 0.5, a = (e.act = { name, t: 0, hit: false, tick: 0 }), p = G.player;
  if (name === 'slam') { a.wind = enr ? 1.05 : 1.3; a.dur = a.wind + 0.8; telegraph(e.pos.x, e.pos.z, 10.5, a.wind, { follow: e.pos }); }
  if (name === 'swipe') { a.wind = enr ? 0.55 : 0.7; a.dur = a.wind + 0.6; a.face = e.facing; telegraph(e.pos.x, e.pos.z, 8.5, a.wind, { arc: 2.3, facing: e.facing }); }
  if (name === 'bite') { a.wind = enr ? 0.42 : 0.55; a.dur = a.wind + 0.6; telegraph(e.pos.x + Math.sin(e.facing) * 3, e.pos.z + Math.cos(e.facing) * 3, 4.2, a.wind, { follow: { x: e.pos.x + Math.sin(e.facing) * 3, z: e.pos.z + Math.cos(e.facing) * 3 } }); }
  if (name === 'breath') { a.wind = 1.0; a.fire = enr ? 1.9 : 1.5; a.dur = a.wind + a.fire + 0.5; telegraph(e.pos.x, e.pos.z, 19, a.wind, { arc: 0.9, facing: e.facing, color: 0xff5a14 }); }
  if (name === 'summon') { sfx('summon', e.pos); a.wind = 1.0; a.dur = 1.9; toast('Ignarax privoláva dráčatá!'); shake(0.5); ringFx(e.pos.x, e.pos.z, { color: 0xff3a10, r0: 2, r1: 16, dur: 0.9, int: 2 }); }
  if (name === 'meteors') {
    a.wind = 0.6; a.dur = 1.6;
    for (let i = 0; i < 7; i++) {
      const x = p.pos.x + (i ? randS(9) : 0), z = p.pos.z + (i ? randS(9) : 0), delay = i * 0.14;
      after(delay, () => { if (!e.dead) telegraph(x, z, 3.4, 1.1, { color: 0xff5a14 }); });
      after(delay + 1.1, () => { if (!e.dead) eruption(x, z, 3.4, 45); });
    }
  }
  bossAnim(e, name, a.wind);
}
function eruption(x, z, r, dmg) {
  sfx('explosion', { x, z }, 0.7);
  beamFx(x, z, 0xff7a20, r * 1.3, 13, 0.5, 3); flash(x, 1.5, z, 0xffa040, r * 3.2, 0.3, 3); flashLight(x, 2, z, 0xff6a20, 90, 16, 0.4);
  burst(x, 0.3, z, { n: 40, color: 0xff7a20, color2: 0xffe080, int: 3, up: 2.4, s0: 3, s1: 15, size: 0.6, l0: 0.3, l1: 0.9, r: r * 0.6, grav: 14 });
  burst(x, 0.3, z, { n: 10, smoke: true, color: 0x2a1c16, int: 1, up: 1, s0: 1, s1: 4, size: 1.5, size1: 4, l0: 0.6, l1: 1.3, r });
  ringFx(x, z, { color: 0xff6a20, r0: 0.5, r1: r * 1.3, dur: 0.4 }); scorch(x, z, r, 4); shake(0.35);
  if (dist2D(G.player.pos, { x, z }) < r + G.player.radius * 0.5) damagePlayer(dmg, { x, z }, 5);
}
const _bm = new V3();
function updateBoss(e, dt) {
  const p = G.player, d = dist2D(e.pos, p.pos), frac = e.hp / e.maxHp, enr = frac < 0.5;
  if (!e.aggro) { if (d < e.def.aggro && !p.dead) { e.aggro = true; showBossBar(true, e.def.name); banner('Ignarax', 'Ohnivý drak sa prebúdza'); shake(0.7); e.act = { name: 'roar', t: 0, dur: 1.6, wind: 0.5 }; bossAnim(e, 'roar', 0.5); sfx('bossRoar', e.pos, 1.4); } return; }
  if (p.dead) { e.act = null; return; }
  const a = e.act;
  if (a) {
    a.t += dt * (e.slowF < 1 ? 0.85 : 1);
    if (a.name === 'slam' && !a.hit && a.t >= a.wind) {
      a.hit = true; shake(1.0); hitStop(0.06); sfx('bossSlam', e.pos, 1.3);
      ringFx(e.pos.x, e.pos.z, { color: 0xff5a14, r0: 2, r1: 11.5, dur: 0.45, int: 3 }); ringFx(e.pos.x, e.pos.z, { color: 0xffc080, r0: 1, r1: 9, dur: 0.6, int: 1.5, delay: 0.08 });
      rockRing(e.pos.x, e.pos.z, 5.5, 14, 1.9, 0); rockRing(e.pos.x, e.pos.z, 9.5, 20, 1.5, 0.1);
      burst(e.pos.x, 0.3, e.pos.z, { n: 60, color: 0xff6a20, color2: 0xffd080, int: 3, flat: true, s0: 8, s1: 24, size: 0.6, l0: 0.3, l1: 0.7, r: 3 });
      burst(e.pos.x, 0.3, e.pos.z, { n: 24, smoke: true, color: 0x3a2c24, int: 1, flat: true, s0: 3, s1: 10, size: 2, size1: 5, l0: 0.6, l1: 1.4, r: 6 });
      flashLight(e.pos.x, 3, e.pos.z, 0xff6a20, 160, 30, 0.5);
      if (d < 10.5 + p.radius * 0.5) damagePlayer(85, e.pos, 16);
      if (enr) for (let i = 0; i < 5; i++) { const an = rand(TAU), r = rand(12, 20), x = e.pos.x + Math.cos(an) * r, z = e.pos.z + Math.sin(an) * r; after(0.25 + i * 0.1, () => telegraph(x, z, 3.2, 0.9, { color: 0xff5a14 })); after(1.15 + i * 0.1, () => eruption(x, z, 3.2, 40)); }
    }
    if (a.name === 'bite' && !a.hit && a.t >= a.wind) {
      a.hit = true; shake(0.45); hitStop(0.04); sfx('bossSlam', e.pos, 0.7);
      const bx = e.pos.x + Math.sin(e.facing) * 3, bz = e.pos.z + Math.cos(e.facing) * 3;
      impactFx(bx, 1.4, bz, 0xff6a20, 2.2); ringFx(bx, bz, { color: 0xff5a14, r0: 0.5, r1: 4.4, dur: 0.3, int: 2.4 });
      burst(bx, 1.2, bz, { n: 24, color: 0xff8a30, color2: 0xffe0a0, int: 2.6, s0: 3, s1: 11, size: 0.4, l0: 0.2, l1: 0.6 });
      if (Math.hypot(p.pos.x - bx, p.pos.z - bz) < 4.2 + p.radius * 0.5) damagePlayer(65, e.pos, 10);
    }
    if (a.name === 'swipe' && !a.hit && a.t >= a.wind) {
      a.hit = true; shake(0.5); sfx('swing', e.pos, 1.3);
      slashFx(e.pos.x, e.pos.z, e.facing, { r: 8.8, arc: 2.5, color: 0xff5a14, color2: 0xffe0a0, dur: 0.24, y: 2.6, int: 3, tilt: 0.1 });
      if (d < 8.5 + p.radius && Math.abs(angDiff(e.facing, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z))) < 1.2) damagePlayer(55, e.pos, 12);
    }
    if (a.name === 'breath' && a.t >= a.wind && !a.snd) { a.snd = true; sfx('breath', e.pos, 1.2); }
    if (a.name === 'breath' && a.t >= a.wind && a.t < a.wind + a.fire) {
      if (enr) faceTo(e, p.pos, dt, 0.45);
      bossMouth(e, _bm); const col = rgb(0xff6a18, 3), col2 = rgb(0xffd060, 3.5);
      for (let i = 0; i < (G.quality ? 7 : 4); i++) {
        const an = e.facing + randS(0.36), sp = rand(15, 24);
        sparks.emit(_bm.x, _bm.y - 0.3, _bm.z, Math.sin(an) * sp, -rand(5, 7.5), Math.cos(an) * sp, Math.random() < 0.3 ? col2 : col, rand(0.5, 0.95), 0.9, 2.6, 0.9, -3);
      }
      if (Math.random() < 0.4) { const an = e.facing + randS(0.3), r = rand(4, 16); smoke.emit(e.pos.x + Math.sin(an) * r, 0.5, e.pos.z + Math.cos(an) * r, 0, 2, 0, rgb(0x1a120e, 1), rand(0.6, 1.2), 1.5, 4, 1, 0); }
      if (!a.L) a.L = getLight(0xff6a20, 120, 26);
      if (a.L) { a.L.position.set(e.pos.x + Math.sin(e.facing) * 8, 2.5, e.pos.z + Math.cos(e.facing) * 8); a.L.intensity = 120 * (0.8 + rand(0.3)); }
      shake(0.12); a.tick -= dt;
      if (a.tick <= 0) { a.tick = 0.2; if (d < 19 && d > 1.5 && Math.abs(angDiff(e.facing, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z))) < 0.47) damagePlayer(15, e.pos, 0); }
    } else if (a.L) { freeLight(a.L); a.L = null; }
    if (a.name === 'summon' && !a.hit && a.t >= a.wind) {
      a.hit = true;
      for (let i = 0; i < (enr ? 5 : 4); i++) { const an = rand(TAU), r = rand(7, 12), x = e.pos.x + Math.cos(an) * r, z = e.pos.z + Math.sin(an) * r;
        ringFx(x, z, { tex: TEX.rune, color: 0xff3a10, r0: 0.3, r1: 2, dur: 0.7, spin: 4, int: 2.5 }); after(0.7, () => { if (!e.dead) spawnEnemy('imp', x, z, { aggro: true, fx: true }); }); }
      after(0.8, updateObjective);
    }
    if (a.t >= a.dur) { if (a.L) freeLight(a.L); e.act = null; e.atkCd = enr ? rand(0.6, 1.0) : rand(1.0, 1.6); if (e.anim) e.anim.release(); }
    return;
  }
  e.atkCd -= dt; faceTo(e, p.pos, dt, 2.4);
  if (d > 6) moveEnemy(e, p.pos.x - e.pos.x, p.pos.z - e.pos.z, e.def.speed * (enr ? 1.3 : 1) * e.slowF, dt);
  if (e.atkCd <= 0) {
    if (e.summons.length && frac <= e.summons[0]) { e.summons.shift(); startAct(e, 'summon'); }
    else if (d < 9) { const r = Math.random(); startAct(e, r < 0.34 ? 'slam' : r < 0.58 ? 'swipe' : r < 0.82 ? 'bite' : 'breath'); }
    else if (d < 20) startAct(e, enr && Math.random() < 0.4 ? 'meteors' : 'breath');
    else if (enr) startAct(e, 'meteors');
  }
}
function bossDeath(e) {
  G.boss = null; G.slowMo = 0.3; after(0.6, () => { G.slowMo = 1; });
  for (const o of G.enemies) if (!o.dead && o !== e) killEnemy(o);
  shake(1.2);
  for (let i = 0; i < 9; i++) after(i * 0.16, () => {
    const x = e.pos.x + randS(3), y = rand(1, 7), z = e.pos.z + randS(3);
    flash(x, y, z, 0xffa040, 9, 0.4, 3); burst(x, y, z, { n: 40, color: 0xff7a20, color2: 0xffe080, int: 3, s0: 4, s1: 20, size: 0.7, l0: 0.4, l1: 1.2, grav: 8 });
    flashLight(x, y, z, 0xff8a30, 160, 30, 0.4); shake(0.5); if (i % 3 === 0) sfx('explosion', { x, z }, 1);
  });
  after(1.5, () => { rollEconomy(e); for (let i = 0; i < 3; i++) dropCoins(Math.round(rand(2, 5) * COIN_S * tierLoot()), e.pos.x + randS(4), e.pos.z + randS(4)); ringFx(e.pos.x, e.pos.z, { color: 0xffc070, r0: 1, r1: 30, dur: 1.1, int: 3 }); scorch(e.pos.x, e.pos.z, 8, 20); const lvl = 3 + G.tier - 1; for (let i = 0; i < 4; i++) dropItem(makeItem(lvl, i === 0 && Math.random() < 0.06 * tierLoot() ? 5 : i === 1 && Math.random() < 0.3 * tierLoot() ? 4 : undefined, i < 2 ? 3 : 2), e.pos.x + randS(3.5), e.pos.z + randS(3.5)); });
  showBossBar(false);
  // no victory screen – the adventure continues: unlock the next expedition tier and open the gate to the town
  const unlocked = G.tier + 1 > PROGRESS.maxTier; PROGRESS.maxTier = Math.max(PROGRESS.maxTier, G.tier + 1); saveProgress();
  after(2.2, () => { banner('Ignarax padol!', unlocked ? `Odomknutá úroveň výpravy ${PROGRESS.maxTier}` : 'Svätyňa je očistená'); });
  after(3.6, () => { openPortal(); updateObjective(); });
}

// ------------------------------------------------------------------ mini-bosses of the wilds: Šedohrivý (pounce + howl) and Gromm (quake + rock line)
function updateMini(e, dt) {
  const p = G.player; if (!e.aggro || p.dead) return false;
  if (dist2D(e.pos, p.pos) > 30 || dist2D(e.pos, e.home) > 34) {           // leash: back to the lair, full health
    e.aggro = false; e.sp = null; e.root.position.y = 0; e.hp = e.maxHp; e.wander = e.home.clone(); e.state = 'idle'; if (e.anim) e.anim.release();
    if (G.miniBoss === e) { G.miniBoss = null; showBossBar(false); }
    return true;
  }
  if (G.miniBoss !== e && (!G.miniBoss || G.miniBoss.dead)) { G.miniBoss = e; showBossBar(true, e.def.name); banner(e.def.name.split(',')[0], e.def.name.split(',')[1] || ''); sfx('bossRoar', e.pos, 0.8); }
  const d = dist2D(e.pos, p.pos), a = e.sp;
  if (e.howls.length && e.hp / e.maxHp <= e.howls[0] && !a) {
    e.howls.shift(); sfx('roar', e.pos, 1); shake(0.4); ringFx(e.pos.x, e.pos.z, { color: e.type === 'wolfLord' ? 0x9fb8ff : 0xffa040, r0: 1, r1: 12, dur: 0.6, int: 2 });
    toast(e.type === 'wolfLord' ? 'Šedohrivý zvoláva svorku!' : 'Gromm prebúdza kamenné krugy!', '#ffb070');
    for (let i = 0; i < 2; i++) { const an = rand(TAU), x = e.pos.x + Math.cos(an) * 5, z = e.pos.z + Math.sin(an) * 5; after(0.4 + i * 0.2, () => { if (!e.dead) spawnEnemy(e.type === 'wolfLord' ? 'wolf' : 'goblin', x, z, { aggro: true, opt: true, fx: true }); }); }
    after(1, updateObjective);
  }
  if (e.type === 'scarecrow') return updateScarecrow(e, dt, d, a);
  if (a) {
    a.t += dt;
    if (e.type === 'wolfLord') {
      if (a.t < a.wind) faceTo(e, { x: a.tx, z: a.tz }, dt, 8);
      else if (a.t < a.wind + a.air) { const k = (a.t - a.wind) / a.air; e.pos.x = lerp(a.x0, a.tx, k); e.pos.z = lerp(a.z0, a.tz, k); e.root.position.y = Math.sin(k * Math.PI) * 2.4; e.moving = true;
        smoke.emit(e.pos.x, 0.6, e.pos.z, 0, 0.5, 0, rgb(0x3a3a44, 1), 0.6, 1, 2.4, 1, 0); }
      else if (!a.hit) {
        a.hit = true; e.root.position.y = 0; shake(0.6); hitStop(0.05); sfx('slam', e.pos, 0.9);
        ringFx(a.tx, a.tz, { color: 0xbfd0ff, r0: 0.5, r1: 4.2, dur: 0.35, int: 2.6 }); scorch(a.tx, a.tz, 2.6, 4, 0x6a7088);
        burst(a.tx, 0.3, a.tz, { n: 40, color: 0xc8d0e0, color2: 0x6a7088, int: 2, flat: true, s0: 5, s1: 15, size: 0.4, l0: 0.25, l1: 0.6, drag: 3 });
        burst(a.tx, 0.3, a.tz, { n: 12, smoke: true, color: 0x4a4a50, int: 1, flat: true, s0: 2, s1: 7, size: 1.4, size1: 3.4, l0: 0.5, l1: 1.1, r: 1.5 });
        if (Math.hypot(p.pos.x - a.tx, p.pos.z - a.tz) < 3.6 + p.radius) damagePlayer(e.def.dmg * 1.6, { x: a.tx, z: a.tz }, 12);
      }
    } else {
      if (a.t < a.wind) faceTo(e, p.pos, dt, 2);
      if (!a.hit && a.t >= a.wind) {
        a.hit = true; shake(0.8); hitStop(0.06); sfx('bossSlam', e.pos, 1);
        ringFx(e.pos.x, e.pos.z, { color: 0xffb040, r0: 1.5, r1: 8, dur: 0.4, int: 2.6 }); rockRing(e.pos.x, e.pos.z, 4, 12, 1.6, 0, 0xff8a30); rockRing(e.pos.x, e.pos.z, 6.6, 16, 1.2, 0.08, 0xff8a30);
        burst(e.pos.x, 0.3, e.pos.z, { n: 50, color: 0xffb040, color2: 0x6a5c4c, int: 2.4, flat: true, s0: 6, s1: 18, size: 0.45, l0: 0.25, l1: 0.6, drag: 3 });
        if (d < 7.5 + p.radius * 0.5) damagePlayer(e.def.dmg * 1.4, e.pos, 10);
        const f = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);           // a line of eruptions towards the player
        for (let i = 0; i < 6; i++) { const r = 8.5 + i * 2.2, x = e.pos.x + Math.sin(f) * r, z = e.pos.z + Math.cos(f) * r;
          after(i * 0.12, () => telegraph(x, z, 2, 0.7, { color: 0xff8a30 })); after(0.7 + i * 0.12, () => { if (!e.dead) { rockRing(x, z, 0.6, 5, 1.5, 0, 0xff8a30); burst(x, 0.3, z, { n: 14, color: 0xffb040, int: 2.2, up: 2, s0: 2, s1: 8, size: 0.35, l0: 0.25, l1: 0.6, grav: 16 }); sfx('slam', { x, z }, 0.35); if (Math.hypot(p.pos.x - x, p.pos.z - z) < 2.1 + p.radius * 0.5) damagePlayer(e.def.dmg, { x, z }, 6); } }); }
      }
    }
    if (a.t >= a.dur) { e.sp = null; e.root.position.y = 0; e.specCd = rand(5, 7.5); e.state = 'chase'; e.atkCd = 0.6; if (e.anim) e.anim.release(); }
    return true;
  }
  e.specCd -= dt;
  if (e.specCd <= 0 && e.state !== 'attack' && d < 15) {
    if (e.type === 'wolfLord') {
      const tx = p.pos.x + (p.moving ? Math.sin(p.facing) * 1.5 : 0), tz = p.pos.z + (p.moving ? Math.cos(p.facing) * 1.5 : 0);
      e.sp = { t: 0, wind: 0.55, air: 0.5, dur: 1.6, x0: e.pos.x, z0: e.pos.z, tx, tz, hit: false };
      telegraph(tx, tz, 3.6, 1.05, { color: 0xff4020 }); sfx('roar', e.pos, 0.6);
      if (e.anim) e.anim.playOnce(e.M.moves.pounce, 0.8);
    } else {
      e.sp = { t: 0, wind: 1.1, dur: 2.0, hit: false }; telegraph(e.pos.x, e.pos.z, 7.5, 1.1, { follow: e.pos, color: 0xff8a30 });
      if (e.anim) e.anim.playOnce(e.M.moves.quake, 1.1);
    }
    return true;
  }
  return false;
}

// Fiddlesticks: crowstorm leap, terrifying shriek (fear cone), dark wind (homing crows)
function updateScarecrow(e, dt, d, a) {
  const p = G.player;
  if (a) {
    a.t += dt;
    if (a.name === 'storm') {
      if (a.t < a.wind) { faceTo(e, { x: a.tx, z: a.tz }, dt, 6); if (Math.random() < dt * 30) sparks.emit(e.pos.x + randS(1), rand(0.5, 3), e.pos.z + randS(1), randS(2), rand(1, 3), randS(2), rgb(0x2a1030, 1.2), rand(0.4, 0.8), 0.5, 0, 0.5, 0); }
      else if (a.t < a.wind + a.air) { const k = (a.t - a.wind) / a.air; e.pos.x = lerp(a.x0, a.tx, k); e.pos.z = lerp(a.z0, a.tz, k); e.root.position.y = Math.sin(k * Math.PI) * 4.5; e.moving = true; }
      else {
        if (!a.hit) { a.hit = true; e.root.position.y = 0; shake(0.6); sfx('bossSlam', e.pos, 0.8); sfx('roar', e.pos, 0.7); ringFx(e.pos.x, e.pos.z, { color: 0x9a4dff, r0: 0.5, r1: 5.5, dur: 0.4, int: 2.4 }); if (d < 5 + p.radius) damagePlayer(e.def.dmg * 1.3, e.pos, 8); a.tick = 0; }
        a.tick -= dt; faceTo(e, p.pos, dt, 4);                      // crowstorm: swirling crows that follow him while he chases the hero
        if (d > 2.5) moveEnemy(e, p.pos.x - e.pos.x, p.pos.z - e.pos.z, e.def.speed * 1.35 * e.slowF, dt);
        for (let i = 0; i < 5; i++) { const an = rand(TAU), r = rand(1, 4.6), y = rand(0.6, 3.4); sparks.emit(e.pos.x + Math.cos(an) * r, y, e.pos.z + Math.sin(an) * r, -Math.sin(an) * 9, rand(-1, 1), Math.cos(an) * 9, rgb(Math.random() < 0.25 ? 0x7fff40 : 0x1a0a20, Math.random() < 0.25 ? 2 : 1), rand(0.3, 0.6), 0.55, 0, 0.5, 0); }
        if (a.tick <= 0) { a.tick = 0.25; if (d < 4.6 + p.radius * 0.5) damagePlayer(e.def.dmg * 0.35, e.pos, 0); }
      }
    } else if (a.name === 'fear') {
      if (a.t < a.wind) faceTo(e, p.pos, dt, 3);
      else if (!a.hit) {
        a.hit = true; sfx('bossRoar', e.pos, 0.7); shake(0.3);
        slashFx(e.pos.x, e.pos.z, e.facing, { r: 8.5, arc: 1.3, color: 0x7fff40, color2: 0x2a1030, dur: 0.35, y: 1.6, int: 2 });
        const ang = Math.abs(angDiff(e.facing, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z)));
        if (d < 8.5 + p.radius && ang < 0.7) { p.fearT = 1.6; p.fearFrom = { x: e.pos.x, z: e.pos.z }; damagePlayer(e.def.dmg * 0.6, e.pos, 0); toast('Si vystrašený!', '#9fff6a'); }
      }
    } else if (a.name === 'wind') {
      if (a.t < a.wind) faceTo(e, p.pos, dt, 5);
      else if (!a.hit) {
        a.hit = true; sfx('enemyCast', e.pos, 1);
        for (const off of [-0.45, 0, 0.45]) { const an = e.facing + off; spawnProjectile({ kind: 'darkOrb', x: e.pos.x + Math.sin(an) * 1.6, y: 2.2, z: e.pos.z + Math.cos(an) * 1.6, dx: Math.sin(an), dz: Math.cos(an), speed: 13, dmg: e.def.dmg * 0.7, team: 'enemy', range: 26, homing: 1.4 }); }
      }
    }
    if (a.t >= a.dur) { e.sp = null; e.root.position.y = 0; e.specCd = rand(4, 6); e.state = 'chase'; e.atkCd = 0.6; if (e.anim) e.anim.release(); }
    return true;
  }
  e.specCd -= dt;
  if (e.specCd <= 0 && e.state !== 'attack' && d < 16) {
    const enr = e.hp / e.maxHp < 0.5, kind = ['storm', 'fear', 'wind'][e.spN++ % 3];
    if (kind === 'storm') {
      e.sp = { name: 'storm', t: 0, wind: 1.0, air: 0.55, dur: 1.55 + (enr ? 4 : 3), x0: e.pos.x, z0: e.pos.z, tx: p.pos.x, tz: p.pos.z, hit: false };
      telegraph(p.pos.x, p.pos.z, 5, 1.55, { color: 0x9a4dff }); toast('Fiddlesticks privoláva búrku vrán!', '#c08aff');
      if (e.anim) e.anim.playOnce(e.M.moves.storm, 1.55);
    } else if (kind === 'fear') {
      e.sp = { name: 'fear', t: 0, wind: 0.8, dur: 1.4, hit: false }; telegraph(e.pos.x, e.pos.z, 8.5, 0.8, { arc: 1.4, facing: e.facing, color: 0x7fff40, follow: e.pos });
      if (e.anim) e.anim.playOnce(e.M.moves.fear, 0.8);
    } else {
      e.sp = { name: 'wind', t: 0, wind: 0.6, dur: 1.1, hit: false };
      if (e.anim) e.anim.playOnce(e.M.moves.wind, 0.6);
    }
    return true;
  }
  return false;
}

/** ring of rock spikes that erupt and sink back (used by Gwen's slam and the boss) */
function rockRing(x, z, r, n, h, delay, hot = 0xff5a14) {
  for (let i = 0; i < n; i++) {
    const an = i / n * TAU + randS(0.12), rr = r + randS(0.5), m = getShard('rock');
    m.position.set(x + Math.cos(an) * rr, -0.1, z + Math.sin(an) * rr);
    m.rotation.set(randS(0.35), rand(TAU), randS(0.35)); m.material.emissive.setHex(hot);
    const w = rand(0.7, 1.2), hh = h * rand(0.7, 1.25); let t = -delay - rand(0.05); m.visible = false;
    addFx((dt) => {
      t += dt; if (t < 0) return true; m.visible = true;
      const up = Math.min(1, t / 0.1), down = t > 0.55 ? Math.min(1, (t - 0.55) / 0.5) : 0;
      m.scale.set(w, hh * easeOut(up) * (1 - down * down), w); m.material.emissiveIntensity = Math.max(0, 1.4 - t * 3);
      return t < 1.05;
    }, () => { m.visible = true; freeShard(m); });
  }
}

function updateEnemies(dt) {
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i]; e.animT += dt;
    if (e.dead) {
      e.deadT += dt; const k = easeOut(Math.min(1, e.deadT / 0.4));
      if (e.anim) e.anim.update(dt * (e.def.boss ? 0.8 : 1));
      if (e.hasDeathClip) { if (e.def.boss && e.deadT > 2.4) e.root.position.y = -(e.deadT - 2.4) * 1.6; else if (!e.def.boss && e.deadT > 1.4) e.root.position.y -= dt * 0.8; }
      else if (e.kind === 'wolf') e.root.rotation.z = k * 1.5; else if (e.kind === 'boss') { e.root.rotation.x = -k * 0.25; e.root.position.y = -Math.max(0, e.deadT - 0.3) * 2.2; } else e.root.rotation.x = -k * 1.5;
      e.flash = Math.max(0, e.flash - dt * 4);
      if (!e.hasDeathClip && e.deadT > 1.1 && e.kind !== 'boss') { e.root.position.y -= dt * 0.9; }
      for (const m of e.mats) { const b = m.userData.base; m.emissive.setHex(b.e).lerp(_c.setRGB(1, 1, 1), e.flash * 0.7); m.emissiveIntensity = lerp(b.ei, 1, e.flash) * Math.max(0, 1 - e.deadT * 0.8); }
      if (e.deadT > (e.def.boss ? (e.hasDeathClip ? 5 : 4) : e.hasDeathClip ? 2.6 : 2.1)) { actorRoot.remove(e.root); for (const m of e.mats) m.dispose(); G.enemies.splice(i, 1); }
      continue;
    }
    if (e.frozen > 0) { e.frozen -= dt; if (e.frozen <= 0) unfreeze(e); }
    if (e.stun > 0) e.stun -= dt;
    if (e.slow > 0) { e.slow -= dt; if (e.slow <= 0) e.slowF = 1; }
    if (e.kb.lengthSq() > 0.01) { e.pos.addScaledVector(e.kb, dt); e.kb.multiplyScalar(Math.exp(-dt * 6)); }
    e.moving = false;
    if (e.frozen <= 0 && e.stun <= 0) { if (e.def.boss) updateBoss(e, dt); else if (!(e.def.mini && updateMini(e, dt))) updateAI(e, dt); }
    else if (e.sp) { e.sp = null; e.root.position.y = 0; }
    // separation
    for (let j = 0; j < i; j++) {
      const o = G.enemies[j]; if (o.dead) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, min = e.radius + o.radius, d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2), push = (min - d) * 0.5, wE = e.def.boss ? 0 : o.def.boss ? 2 : 1, wO = o.def.boss ? 0 : e.def.boss ? 2 : 1;
        e.pos.x += dx / d * push * wE; e.pos.z += dz / d * push * wE; o.pos.x -= dx / d * push * wO; o.pos.z -= dz / d * push * wO; }
    }
    collide(e.pos, e.radius);
    if (e.ice) e.ice.position.set(e.pos.x, 0, e.pos.z);
    e.root.rotation.y = e.facing;
    // procedural limbs
    e.walk = lerp(e.walk, e.moving ? 1 : 0, 1 - Math.exp(-dt * 10));
    if (e.anim) {
      const a = e.anim, run = e.walk > 0.35;
      a.setBase(run ? 'run' : 'idle', run ? clamp(e.def.speed * e.slowF / e.M.runSpeed, 0.6, 1.6) : 1);
      if (e.stun > 0) { if (a.one) a.release(); e.root.rotation.z = Math.sin(e.animT * 14) * 0.06; } else e.root.rotation.z = 0;
      a.update(e.frozen > 0 ? 0 : dt * e.slowF);
    } else if (e.frozen <= 0) {
      const o = { walk: e.walk }, def = e.def, T = e.animT;
      if (e.kind === 'boss') {
        const a = e.act;
        if (a) { if (a.name === 'slam') o.slam = a.t < a.wind ? a.t / a.wind * 0.65 : 0.65 + Math.min(1, (a.t - a.wind) / 0.8) * 0.35; else if (a.name === 'swipe') o.swipe = a.t < a.wind ? a.t / a.wind * 0.55 : 0.55 + Math.min(1, (a.t - a.wind) / 0.6) * 0.45; else if (a.name === 'breath') o.breath = Math.max(0.05, (a.t - a.wind * 0.6) / (a.dur - a.wind * 0.6)); else o.roar = a.t / a.dur; }
        poseBalgor(e.P, T, o);
      } else {
        if (e.state === 'attack') { const a = e.st < def.windup ? e.st / def.windup * 0.62 : 0.62 + Math.min(1, (e.st - def.windup) / def.recover) * 0.38; if (def.proj === 'darkOrb') o.cast = a * 0.8; else if (def.ranged) o.aim = e.st < def.windup ? e.st / def.windup : 1 - (e.st - def.windup) / def.recover; else o.atk = a; }
        if (e.stun > 0) { o.walk = 0; e.root.rotation.z = Math.sin(T * 14) * 0.08; } else if (e.kind !== 'wolf') e.root.rotation.z = 0;
        if (e.kind === 'wolf') poseWolf(e.P, T, o); else poseBiped(e.P, T, o);
      }
    }
    // tint: hit flash (white) + frozen (ice blue)
    e.flash = Math.max(0, e.flash - dt * 7);
    const fr = e.frozen > 0 ? 1 : e.slowF < 1 ? 0.35 : 0;
    for (const m of e.mats) {
      const b = m.userData.base;
      m.color.setHex(b.c); if (fr) m.color.lerp(_c.setHex(0x7fc8ff), fr * 0.65);
      m.emissive.setHex(b.e); if (fr) m.emissive.lerp(_c.setHex(0x1a5a9a), fr * 0.6); if (e.flash > 0) m.emissive.lerp(_c.setRGB(1, 0.92, 0.85), e.flash * 0.75);
      m.emissiveIntensity = Math.max(b.ei, e.flash * 0.9, fr * 0.8);
    }
  }
}
// =====================================================================================
//  Player, projectiles and the 15 hero abilities
// =====================================================================================
// ------------------------------------------------------------------ potions, experience, levels
const POTIONS = [
  { key: 'Q', name: 'Elixír života', icon: 'potHp', color: '#ff4a3a', cd: 10, desc: 'Počas 1,5 s obnoví 40 % života.' },
  { key: 'E', name: 'Elixír sily', icon: 'potMp', color: '#4a8aff', cd: 10, desc: 'Okamžite obnoví polovicu many / energie.' },
];
const XP_OF = { wolf: 12, alpha: 35, goblin: 14, archer: 15, skeleton: 45, cultist: 40, imp: 9, wolfLord: 300, krugKing: 340, scarecrow: 380, boss: 1500 };
const MAX_LEVEL = 40;
const xpNeed = (lvl) => Math.round(40 * Math.pow(lvl, 1.6) + 20 * lvl);
const PROGRESS_KEY = 'kroniky_popola_postup_v1';
const PROGRESS = { maxTier: 1, heroes: {} };
try { Object.assign(PROGRESS, JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}')); } catch (e) { /* fresh start */ }
const HERO_PROGRESS = PROGRESS.heroes;
function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(PROGRESS)); } catch (e) { /* storage unavailable */ } }
G.tier = 1; G.dmgMul = 1;
const tierHp = () => 1 + 0.6 * (G.tier - 1), tierLoot = () => 1 + 0.5 * (G.tier - 1);
function usePotion(i) {
  const p = G.player; if (!p || p.dead || G.state !== 'playing' || p.potCd[i] > 0 || p.potions[i] <= 0) { sfx('deny'); if (potEls[i]) { potEls[i].s.classList.remove('deny'); void potEls[i].s.offsetWidth; potEls[i].s.classList.add('deny'); } return; }
  p.potions[i]--; p.potCd[i] = POTIONS[i].cd; sfx('potion');
  if (i === 0) { p.hot = 1.5; p.hotRate = p.st.maxHp * 0.4 / 1.5; }
  else { const m = Math.min(p.st.maxMana * 0.5, p.st.maxMana - p.mana); p.mana += m; dmgNumber(p.pos.x, 2.6, p.pos.z, '+' + Math.round(m), 'info'); }
  const col = i === 0 ? 0xff4a3a : 0x4a8aff;
  burst(p.pos.x, 0.3, p.pos.z, { n: 30, color: col, color2: 0xffffff, int: 2.4, up: 2.4, s0: 1.5, s1: 6, size: 0.3, l0: 0.4, l1: 0.9, r: 0.9 });
  ringFx(p.pos.x, p.pos.z, { color: col, r0: 0.4, r1: 2.6, dur: 0.4, int: 2 }); flash(p.pos.x, 1.2, p.pos.z, col, 3, 0.3);
}
function gainXP(n, x, z) {
  const p = G.player; if (!p || p.dead) return;
  n = Math.round(n * tierLoot()); p.xp += n; dmgNumber(x, 1.2, z, `+${n} XP`, 'info');
  while (p.xp >= xpNeed(p.level) && p.level < MAX_LEVEL) {
    p.xp -= xpNeed(p.level); p.level++; recomputeStats(); p.hp = p.st.maxHp; p.mana = p.st.maxMana;
    toast(`Úroveň ${p.level}! Život +8 %, poškodenie +6 %`, '#ffe9a8'); sfx('levelUp');
    const ui = UNLOCK_LV.indexOf(p.level);
    if (ui >= 0 && p.def.abilities[ui]) { const ab = p.def.abilities[ui]; after(0.6, () => { banner('Nová schopnosť!', `${ab.name} · ${keyLabel(ab.key)}`); sfx('unlock'); unlockSlotFx(ui); }); }
    beamFx(p.pos.x, p.pos.z, 0xffd070, 3.2, 16, 1.0, 2.6); ringFx(p.pos.x, p.pos.z, { tex: TEX.rune, color: 0xffd070, r0: 0.5, r1: 4, dur: 0.8, spin: 3, int: 2.6 });
    burst(p.pos.x, 0.3, p.pos.z, { n: 80, color: 0xffd070, color2: 0xffffff, int: 3, up: 3, s0: 2, s1: 10, size: 0.35, l0: 0.5, l1: 1.3, r: 1.2 }); flashLight(p.pos.x, 2, p.pos.z, 0xffd070, 120, 18, 0.8);
  }
  HERO_PROGRESS[p.def.id] = { level: p.level, xp: p.xp }; saveProgress();
}

const atkSpeedOf = (p) => p.st.atkSpeed * (p.roarT > 0 ? 1.45 : 1);
const moveSpeedOf = (p) => p.def.speed * p.st.moveSpeed * (p.roarT > 0 ? 1.15 : 1) * (p.cast && p.cast.ab.fn === 'bladeVortex' ? 0.9 : 1);

function createPlayer(rig) {
  const def = rig.def;
  const p = {
    rig, def, root: rig.root, pos: rig.root.position, radius: 0.6, facing: Math.PI, wantFacing: Math.PI,
    hp: 1, mana: 1, cds: Array(8).fill(0), cdMax: Array(8).fill(1), shield: 0, shieldMax: 1, shieldT: 0, shieldHit: 0, willT: 0, lock: 0, cast: null, moveTarget: null, atkTarget: null,
    invuln: 0, queued: null, dead: false, potions: [5, 5], potCd: [0, 0], hot: 0, hotRate: 0, level: (HERO_PROGRESS[def.id] || {}).level || 1, xp: (HERO_PROGRESS[def.id] || {}).xp || 0, flash: 0, recoil: 0, roarT: 0, focusT: 0, spin: 0, dash: null, lunge: null, kb: new V3(), swing: 0, st: {}, moving: false, deadT: 0,
  };
  rig.anim.stopAll(); rig.pivot.rotation.set(0, 0, 0); rig.pivot.position.set(0, 1, 0); rig.root.rotation.set(0, Math.PI, 0); flashRig(rig, 1, 1, 1, 0);
  actorRoot.add(rig.root);
  G.player = p; recomputeStats(); p.hp = p.st.maxHp; p.mana = p.st.maxMana;
  rig.anim.setBase('idle');
  return p;
}
function recomputeStats() {
  const p = G.player; if (!p) return; const d = p.def, b = equipBonus();
  p.st = {
    maxHp: Math.round((d.hp + b.hp) * (1 + 0.08 * (p.level - 1))), maxMana: Math.round(d.mana + b.mana), dmgMul: (1 + b.dmg / 100) * (1 + 0.06 * (p.level - 1)), crit: 0.08 + b.crit / 100, critDmg: 1.75 + b.critDmg / 100,
    atkSpeed: 1 + b.atkSpeed / 100, moveSpeed: 1 + b.moveSpeed / 100, hpRegen: d.hpRegen + b.hpRegen, manaRegen: d.manaRegen + b.manaRegen, cdr: Math.min(0.5, b.cdr / 100), armor: Math.min(0.6, b.armor / 100),
  };
  p.hp = Math.min(p.hp, p.st.maxHp); p.mana = Math.min(p.mana, p.st.maxMana);
}
function healPlayer(v) { const p = G.player; if (p.dead) return; const h = Math.min(v, p.st.maxHp - p.hp); p.hp += h; if (h > 1) dmgNumber(p.pos.x, 2.6, p.pos.z, '+' + Math.round(h), 'heal'); }

function damagePlayer(amount, from, kb = 0) {
  const p = G.player; if (!p || p.dead || p.invuln > 0 || G.state !== 'playing') return;
  let dmg = Math.max(1, Math.round(amount * (G.dmgMul || 1) * (1 - p.st.armor) * rand(0.9, 1.1) * (p.willT > 0 ? 0.5 : 1)));
  if (p.willT > 0) kb = 0;
  if (p.shield > 0) {
    const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; p.shieldHit = 1; dmgNumber(p.pos.x + randS(0.3), 2.6, p.pos.z, '(' + ab + ')', 'info');
    if (dmg <= 0) { sfx('arcaneHit', p.pos, 0.4); return; }
  }
  sfx('hurt', p.pos, 0.8);
  p.hp -= dmg; p.flash = 1; p.recoil = 1; hurtFlash(Math.min(1, 0.35 + dmg / 80));
  dmgNumber(p.pos.x + randS(0.3), 2.5, p.pos.z, '-' + dmg, 'hurt'); shake(Math.min(0.5, 0.14 + dmg / 160));
  burst(p.pos.x, 1.3, p.pos.z, { n: 8, color: 0xff3020, color2: 0xff9060, int: 1.8, s0: 2, s1: 6, size: 0.28, l0: 0.2, l1: 0.45 });
  if (kb && from) { _ld.set(p.pos.x - from.x, 0, p.pos.z - from.z); if (_ld.lengthSq() > 1e-4) p.kb.addScaledVector(_ld.normalize(), kb); }
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadT = 0; if (p.cast) endCast(p, true); p.dash = null;
    p.procDeath = !p.rig.anim.playDeath(); G.state = 'dead'; G.slowMo = 0.35; after(0.5, () => { G.slowMo = 1; });
    setTimeout(() => endGame(false), 2200);
  }
}

/** enemy under the cursor (screen-space, so tall bodies are easy to click) */
const _scr = { x: 0, y: 0 };
function pickEnemyAtCursor() {
  let best = null, bd = 1e9;
  for (const e of G.enemies) {
    if (e.dead) continue; if (!toScreen(e.pos.x, e.def.h * 0.45, e.pos.z, _scr)) continue;
    const d = Math.hypot(_scr.x - mouse.x, _scr.y - mouse.y), lim = (26 + e.radius * 34) * (31 / CAM.dist) * (innerHeight / 900);
    if (d < lim && d < bd) { bd = d; best = e; }
  }
  return best;
}

// ------------------------------------------------------------------ casting
function tryCast(i, target) {
  const p = G.player, ab = p.def.abilities[i];
  if (!ab || p.dead || G.state !== 'playing') return false;
  if (!abilityUnlocked(p, i)) { if (G.time - (p.lockMsgT || -9) > 1.2) { p.lockMsgT = G.time; denySlot(i); sfx('deny'); toast(`${ab.name} sa odomkne na úrovni ${UNLOCK_LV[i]}`, '#ffb070'); } return false; }
  if (p.lock > 0 || p.dash || p.cds[i] > 0) { if (i > 0 && p.cds[i] < 0.35 && (p.lock < 0.45 || p.dash)) p.queued = { i, until: G.time + 0.45 }; return false; }
  if (p.mana < ab.cost) { denySlot(i); return false; }
  const aim = target ? target.pos : mouse.ground;
  let dx = aim.x - p.pos.x, dz = aim.z - p.pos.z, l = Math.hypot(dx, dz);
  if (l < 0.05) { dx = Math.sin(p.facing); dz = Math.cos(p.facing); l = 1; }
  const as = i === 0 ? atkSpeedOf(p) : p.roarT > 0 ? 1.15 : 1;
  const cast = ab.mobile ? ab.cast : ab.cast / as, impact = ab.impact / as;
  p.mana -= ab.cost; p.cds[i] = i === 0 ? cast : ab.cd * (1 - p.st.cdr); p.cdMax[i] = Math.max(0.01, p.cds[i]);
  p.lock = cast; if (!ab.mobile) p.moveTarget = null;
  const ctx = (p.cast = { ab, i, t: 0, impact, cast, fired: false, aim: new V3(aim.x, 0, aim.z), dir: new V3(dx / l, 0, dz / l), track: !!ab.track, target: target || null, fn: ABIL[ab.fn] });
  p.wantFacing = Math.atan2(dx, dz);
  if (ab.anim && !p.rig.anim.playOnce(ab.anim, impact)) p.lunge = { t: 0, impact };
  const snd = ABIL_SFX[ab.fn]; if (snd && snd[0]) sfx(snd[0], p.pos);
  if (ctx.fn.start) ctx.fn.start(p, ctx);
  return true;
}
function endCast(p, aborted) {
  const ctx = p.cast; if (!ctx) return; p.cast = null; p.lock = 0;
  if (ctx.fn.end) ctx.fn.end(p, ctx, aborted);
  if (!p.dead) p.rig.anim.release();
}

function updatePlayer(dt) {
  const p = G.player, rig = p.rig, st = p.st;
  if (p.dead) {
    p.deadT += dt; if (p.procDeath) { rig.pivot.rotation.x = -easeOut(Math.min(1, p.deadT / 0.5)) * 1.45; rig.pivot.position.y = 1 - easeOut(Math.min(1, p.deadT / 0.5)) * 0.75; }
    p.flash = Math.max(0, p.flash - dt * 3); flashRig(rig, 1, 0.3, 0.3, p.flash); rig.anim.update(dt); return;
  }
  for (let i = 0; i < p.cds.length; i++) if (p.cds[i] > 0) { p.cds[i] -= dt; if (p.cds[i] <= 0 && i > 0) readySlot(i); }
  if (p.shieldT > 0) p.shieldT -= dt; if (p.willT > 0) p.willT -= dt;
  p.invuln = Math.max(0, p.invuln - dt);
  p.potCd[0] = Math.max(0, p.potCd[0] - dt); p.potCd[1] = Math.max(0, p.potCd[1] - dt);
  if (p.hot > 0) { const h = Math.min(p.hot, dt); p.hot -= dt; p.hp = Math.min(st.maxHp, p.hp + p.hotRate * h); if (Math.random() < dt * 25) sparks.emit(p.pos.x + randS(0.6), rand(0.2, 1.8), p.pos.z + randS(0.6), 0, rand(1, 2.5), 0, rgb(0xff5a48, 2.2), rand(0.4, 0.8), 0.25, 0, 0.5, 0); }
  p.hp = Math.min(st.maxHp, p.hp + st.hpRegen * dt); p.mana = Math.min(st.maxMana, p.mana + st.manaRegen * dt);
  if (p.roarT > 0) { p.roarT -= dt; if (Math.random() < dt * 40) { const a = rand(TAU), r = rand(0.4, 1.1); sparks.emit(p.pos.x + Math.cos(a) * r, 0.1, p.pos.z + Math.sin(a) * r, 0, rand(2.5, 5), 0, rgb(0xffc64a, 2.5), rand(0.4, 0.8), 0.3, 0, 0.5, 0); } }
  if (p.focusT > 0) p.focusT -= dt;

  // ---- input → abilities
  const hover = mouse.overUI ? null : pickEnemyAtCursor();
  canvas.style.cursor = hover ? 'crosshair' : 'default';
  if (p.fearT > 0) {
    p.fearT -= dt; p.atkTarget = null; const f = p.fearFrom, dx = p.pos.x - f.x, dz = p.pos.z - f.z, l = Math.hypot(dx, dz) || 1;
    p.moveTarget = (p.moveTarget || new V3()).set(p.pos.x + dx / l * 3, 0, p.pos.z + dz / l * 3);
    if (Math.random() < dt * 20) sparks.emit(p.pos.x + randS(0.4), rand(1.6, 2.4), p.pos.z + randS(0.4), 0, rand(0.5, 1.5), 0, rgb(0x7fff40, 2), rand(0.3, 0.6), 0.25, 0, 0.3, 0);
    if (p.fearT <= 0) p.moveTarget = null;
  } else if (G.state === 'playing') {
    if (keys.Space) tryCast(4);
    if (keys.Digit1 || keys.Numpad1) tryCast(2);
    if (keys.Digit2 || keys.Numpad2) tryCast(3);
    if (keys.Digit3 || keys.Numpad3) tryCast(5);
    if (keys.Digit4 || keys.Numpad4) tryCast(6);
    if (keys.Digit5 || keys.Numpad5) tryCast(7);
    if (mouse.r) tryCast(1);
    if (mouse.l) {
      const wasd = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;
      if (keys.ShiftLeft || keys.ShiftRight || wasd) { p.atkTarget = null; p.moveTarget = null; tryCast(0); }
      else if (hover) { p.atkTarget = hover; p.moveTarget = null; }
      else if (!p.atkTarget || mouse.lPressed) { p.atkTarget = null; if (!p.moveTarget) p.moveTarget = new V3(); p.moveTarget.set(mouse.ground.x, 0, mouse.ground.z); }
    }
  }
  if (p.atkTarget && p.atkTarget.dead) p.atkTarget = null;
  if (p.queued) { if (G.time > p.queued.until) p.queued = null; else if (!p.lock && !p.dash && p.cds[p.queued.i] <= 0) { const q = p.queued.i; p.queued = null; tryCast(q); } }

  // ---- running cast
  const c = p.cast;
  if (c) {
    c.t += dt; p.lock = Math.max(0, c.cast - c.t);
    if (!c.fired && c.track) {
      const a = c.target && !c.target.dead ? c.target.pos : mouse.ground; const dx = a.x - p.pos.x, dz = a.z - p.pos.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { c.dir.set(dx / l, 0, dz / l); c.aim.set(a.x, 0, a.z); p.wantFacing = Math.atan2(dx, dz); }
    }
    if (!c.fired && c.t >= c.impact) { c.fired = true; c.fn.fire(p, c); const snd = ABIL_SFX[c.ab.fn]; if (snd && snd[1]) sfx(snd[1], p.pos); }
    if (c.fn.update) c.fn.update(p, c, dt);
    if (c.t >= c.cast) endCast(p, false);
  }

  // ---- movement
  let mvx = 0, mvz = 0; const speed = moveSpeedOf(p), free = !p.cast || p.cast.ab.mobile;
  if (p.dash) {
    const d = p.dash; d.t += dt; const k = Math.min(1, d.t / d.dur), sp = d.speed * (1 - k * k * 0.5);
    p.pos.x += d.dx * sp * dt; p.pos.z += d.dz * sp * dt; p.wantFacing = p.facing = Math.atan2(d.dx, d.dz);
    if (d.step) d.step(p, d, dt, k);
    if (d.t >= d.dur) { if (d.done) d.done(p, d); p.dash = null; }
  } else if (free) {
    const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), iz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    if (ix || iz) { const l = Math.hypot(ix, iz); mvx = ix / l; mvz = iz / l; p.moveTarget = null; p.atkTarget = null; }
    else if (p.atkTarget) {
      const t = p.atkTarget, d = dist2D(p.pos, t.pos), range = p.def.id === 'gwen' ? 3.0 + t.radius : 21;
      if (d > range) { mvx = (t.pos.x - p.pos.x) / d; mvz = (t.pos.z - p.pos.z) / d; }
      else if (!p.cast) { if (tryCast(0, t) && !mouse.l) p.atkTarget = null; }
    } else if (p.moveTarget) {
      const d = dist2D(p.pos, p.moveTarget);
      if (d < 0.25) p.moveTarget = null; else { mvx = (p.moveTarget.x - p.pos.x) / d; mvz = (p.moveTarget.z - p.pos.z) / d; }
    }
    if (mvx || mvz) { p.pos.x += mvx * speed * dt; p.pos.z += mvz * speed * dt; if (!p.cast) p.wantFacing = Math.atan2(mvx, mvz); }
  }
  if (p.kb.lengthSq() > 0.01) { p.pos.addScaledVector(p.kb, dt); p.kb.multiplyScalar(Math.exp(-dt * 7)); }
  for (const e of G.enemies) { // don't walk through bodies
    if (e.dead || p.dash) continue; const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, min = (p.radius + e.radius) * 0.85, d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2), k = (min - d) * (e.def.boss ? 1 : 0.6); p.pos.x += dx / d * k; p.pos.z += dz / d * k; }
  }
  const bx = p.pos.x, bz = p.pos.z; collide(p.pos, p.radius);
  if (p.moveTarget && (Math.abs(p.pos.x - bx) > 1e-4 || Math.abs(p.pos.z - bz) > 1e-4) && dist2D(p.pos, p.moveTarget) < 1.2) p.moveTarget = null;
  p.moving = !!(mvx || mvz);

  // ---- facing + procedural layers (hit recoil, lunge fallback, vortex spin)
  p.facing += clamp(angDiff(p.facing, p.wantFacing), -dt * (p.cast ? 26 : 15), dt * (p.cast ? 26 : 15));
  rig.root.rotation.y = p.facing;
  p.recoil = Math.max(0, p.recoil - dt * 6); p.flash = Math.max(0, p.flash - dt * 6);
  let px = -0.22 * p.recoil, pz = -0.25 * p.recoil;
  if (p.lunge) { p.lunge.t += dt; const k = p.lunge.t / (p.lunge.impact * 2.4); if (k >= 1) p.lunge = null; else pz += Math.sin(Math.PI * k) * 0.55; }
  if (!(p.cast && p.cast.ab.fn === 'bladeVortex')) p.spin = Math.abs(p.spin) < 0.05 ? 0 : p.spin * Math.exp(-dt * 14);
  if (!(p.dash && p.dash.roll)) rig.pivot.rotation.x = px;
  rig.pivot.rotation.y = p.spin; rig.pivot.position.z = pz;
  flashRig(rig, 1, 0.25, 0.2, p.flash);
  if (!p.cast || p.cast.ab.mobile && p.cast.ab.fn !== 'bladeVortex') rig.anim.setBase(p.moving ? 'run' : 'idle', p.moving ? speed / p.def.speed : 1);
  else rig.anim.setBase(p.moving ? 'run' : 'idle');
  rig.anim.update(dt);
}

// ------------------------------------------------------------------ projectiles (pooled per visual kind)
const PROJ = {
  arcane: { y: 1.45, trail: [0.4, 0x7a5cff, 2.6], light: [0x8f6bff, 34, 11], pcol: 0x9a7bff, prate: 70, psize: 0.42 },
  frost: { y: 1.45, trail: [0.15, 0x9fe8ff, 2.4, 0.5], light: [0x7fd8ff, 16, 8], pcol: 0xbff0ff, prate: 40, psize: 0.2 },
  wisp: { y: 0, trail: [0.13, 0x7fffe0, 2.2], pcol: 0x9fffe8, prate: 30, psize: 0.18 },
  darkArrow: { y: 1.3, trail: [0.12, 0x9a4dff, 1.8, 0.4], pcol: 0x8a4dff, prate: 0, psize: 0.2 },
  darkOrb: { y: 1.4, trail: [0.3, 0xb020ff, 1.6], pcol: 0xc040ff, prate: 30, psize: 0.4 },
  fireBolt: { y: 1.2, trail: [0.26, 0xff6a18, 2.4], light: [0xff7a20, 26, 8], pcol: 0xffb040, prate: 45, psize: 0.34 },
  runeOrb: { y: 1.8, trail: [0.32, 0x3a9cff, 2.2], light: [0x3a8cff, 22, 8], pcol: 0x8fd0ff, prate: 40, psize: 0.38 },
};
const projPool = { arcane: [], frost: [], wisp: [], darkArrow: [], darkOrb: [], runeOrb: [], fireBolt: [] };
const mkGlow = (color, int, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: hdr(color, int), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.scale.setScalar(size); return s; };
const basicHdr = (color, int) => new THREE.MeshBasicMaterial({ color: hdr(color, int), fog: false });
function buildArrow(color, int) {
  const g = new THREE.Group(), m = basicHdr(color, int);
  g.add(new THREE.Mesh(geo('ashaft', () => new THREE.CylinderGeometry(0.035, 0.035, 1.3, 5).rotateX(Math.PI / 2)), m));
  const tip = new THREE.Mesh(geo('atip', () => new THREE.ConeGeometry(0.11, 0.42, 6).rotateX(Math.PI / 2)), m); tip.position.z = 0.82; g.add(tip);
  const gl = mkGlow(color, 1.6, 1.3); gl.position.z = 0.7; g.add(gl); return g;
}
function buildProj(kind) {
  const g = new THREE.Group();
  if (kind === 'arcane') {
    g.add(new THREE.Mesh(geo('pcore', () => new THREE.IcosahedronGeometry(0.27, 2)), basicHdr(0xd8ccff, 3.2)), mkGlow(0x6a4cff, 2.6, 2.6));
    const ring = new THREE.Mesh(geo('pring', () => new THREE.TorusGeometry(0.46, 0.035, 6, 24)), new THREE.MeshBasicMaterial({ color: hdr(0x7fb0ff, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(ring); g.userData.ring = ring;
  } else if (kind === 'frost') return buildArrow(0xbff0ff, 2.8);
  else if (kind === 'darkArrow') return buildArrow(0x9a4dff, 2.2);
  else if (kind === 'wisp') g.add(new THREE.Mesh(geo('wcore', () => new THREE.IcosahedronGeometry(0.1, 1)), basicHdr(0xdffff8, 3)), mkGlow(0x4fffd8, 2.2, 1.1));
  else if (kind === 'runeOrb') {
    g.add(new THREE.Mesh(geo('rcore', () => new THREE.OctahedronGeometry(0.3, 0)), basicHdr(0xcfeaff, 3)), mkGlow(0x2a7cff, 2.6, 2.6));
    const ring = new THREE.Mesh(geo('pring', () => new THREE.TorusGeometry(0.46, 0.035, 6, 24)), new THREE.MeshBasicMaterial({ color: hdr(0x5ab8ff, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(ring); g.userData.ring = ring;
  }
  else if (kind === 'fireBolt') g.add(new THREE.Mesh(geo('fbcore', () => new THREE.IcosahedronGeometry(0.24, 1)), basicHdr(0xffe0a0, 3)), mkGlow(0xff6a18, 2.6, 2.2));
  else if (kind === 'darkOrb') {
    g.add(new THREE.Mesh(geo('ocore', () => new THREE.IcosahedronGeometry(0.33, 2)), new THREE.MeshBasicMaterial({ color: 0x14021c })), mkGlow(0xc020ff, 2.2, 2.4));
    const ring = new THREE.Mesh(geo('pring', () => new THREE.TorusGeometry(0.46, 0.035, 6, 24)), new THREE.MeshBasicMaterial({ color: hdr(0xff40c0, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(ring); g.userData.ring = ring;
  }
  return g;
}
function spawnProjectile(o) {
  const def = PROJ[o.kind], m = projPool[o.kind].pop() || buildProj(o.kind);
  m.position.set(o.x, o.y ?? def.y, o.z); m.rotation.set(0, Math.atan2(o.dx, o.dz), 0); fxRoot.add(m);
  const pr = { kind: o.kind, def, m, pos: m.position, vel: new V3(o.dx * o.speed, o.vy || 0, o.dz * o.speed), speed: o.speed, life: (o.range ?? 28) / o.speed, radius: o.radius ?? 0.45,
    dmg: o.dmg, team: o.team, pierce: !!o.pierce, seen: o.pierce ? new Set() : null, homing: o.homing || 0, target: o.target || null, hit: o.hit || null, acc: 0, t: 0 };
  pr.trail = getTrail(m.position, def.trail[0], def.trail[1], def.trail[2], def.trail[3]);
  pr.light = def.light && !o.noLight ? getLight(def.light[0], def.light[1], def.light[2]) : null;
  G.projectiles.push(pr); return pr;
}
function killProjectile(pr, i, impact) {
  if (impact) {
    const { x, y, z } = pr.pos;
    sfx(pr.kind === 'arcane' ? 'arcaneHit' : pr.kind === 'frost' ? 'iceHit' : pr.kind === 'wisp' ? 'wisp' : 'darkHit', pr.pos, pr.kind === 'wisp' ? 0.5 : 0.9);
    if (pr.kind === 'arcane') { impactFx(x, y, z, 0x8f6bff, 1.2); ringFx(x, z, { color: 0x8f6bff, r0: 0.3, r1: 2.4, dur: 0.3, y: 0.08 }); burst(x, y, z, { n: 14, color: 0xcbb8ff, color2: 0x6a4cff, int: 2.5, s0: 1, s1: 5, size: 0.5, l0: 0.3, l1: 0.6 }); }
    else if (pr.kind === 'frost') { flash(x, y, z, 0x9fe8ff, 2.2, 0.18); burst(x, y, z, { n: 12, color: 0xdff8ff, color2: 0x6fc8ff, int: 2.4, s0: 3, s1: 10, size: 0.3, grav: 22, l0: 0.25, l1: 0.6, drag: 1.5 }); burst(x, y, z, { n: 4, smoke: true, color: 0xcfeeff, int: 1, s0: 0.5, s1: 2, size: 0.8, size1: 1.8, l0: 0.3, l1: 0.6 }); }
    else if (pr.kind === 'wisp') { flash(x, y, z, 0x7fffe0, 1.5, 0.15); burst(x, y, z, { n: 6, color: 0x9fffe8, int: 2.2, s0: 2, s1: 6, size: 0.22, l0: 0.15, l1: 0.35 }); }
    else if (pr.kind === 'fireBolt') { flash(x, y, z, 0xff8a30, 2.6, 0.2); burst(x, y, z, { n: 16, color: 0xffb040, color2: 0xff4a10, int: 2.6, s0: 2, s1: 8, size: 0.32, l0: 0.2, l1: 0.55, grav: 6 }); burst(x, y, z, { n: 4, smoke: true, color: 0x2a1c14, int: 1, s0: 0.5, s1: 2, size: 0.8, size1: 1.8, l0: 0.4, l1: 0.8 }); }
    else if (pr.kind === 'runeOrb') { flash(x, y, z, 0x5ab8ff, 2.6, 0.2); ringFx(x, z, { tex: TEX.rune, color: 0x3a8cff, r0: 0.4, r1: 2.2, dur: 0.35, spin: 3, int: 2 }); burst(x, y, z, { n: 14, color: 0xbfe6ff, color2: 0x2a6cff, int: 2.4, s0: 2, s1: 8, size: 0.32, l0: 0.2, l1: 0.55 }); }
    else { flash(x, y, z, 0xb040ff, 2.2, 0.2); burst(x, y, z, { n: 10, color: 0xc040ff, color2: 0x4a108a, int: 2, s0: 2, s1: 7, size: 0.35, l0: 0.2, l1: 0.5 }); }
  }
  freeTrail(pr.trail); freeLight(pr.light); fxRoot.remove(pr.m); projPool[pr.kind].push(pr.m);
  G.projectiles[i] = G.projectiles[G.projectiles.length - 1]; G.projectiles.pop();
}
function updateProjectiles(dt) {
  const p = G.player;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i], def = pr.def; pr.t += dt; pr.life -= dt;
    if (pr.homing) {
      const tg = pr.team === 'enemy' ? (p.dead ? null : p) : pr.target && !pr.target.dead ? pr.target : null;
      if (tg) { _ld.set(tg.pos.x - pr.pos.x, (tg.def.h ? tg.def.h * 0.5 : 1.3) - pr.pos.y, tg.pos.z - pr.pos.z).setLength(pr.speed); pr.vel.lerp(_ld, Math.min(1, pr.homing * dt)).setLength(pr.speed); }
    }
    pr.pos.addScaledVector(pr.vel, dt); pr.m.rotation.y = Math.atan2(pr.vel.x, pr.vel.z);
    if (pr.m.userData.ring) { pr.m.userData.ring.rotation.x += dt * 9; pr.m.userData.ring.rotation.y += dt * 6; }
    pr.trail.update(pr.pos); if (pr.light) pr.light.position.copy(pr.pos);
    if (def.prate) { pr.acc += dt * def.prate; while (pr.acc > 1) { pr.acc -= 1; sparks.emit(pr.pos.x + randS(0.12), pr.pos.y + randS(0.12), pr.pos.z + randS(0.12), randS(0.8) - pr.vel.x * 0.04, randS(0.8), randS(0.8) - pr.vel.z * 0.04, rgb(def.pcol, 2.2), rand(0.2, 0.5), def.psize, 0, 1.5, 0); } }
    let dead = pr.life <= 0, impact = false;
    if (!dead && pr.pos.y < 3 && isBlocked(pr.pos.x, pr.pos.z, 0.1)) { dead = impact = true; }
    if (!dead && pr.team === 'player') {
      for (const e of G.enemies) {
        if (e.dead || (pr.seen && pr.seen.has(e))) continue;
        const r = pr.radius + e.radius;
        if (Math.abs(e.pos.x - pr.pos.x) < r && Math.abs(e.pos.z - pr.pos.z) < r && pr.pos.y < e.def.h + 0.6 && Math.hypot(e.pos.x - pr.pos.x, e.pos.z - pr.pos.z) < r) {
          damageEnemy(e, pr.dmg, { ...pr.hit, from: { x: pr.pos.x - pr.vel.x, z: pr.pos.z - pr.vel.z } });
          if (pr.pierce) { pr.seen.add(e); flash(pr.pos.x, pr.pos.y, pr.pos.z, 0x9fe8ff, 1.8, 0.15); burst(pr.pos.x, pr.pos.y, pr.pos.z, { n: 6, color: 0xdff8ff, int: 2.2, s0: 2, s1: 7, size: 0.25, grav: 18, l0: 0.2, l1: 0.45 }); }
          else { dead = impact = true; break; }
        }
      }
    } else if (!dead && !p.dead && p.invuln <= 0 && Math.hypot(p.pos.x - pr.pos.x, p.pos.z - pr.pos.z) < pr.radius + p.radius) { damagePlayer(pr.dmg, { x: pr.pos.x - pr.vel.x, z: pr.pos.z - pr.vel.z }, 2); dead = impact = true; }
    if (dead) killProjectile(pr, i, impact);
  }
}
function clearProjectiles() { for (let i = G.projectiles.length - 1; i >= 0; i--) killProjectile(G.projectiles[i], i, false); }
const enemiesIn = (x, z, r) => G.enemies.filter((e) => !e.dead && Math.hypot(e.pos.x - x, e.pos.z - z) < r + e.radius);
const muzzle = (p, c, out, fwd = 1.0, y = 1.5) => out.set(p.pos.x + c.dir.x * fwd, y, p.pos.z + c.dir.z * fwd);
const _mz = new V3();

// ------------------------------------------------------------------ abilities
const meteorPool = [];
const ABIL = {
  // =============================== AURORA ===============================
  arcaneBolt: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.1); flash(_mz.x, _mz.y, _mz.z, 0x8f6bff, 2.2, 0.16);
      burst(_mz.x, _mz.y, _mz.z, { n: 8, color: 0xb8a4ff, int: 2.4, s0: 1, s1: 5, size: 0.3, l0: 0.15, l1: 0.35, vx: c.dir.x * 6, vz: c.dir.z * 6 });
      spawnProjectile({ kind: 'arcane', x: _mz.x, z: _mz.z, dx: c.dir.x, dz: c.dir.z, speed: 30, dmg: 24, team: 'player', range: 26, radius: 0.55, hit: { kb: 2.5 } });
    },
  },
  frostNova: {
    fire(p) {
      const x = p.pos.x, z = p.pos.z, R = 7.5, N = 22;
      ringFx(x, z, { tex: TEX.frost, color: 0x7fc4ff, r0: 1, r1: R, dur: 0.38, int: 0.9, hold: 0.7, keep: true });
      ringFx(x, z, { color: 0xe8f8ff, r0: 0.5, r1: R + 0.6, dur: 0.36, int: 3 });
      flash(x, 1.2, z, 0x9fdcff, 11, 0.35); flashLight(x, 2.5, z, 0x7fc8ff, 150, 24, 0.55); shake(0.4);
      burst(x, 0.4, z, { n: 80, color: 0xdff4ff, color2: 0x6fc0ff, int: 2.5, flat: true, s0: 10, s1: 24, size: 0.4, l0: 0.25, l1: 0.55, drag: 3 });
      burst(x, 0.3, z, { n: 16, smoke: true, color: 0xcfeaff, int: 1, flat: true, s0: 3, s1: 9, size: 1.5, size1: 3.5, l0: 0.5, l1: 1.0, r: 2 });
      for (let i = 0; i < N; i++) { // expanding ring of translucent shards that shatter
        const an = i / N * TAU, m = getShard('ice'), cs = Math.cos(an), sn = Math.sin(an), w = rand(0.6, 1.0), h = rand(1.5, 2.6); let t = 0;
        m.rotation.order = 'YXZ'; m.rotation.y = Math.atan2(cs, sn); m.rotation.x = rand(0.35, 0.7);
        addFx((dt) => {
          t += dt; const k = easeOut(Math.min(1, t / 0.34)), r = lerp(1.2, R - 0.4, k), fade = t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.25) : 1;
          m.position.set(x + cs * r, -0.1, z + sn * r); m.scale.set(w, h * Math.min(1, t / 0.2) * (0.6 + 0.4 * fade), w); m.material.opacity = 0.8 * fade;
          return t < 0.9;
        }, () => { burst(m.position.x, 0.8, m.position.z, { n: 5, color: 0xdff8ff, color2: 0x7fc8ff, int: 2, s0: 1, s1: 5, size: 0.3, grav: 16, l0: 0.25, l1: 0.6 }); freeShard(m); });
      }
      for (const e of enemiesIn(x, z, R)) damageEnemy(e, 30, { freeze: 2.5 });
    },
  },
  meteor: {
    fire(p, c) {
      const d = Math.min(20, dist2D(p.pos, c.aim)), tx = p.pos.x + c.dir.x * d, tz = p.pos.z + c.dir.z * d, R = 5.5, build = 0.6, fall = 0.42;
      ringFx(tx, tz, { tex: TEX.rune, color: 0xff7a2a, r0: 1.2, r1: R, dur: build, spin: 3.5, int: 2.6, keep: true, hold: 0.25, fadeIn: true });
      ringFx(tx, tz, { tex: TEX.glow, color: 0xff3a10, r0: R * 0.5, r1: R * 1.3, dur: build, int: 0.9, keep: true, hold: 0.2, fadeIn: true });
      let mm = meteorPool.pop();
      if (!mm) { mm = new THREE.Group(); mm.add(new THREE.Mesh(geo('meteor', () => new THREE.IcosahedronGeometry(1.15, 1)), new THREE.MeshBasicMaterial({ color: hdr(0xffb060, 2.6) })), mkGlow(0xff6a18, 3, 9)); }
      const sx = tx + 9, sy = 26, sz = tz - 6, L = getLight(0xff7a20, 0, 30); let t = 0, landed = false; mm.visible = false; fxRoot.add(mm);
      addFx((dt) => {
        t += dt;
        if (t < build) { // gathering embers inside the rune
          if (Math.random() < dt * 60) { const a = rand(TAU), r = rand(R); sparks.emit(tx + Math.cos(a) * r, 0.1, tz + Math.sin(a) * r, 0, rand(2, 6), 0, rgb(0xff8a30, 2.5), rand(0.3, 0.6), 0.3, 0, 0.5, 0); }
          if (t >= build - fall) {
            if (!mm.visible) sfx('meteorFall', { x: tx, z: tz });
            const k = (t - (build - fall)) / fall, kk = k * k; mm.visible = true; mm.position.set(lerp(sx, tx, kk), lerp(sy, 0.8, kk), lerp(sz, tz, kk)); mm.rotation.x += dt * 9; mm.rotation.z += dt * 6;
            for (let i = 0; i < 6; i++) sparks.emit(mm.position.x + randS(0.6), mm.position.y + randS(0.6), mm.position.z + randS(0.6), randS(2), rand(1, 4), randS(2), rgb(Math.random() < 0.4 ? 0xffe080 : 0xff6a18, 3), rand(0.25, 0.6), 1.3, 0, 1, 0);
            smoke.emit(mm.position.x, mm.position.y, mm.position.z, randS(1), 1, randS(1), rgb(0x2a1a12, 1), rand(0.5, 0.9), 1.2, 3.2, 1, 0);
            if (L) { L.position.copy(mm.position); L.intensity = 60 + 140 * kk; }
          }
          return true;
        }
        if (!landed) {
          landed = true; mm.visible = false; hitStop(0.09); shake(1.1); sfx('explosion', { x: tx, z: tz }, 1.2);
          flash(tx, 1.5, tz, 0xffb060, 22, 0.45, 4); beamFx(tx, tz, 0xffa040, 4, 18, 0.4, 3);
          ringFx(tx, tz, { color: 0xffd090, r0: 1, r1: R + 3, dur: 0.45, int: 3.5 }); ringFx(tx, tz, { color: 0xff5a14, r0: 0.5, r1: R + 1, dur: 0.6, int: 2.5, delay: 0.06 });
          burst(tx, 0.4, tz, { n: 110, color: 0xff7a20, color2: 0xffe080, int: 3.2, up: 2.2, s0: 4, s1: 22, size: 0.7, l0: 0.35, l1: 1.1, grav: 16, r: 1.5 });
          burst(tx, 0.4, tz, { n: 60, color: 0xff5a14, color2: 0xffb050, int: 3, flat: true, s0: 8, s1: 26, size: 0.5, l0: 0.25, l1: 0.6, drag: 3 });
          burst(tx, 0.5, tz, { n: 26, smoke: true, color: 0x2a1c14, color2: 0x4a3426, int: 1, up: 1.2, s0: 2, s1: 8, size: 2, size1: 5.5, l0: 0.8, l1: 1.8, r: 3, drag: 1.2 });
          rockRing(tx, tz, 3.2, 10, 1.3, 0); scorch(tx, tz, R * 0.95, 8);
          if (L) { L.position.set(tx, 3, tz); L.intensity = 260; }
          for (const e of enemiesIn(tx, tz, R)) damageEnemy(e, 150, { kb: 10, stun: 0.6, from: { x: tx, z: tz } });
        }
        if (L) L.intensity = 260 * Math.max(0, 1 - (t - build) / 0.6);
        return t < build + 0.6;
      }, () => { freeLight(L); fxRoot.remove(mm); meteorPool.push(mm); });
    },
  },
  chainLightning: {
    fire(p, c) {
      const origin = muzzle(p, c, new V3(), 0.9, 1.75);
      let cur = pickEnemyAtCursor(); if (cur && dist2D(cur.pos, p.pos) > 18) cur = null;
      if (!cur) cur = nearestEnemy(c.aim.x, c.aim.z, 5); if (cur && dist2D(cur.pos, p.pos) > 18) cur = null;
      if (!cur) { let bd = 15; for (const e of G.enemies) { if (e.dead) continue; const d = dist2D(e.pos, p.pos); if (d < bd && Math.abs(angDiff(Math.atan2(c.dir.x, c.dir.z), Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z))) < 0.6) { bd = d; cur = e; } } }
      flash(origin.x, origin.y, origin.z, 0x9fc4ff, 3, 0.2); flashLight(origin.x, origin.y, origin.z, 0x8fb8ff, 80, 16, 0.3);
      if (!cur) { const end = new V3(p.pos.x + c.dir.x * 12, 0.3, p.pos.z + c.dir.z * 12); lightning(origin, end); impactFx(end.x, 0.4, end.z, 0x9fc4ff, 0.8); return; }
      const seen = new Set(); let from = origin, dmg = 62;
      for (let n = 0; n < 4 && cur; n++) {
        const tgt = cur, a = from, d = dmg; seen.add(tgt);
        after(n * 0.08, () => {
          const b = new V3(tgt.pos.x, tgt.def.h * 0.55, tgt.pos.z); lightning(a, b, { color: 0x7fb0ff, dur: 0.32 }); lightning(a, b, { color: 0xb8a4ff, dur: 0.2, width: 0.05, jitter: 1.3 });
          impactFx(b.x, b.y, b.z, 0x9fc4ff, 1); burst(b.x, b.y, b.z, { n: 10, color: 0xffffff, color2: 0x7fb0ff, int: 3, s0: 4, s1: 14, size: 0.22, l0: 0.1, l1: 0.3, grav: 10 });
          damageEnemy(tgt, d, { stun: 0.3 }); shake(0.14); if (n) sfx('lightning', tgt.pos, 0.7);
        });
        from = new V3(tgt.pos.x, tgt.def.h * 0.55, tgt.pos.z); dmg *= 0.85; cur = nearestEnemy(tgt.pos.x, tgt.pos.z, 9, seen);
      }
    },
  },
  blink: {
    fire(p, c) {
      const ox = p.pos.x, oz = p.pos.z; let d = Math.min(9.5, Math.max(2, dist2D(p.pos, c.aim)));
      for (; d > 0; d -= 0.4) if (!isBlocked(ox + c.dir.x * d, oz + c.dir.z * d, p.radius)) break;
      d = Math.max(0, d); const nx = ox + c.dir.x * d, nz = oz + c.dir.z * d;
      const puff = (x, z) => { burst(x, 1.1, z, { n: 14, smoke: true, color: 0x5a2c9a, color2: 0x2a1450, int: 1, s0: 1, s1: 4, size: 1.6, size1: 3.6, l0: 0.4, l1: 0.9, h: 1 }); burst(x, 1.1, z, { n: 26, color: 0xb894ff, color2: 0x6a4cff, int: 2.6, s0: 2, s1: 9, size: 0.4, l0: 0.25, l1: 0.6, h: 1.2 }); flash(x, 1.2, z, 0x9a6bff, 6, 0.3); ringFx(x, z, { tex: TEX.rune, color: 0x9a6bff, r0: 0.5, r1: 2.2, dur: 0.45, spin: 5, int: 2.2 }); };
      puff(ox, oz); flashLight(ox, 1.5, oz, 0x9a6bff, 70, 14, 0.35);
      for (const k of [0, 0.35, 0.7]) { p.pos.set(ox + (nx - ox) * k, 0, oz + (nz - oz) * k); spawnGhost(p.rig, 0x9a6bff, 0.45 + k * 0.2, 0.75); }   // fading translucent clones along the path
      p.pos.set(nx, 0, nz); p.invuln = 0.3; p.moveTarget = null; puff(nx, nz); flashLight(nx, 1.5, nz, 0xb894ff, 90, 14, 0.4);
      CAM.target.x += (nx - ox) * 0.5; CAM.target.z += (nz - oz) * 0.5;
    },
  },

  // =============================== GWEN ===============================
  cleave: {
    fire(p, c) {
      const n = ++p.swing, dir = n % 2 ? 1 : -1, gold = n % 3 === 0, f = Math.atan2(c.dir.x, c.dir.z), R = 3.9;
      slashFx(p.pos.x, p.pos.z, f, { r: R, arc: 2.75, color: gold ? 0xffb830 : 0x38d8ff, color2: gold ? 0xfff0c0 : 0xe8ffff, dur: 0.2, dir, tilt: 0.2, int: 2.4 });
      slashFx(p.pos.x, p.pos.z, f, { r: R * 0.78, arc: 2.4, color: gold ? 0x38d8ff : 0xffc64a, color2: 0xffffff, dur: 0.24, dir, tilt: 0.26, int: 1.5, y: 1.05 });
      let hits = 0;
      for (const e of G.enemies) {
        if (e.dead) continue; const d = dist2D(e.pos, p.pos); if (d > R + e.radius) continue;
        if (d > 1.3 && Math.abs(angDiff(f, Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z))) > 1.45) continue;
        damageEnemy(e, 30, { kb: 3.5 }); hits++;
        const hx = lerp(p.pos.x, e.pos.x, 0.8), hz = lerp(p.pos.z, e.pos.z, 0.8);
        burst(hx, 1.2, hz, { n: 10, color: gold ? 0xffd070 : 0x8feaff, color2: 0xffffff, int: 2.8, s0: 4, s1: 13, size: 0.28, l0: 0.12, l1: 0.35, grav: 12, vx: c.dir.x * 4, vz: c.dir.z * 4 }); flash(hx, 1.2, hz, 0xffffff, 1.8, 0.12);
      }
      if (hits) { sfx('slashHit', p.pos); hitStop(0.055); shake(0.22 + Math.min(0.2, hits * 0.04)); flashLight(p.pos.x + c.dir.x * 2, 1.5, p.pos.z + c.dir.z * 2, gold ? 0xffc64a : 0x49e0ff, 50, 10, 0.2); }
    },
  },
  seismicSlam: {
    start(p, c) { if (!p.rig.isGltf) c.hop = true; },
    update(p, c) { if (c.hop) p.rig.pivot.position.y = 1 + (c.t < c.impact ? Math.sin(Math.PI * c.t / c.impact) * 1.6 : 0); },
    fire(p, c) {
      const x = p.pos.x + c.dir.x * 1.3, z = p.pos.z + c.dir.z * 1.3, R = 7.6;
      shake(0.8); hitStop(0.07); flash(x, 0.8, z, 0xffd070, 12, 0.35); flashLight(x, 2.5, z, 0xffb840, 150, 22, 0.5);
      ringFx(x, z, { color: 0xffe9a8, r0: 0.6, r1: R + 0.8, dur: 0.4, int: 3 }); ringFx(x, z, { color: 0x38d8ff, r0: 0.4, r1: R - 1, dur: 0.55, int: 2, delay: 0.05 });
      ringFx(x, z, { tex: TEX.cracks, color: 0xffc64a, int: 3, r0: 5.2, r1: 5.2, dur: 1.4, linear: true }); ringFx(x, z, { tex: TEX.scorch, additive: false, color: 0xffffff, int: 1, r0: 4.6, r1: 4.6, dur: 2.5, hold: 1.5, keep: true });
      rockRing(x, z, 2.8, 9, 1.7, 0, 0xffb040); rockRing(x, z, 5.2, 14, 1.3, 0.07, 0xffb040); rockRing(x, z, 7.2, 19, 0.9, 0.14, 0x38d8ff);
      burst(x, 0.3, z, { n: 70, color: 0xffc64a, color2: 0x8feaff, int: 3, flat: true, s0: 8, s1: 24, size: 0.45, l0: 0.25, l1: 0.6, drag: 3 });
      burst(x, 0.3, z, { n: 30, color: 0xffe9a8, int: 2.5, up: 2, s0: 3, s1: 13, size: 0.4, l0: 0.3, l1: 0.8, grav: 20, r: 3 });
      burst(x, 0.3, z, { n: 22, smoke: true, color: 0x6a5c4c, color2: 0x4a4038, int: 1, flat: true, s0: 3, s1: 10, size: 1.8, size1: 4.5, l0: 0.6, l1: 1.3, r: 3 });
      for (const e of enemiesIn(x, z, R)) damageEnemy(e, 65, { kb: 11, stun: 1.6, from: { x, z } });
    },
  },
  bladeVortex: {
    fire(p, c) {
      c.ribbons = [[4.3, 0x38d8ff, 0xe8ffff, 1.35, 0.1, 0], [3.7, 0xffb830, 0xfff0c0, 0.9, -0.14, 2.1], [3.1, 0x8feaff, 0xffffff, 1.7, 0.2, 4.2]].map(([r, col, col2, y, tilt, ph]) => {
        const m = getSlash(2.5, hdr(col, 2.2), hdr(col2, 3), 0.62); m.material.uniforms.uProg.value = 0.6; m.rotation.order = 'YXZ'; m.scale.set(r, r, r); m.userData = { y, tilt, ph }; fxRoot.add(m); return m;
      });
      c.L = getLight(0x49e0ff, 60, 13); c.tick = 0;
      ringFx(p.pos.x, p.pos.z, { color: 0x8feaff, r0: 0.5, r1: 5, dur: 0.3, int: 2.5 });
    },
    update(p, c, dt) {
      if (!c.fired) return; const left = c.cast - c.t, fade = Math.min(1, left / 0.25, (c.t - c.impact) / 0.15);
      p.spin += dt * 23;
      for (const m of c.ribbons) { m.position.set(p.pos.x, m.userData.y + Math.sin(c.t * 5 + m.userData.ph) * 0.12, p.pos.z); m.rotation.y = p.spin * 0.85 + m.userData.ph; m.rotation.z = m.userData.tilt + Math.sin(c.t * 7 + m.userData.ph) * 0.06; m.material.uniforms.uAlpha.value = fade; }
      if (c.L) { c.L.position.set(p.pos.x, 2, p.pos.z); c.L.intensity = 60 * fade * (0.8 + rand(0.3)); }
      for (let i = 0; i < 3; i++) { const a = rand(TAU), r = rand(2.6, 4.2), tx = -Math.sin(a), tz = Math.cos(a); sparks.emit(p.pos.x + Math.cos(a) * r, rand(0.5, 1.9), p.pos.z + Math.sin(a) * r, -tx * 11, rand(-1, 3), -tz * 11, rgb(Math.random() < 0.5 ? 0xffc64a : 0x8feaff, 2.6), rand(0.15, 0.4), 0.26, 0, 2, 6); }
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick = 0.22; let hits = 0;
        for (const e of enemiesIn(p.pos.x, p.pos.z, 4.4)) { damageEnemy(e, 20, { kb: 1.5 }); hits++; burst(e.pos.x, 1.2, e.pos.z, { n: 6, color: 0xffffff, color2: 0xffc64a, int: 2.6, s0: 3, s1: 10, size: 0.25, l0: 0.1, l1: 0.3, grav: 10 }); }
        if (hits) { shake(0.12); sfx('slashHit', p.pos, 0.6); }
      }
    },
    end(p, c) { if (c.ribbons) for (const m of c.ribbons) freeSlash(m); freeLight(c.L); if (c.fired) { ringFx(p.pos.x, p.pos.z, { color: 0xffe9a8, r0: 1, r1: 6, dur: 0.35, int: 2.5 }); burst(p.pos.x, 1.2, p.pos.z, { n: 30, color: 0xffc64a, color2: 0x8feaff, int: 2.6, flat: true, s0: 6, s1: 16, size: 0.3, l0: 0.2, l1: 0.45 }); } },
  },
  dragonRoar: {
    fire(p) {
      const x = p.pos.x, z = p.pos.z; p.roarT = 6; shake(0.5);
      ringFx(x, z, { color: 0xffd070, r0: 0.6, r1: 9.5, dur: 0.5, int: 3 }); ringFx(x, z, { color: 0xfff0c0, r0: 0.3, r1: 6, dur: 0.65, int: 2, delay: 0.08 });
      ringFx(x, z, { tex: TEX.rune, color: 0xffb830, r0: 1, r1: 3.4, dur: 0.5, spin: -4, int: 2.4, hold: 0.4, keep: true });
      beamFx(x, z, 0xffc64a, 3.4, 12, 0.6, 2.4); flash(x, 1.6, z, 0xffd070, 12, 0.4); flashLight(x, 2.5, z, 0xffc040, 160, 24, 0.6);
      burst(x, 0.2, z, { n: 70, color: 0xffc64a, color2: 0xfff0c0, int: 3, up: 2.6, s0: 3, s1: 14, size: 0.4, l0: 0.4, l1: 1.0, r: 1.6, drag: 1.5 });
      burst(x, 1.2, z, { n: 50, color: 0xffb830, int: 2.6, flat: true, s0: 10, s1: 22, size: 0.35, l0: 0.2, l1: 0.5, drag: 3 });
      const aura = getFlat(TEX.glow, 0xffb830, 1.3); aura.scale.set(4.4, 1, 4.4);
      addFx(() => { aura.position.x = p.pos.x; aura.position.z = p.pos.z; aura.material.opacity = Math.min(1, p.roarT) * (0.75 + Math.sin(G.time * 9) * 0.25); return p.roarT > 0 && !p.dead; }, () => freeFlat(aura));
      for (const e of enemiesIn(x, z, 8.5)) damageEnemy(e, 22, { kb: 7, slow: 0.4, slowT: 3 });
    },
  },
  charge: {
    start(p, c) {
      p.invuln = 0.38; const seen = new Set(); let gt = 0;
      p.dash = { dx: c.dir.x, dz: c.dir.z, speed: 46, dur: 0.28, t: 0,
        step(p, d, dt) {
          gt -= dt; if (gt <= 0) { gt = 0.04; spawnGhost(p.rig, 0xffb830, 0.32, 0.6); }
          for (let i = 0; i < 4; i++) sparks.emit(p.pos.x + randS(0.5), rand(0.2, 2), p.pos.z + randS(0.5), -d.dx * rand(2, 8), rand(0, 2), -d.dz * rand(2, 8), rgb(0xffc64a, 2.6), rand(0.2, 0.5), 0.3, 0, 1.5, 0);
          for (const e of enemiesIn(p.pos.x, p.pos.z, 2.1)) { if (seen.has(e)) continue; seen.add(e); damageEnemy(e, 42, { kb: 7 }); sfx('slashHit', e.pos); impactFx(e.pos.x, 1.2, e.pos.z, 0xffc64a, 1); hitStop(0.035); shake(0.2); }
        },
        done(p, d) { slashFx(p.pos.x, p.pos.z, Math.atan2(d.dx, d.dz), { r: 3.2, arc: 2.2, color: 0xffb830, color2: 0xfff0c0, dur: 0.2, int: 2.2 }); ringFx(p.pos.x, p.pos.z, { color: 0xffd070, r0: 0.4, r1: 3.2, dur: 0.3, int: 2 }); },
      };
      ringFx(p.pos.x, p.pos.z, { color: 0xffd070, r0: 0.4, r1: 2.6, dur: 0.3, int: 2 }); flashLight(p.pos.x, 1.5, p.pos.z, 0xffc040, 60, 12, 0.3);
    },
    fire() {},
  },

  // =============================== ASHE ===============================
  frostArrow: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.0); flash(_mz.x, _mz.y, _mz.z, 0x9fe8ff, 1.6, 0.12);
      burst(_mz.x, _mz.y, _mz.z, { n: 5, color: 0xdff8ff, int: 2.2, s0: 1, s1: 4, size: 0.22, l0: 0.1, l1: 0.3, vx: c.dir.x * 8, vz: c.dir.z * 8 });
      spawnProjectile({ kind: 'frost', x: _mz.x, z: _mz.z, dx: c.dir.x, dz: c.dir.z, speed: 48, dmg: 21, team: 'player', range: 30, radius: 0.42, hit: { slow: 0.25, slowT: 1.5, kb: 1.2 } });
    },
  },
  volley: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.0); flash(_mz.x, _mz.y, _mz.z, 0x9fe8ff, 3.4, 0.2); flashLight(_mz.x, _mz.y, _mz.z, 0x7fd8ff, 70, 14, 0.25); shake(0.15);
      ringFx(p.pos.x, p.pos.z, { color: 0x9fe8ff, r0: 0.4, r1: 2.6, dur: 0.28, int: 2 });
      const f = Math.atan2(c.dir.x, c.dir.z);
      for (const a of [-0.36, -0.18, 0, 0.18, 0.36]) spawnProjectile({ kind: 'frost', x: _mz.x, z: _mz.z, dx: Math.sin(f + a), dz: Math.cos(f + a), speed: 44, dmg: 26, team: 'player', range: 24, radius: 0.5, pierce: true, noLight: a !== 0, hit: { slow: 0.3, slowT: 2, kb: 1.5 } });
    },
  },
  arrowRain: {
    fire(p, c) {
      const d = Math.min(22, dist2D(p.pos, c.aim)), tx = p.pos.x + c.dir.x * d, tz = p.pos.z + c.dir.z * d, R = 6;
      // skyward flare
      const fl = mkGlow(0xbff0ff, 3.5, 2.4), L = getLight(0x9fe8ff, 90, 22), bx = p.pos.x, bz = p.pos.z; let t = 0; fl.position.set(bx, 2, bz); fxRoot.add(fl);
      flash(bx, 2.2, bz, 0x9fe8ff, 3, 0.2);
      addFx((dt) => { t += dt; const k = t / 0.4; fl.position.y = 2 + 30 * k * (2 - k) * 0.6; fl.position.x = lerp(bx, tx, k * 0.3); fl.position.z = lerp(bz, tz, k * 0.3);
        for (let i = 0; i < 4; i++) sparks.emit(fl.position.x + randS(0.15), fl.position.y - rand(1.5), fl.position.z + randS(0.15), randS(0.6), -rand(2), randS(0.6), rgb(0xbff0ff, 2.5), rand(0.25, 0.6), 0.35, 0, 1, 0);
        if (L) L.position.copy(fl.position); return t < 0.4; }, () => { fxRoot.remove(fl); fl.material.dispose(); freeLight(L); });
      after(0.3, () => {
        ringFx(tx, tz, { tex: TEX.frost, color: 0x6fb8ff, r0: R * 0.7, r1: R, dur: 0.3, int: 0.55, hold: 2.3, keep: true, fadeIn: true });
        ringFx(tx, tz, { tex: TEX.rune, color: 0x7fd8ff, r0: R * 0.5, r1: R * 0.92, dur: 2.3, spin: 0.9, int: 1.1, keep: true, hold: 0.3, fadeIn: true, linear: true });
        beamFx(tx, tz, 0x9fe8ff, 2.5, 22, 0.5, 1.6);
      });
      for (let i = 0; i < 30; i++) after(0.42 + i * (2 / 30) + rand(0.04), () => {
        const a = rand(TAU), r = Math.sqrt(Math.random()) * (R - 0.6), x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
        const sp = projPool.frost.pop() || buildProj('frost'); let st = 0; const lean = randS(0.12);
        sp.scale.setScalar(2.1); sp.rotation.set(Math.PI / 2 + lean, 0, 0); fxRoot.add(sp);
        addFx((dt) => { st += dt; const k = Math.min(1, st / 0.2); sp.position.set(x, lerp(22, 0.6, k), z + (1 - k) * lean * -20);
          sparks.emit(x, sp.position.y + 1.5, sp.position.z, 0, 0, 0, rgb(0xbff0ff, 2), 0.18, 0.3, 0, 0, 0); return st < 0.2; },
        () => {
          sp.scale.setScalar(1); fxRoot.remove(sp); projPool.frost.push(sp);
          flash(x, 0.6, z, 0x9fe8ff, 3.2, 0.2); ringFx(x, z, { color: 0xbff0ff, r0: 0.2, r1: 2.1, dur: 0.28, int: 2 });
          burst(x, 0.3, z, { n: 12, color: 0xdff8ff, color2: 0x6fc8ff, int: 2.5, up: 1.6, s0: 3, s1: 11, size: 0.3, grav: 22, l0: 0.25, l1: 0.6 });
          if (i % 6 === 0) { flashLight(x, 1.5, z, 0x7fd8ff, 60, 13, 0.25); shake(0.12); }
          const stuck = getShard('ice'); stuck.position.set(x, -0.1, z); stuck.rotation.set(randS(0.3), rand(TAU), randS(0.3)); stuck.scale.set(0.45, rand(1.2, 1.9), 0.45); let lt = 0;
          addFx((dt) => { lt += dt; stuck.material.opacity = 0.8 * Math.max(0, 1 - lt / 0.7); return lt < 0.7; }, () => freeShard(stuck));
          sfx('spear', { x, z }, 0.55);
          for (const e of enemiesIn(x, z, 1.9)) damageEnemy(e, 24, { slow: 0.35, slowT: 2 });
        });
      });
    },
  },
  hawkshot: {
    fire(p) {
      p.focusT = 8;
      const g = new THREE.Group(), wingMat = new THREE.MeshBasicMaterial({ color: hdr(0x5fe8ff, 2), transparent: true, opacity: 0.75, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const wingGeo = geo('wing', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.7, 0.55, 1.7, 0.25); s.quadraticCurveTo(1.2, 0.05, 1.0, -0.2); s.quadraticCurveTo(0.6, -0.1, 0.45, -0.4); s.quadraticCurveTo(0.2, -0.15, 0, -0.3); return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2); });
      const wl = new THREE.Mesh(wingGeo, wingMat), wr = new THREE.Mesh(wingGeo, wingMat); wr.scale.x = -1;
      const body = new THREE.Mesh(geo('hbody', () => new THREE.ConeGeometry(0.2, 0.9, 5).rotateX(Math.PI / 2)), basicHdr(0xdffff8, 2.6));
      const glow = mkGlow(0x4fd8ff, 2.2, 3.2); g.add(wl, wr, body, glow); fxRoot.add(g);
      const L = getLight(0x5fe8ff, 40, 12); let t = 0, shot = 0.3; const x0 = p.pos.x, z0 = p.pos.z;
      beamFx(x0, z0, 0x5fe8ff, 2.2, 9, 0.5, 2); ringFx(x0, z0, { tex: TEX.rune, color: 0x5fe8ff, r0: 0.5, r1: 2.8, dur: 0.5, spin: 3, int: 2 });
      burst(x0, 1, z0, { n: 30, color: 0x9ffff0, int: 2.4, up: 2.2, s0: 2, s1: 9, size: 0.3, l0: 0.3, l1: 0.8, r: 1 });
      addFx((dt) => {
        t += dt; const k = Math.min(1, t / 0.4) * Math.min(1, Math.max(0, p.focusT) / 0.4), a = t * 1.6;
        g.position.set(p.pos.x + Math.cos(a) * 1.3, 4.1 + Math.sin(t * 3) * 0.25, p.pos.z + Math.sin(a) * 1.3); g.rotation.y = -a; g.scale.setScalar(k);
        const flap = Math.sin(t * 9) * 0.55; wl.rotation.z = flap; wr.rotation.z = -flap; wingMat.opacity = 0.75 * k;
        if (L) { L.position.copy(g.position); L.intensity = 40 * k; }
        if (Math.random() < dt * 30) sparks.emit(g.position.x + randS(0.5), g.position.y, g.position.z + randS(0.5), 0, -rand(1, 3), 0, rgb(0x9ffff0, 2), rand(0.3, 0.7), 0.22, 0, 0.5, 0);
        shot -= dt;
        if (shot <= 0) { const e = nearestEnemy(p.pos.x, p.pos.z, 17); shot = 0.55;
          if (e) { const dx = e.pos.x - g.position.x, dz = e.pos.z - g.position.z, l = Math.hypot(dx, dz) || 1; sfx('wisp', p.pos, 0.6); spawnProjectile({ kind: 'wisp', x: g.position.x, y: g.position.y, z: g.position.z, dx: dx / l, dz: dz / l, vy: 3, speed: 22, dmg: 16, team: 'player', range: 40, radius: 0.5, homing: 7, target: e }); flash(g.position.x, g.position.y, g.position.z, 0x9ffff0, 1.6, 0.15); } }
        return p.focusT > 0 && !p.dead;
      }, () => { fxRoot.remove(g); wingMat.dispose(); glow.material.dispose(); freeLight(L); });
    },
  },
  shadowRoll: {
    start(p, c) {
      const ox = p.pos.x, oz = p.pos.z; p.invuln = 0.4; iceTrap(ox, oz);
      p.dash = { dx: c.dir.x, dz: c.dir.z, speed: 36, dur: 0.3, t: 0, roll: true,
        step(p, d, dt, k) {
          p.rig.pivot.rotation.x = k * TAU;
          for (let i = 0; i < 2; i++) smoke.emit(p.pos.x + randS(0.5), rand(0.2, 1.4), p.pos.z + randS(0.5), randS(1), rand(0.3, 1.2), randS(1), rgb(Math.random() < 0.5 ? 0xbfe6ff : 0x7fa8c8, 1), rand(0.4, 0.9), 1.1, 2.6, 1.5, 0);
          sparks.emit(p.pos.x + randS(0.5), rand(0.2, 1.6), p.pos.z + randS(0.5), 0, rand(0.5, 2), 0, rgb(0xdff8ff, 2.2), rand(0.3, 0.6), 0.22, 0, 1, 0);
        },
        done(p) { p.rig.pivot.rotation.x = 0; ringFx(p.pos.x, p.pos.z, { color: 0x9fe8ff, r0: 0.3, r1: 2.4, dur: 0.3, int: 1.8 }); },
      };
    },
    fire() {},
  },
};

/** slowing ice trap left behind by Ashe's roll */
function iceTrap(x, z) {
  const R = 3.3, dur = 6, flat = getFlat(TEX.frost, 0x7fc4ff, 0.8), shards = []; flat.position.x = x; flat.position.z = z; flat.scale.set(0.1, 1, 0.1);
  for (let i = 0; i < 6; i++) { const m = getShard('ice'), a = i / 6 * TAU + 0.3; m.position.set(x + Math.cos(a) * R * 0.55, -0.1, z + Math.sin(a) * R * 0.55); m.rotation.set(randS(0.3), rand(TAU), randS(0.3)); m.scale.set(0.4, 0.01, 0.4); m.userData.h = rand(0.6, 1.1); shards.push(m); }
  flash(x, 0.5, z, 0x9fe8ff, 5, 0.3); let t = 0, tick = 0;
  addFx((dt) => {
    t += dt; tick -= dt; const k = easeOut(Math.min(1, t / 0.25)), fade = Math.min(1, (dur - t) / 0.5);
    flat.scale.set(R * 2 * k, 1, R * 2 * k); flat.rotation.y += dt * 0.4; flat.material.opacity = fade * (0.7 + Math.sin(t * 5) * 0.15);
    for (const m of shards) { m.scale.y = m.userData.h * k * fade; m.material.opacity = 0.8 * fade; }
    if (Math.random() < dt * 12) { const a = rand(TAU), r = rand(R); smoke.emit(x + Math.cos(a) * r, 0.2, z + Math.sin(a) * r, 0, rand(0.3, 0.9), 0, rgb(0xbfe6ff, 1), rand(0.6, 1.2), 0.8, 2, 0.5, 0); }
    if (tick <= 0) { tick = 0.25; for (const e of enemiesIn(x, z, R)) { if (e.slowF > 0.45) { burst(e.pos.x, 0.6, e.pos.z, { n: 8, color: 0xdff8ff, int: 2.2, up: 1.5, s0: 2, s1: 6, size: 0.28, l0: 0.2, l1: 0.5 }); damageEnemy(e, 8, {}); } e.slow = Math.max(e.slow, 1.2); e.slowF = Math.min(e.slowF, e.def.boss ? 0.75 : 0.4); } }
    return t < dur;
  }, () => { freeFlat(flat); for (const m of shards) freeShard(m); });
}
// =====================================================================================
//  Loot – rings & amulets with rolled stats, rarity-coloured drops, inventory
// =====================================================================================
const RARITY = [
  { name: 'Obyčajný', color: 0xe8e8e8, css: '#e8e8e8', w: 55, lv: 0 },     // biela
  { name: 'Vylepšený', color: 0x3fd04a, css: '#4be05a', w: 28, lv: 0.3 },   // zelená
  { name: 'Magický', color: 0x3d8bff, css: '#5aa2ff', w: 12, lv: 0.35 },    // modrá
  { name: 'Epický', color: 0xb04dff, css: '#c477ff', w: 4, lv: 0.3 },       // fialová
  { name: 'Legendárny', color: 0xff8a1e, css: '#ff9a2e', w: 0.7, lv: 0.2 }, // oranžová – vzácne
  { name: 'Unikátny', color: 0xffe23a, css: '#ffe84a', w: 0.12, lv: 0.12 }, // žltá – veľmi vzácne
];
const STATS = {
  dmg: { name: 'Poškodenie', unit: ' %', base: [4, 8] },
  hp: { name: 'Život', unit: '', base: [18, 36] },
  mana: { name: 'Mana / energia', unit: '', base: [10, 20] },
  crit: { name: 'Šanca na kritický zásah', unit: ' %', base: [1.5, 3] },
  critDmg: { name: 'Kritické poškodenie', unit: ' %', base: [6, 12] },
  atkSpeed: { name: 'Rýchlosť útoku', unit: ' %', base: [3, 6] },
  moveSpeed: { name: 'Rýchlosť pohybu', unit: ' %', base: [2, 4] },
  hpRegen: { name: 'Regenerácia života', unit: '/s', base: [0.8, 1.6] },
  manaRegen: { name: 'Regenerácia many / energie', unit: '/s', base: [0.8, 1.6] },
  cdr: { name: 'Rýchlejšie obnovenie schopností', unit: ' %', base: [2, 4] },
  armor: { name: 'Zníženie poškodenia', unit: ' %', base: [2, 4] },
};
const ITEM_NAMES = {
  ring: ['Prsteň', 'Pečatný prsteň', 'Obrúčka'], amulet: ['Amulet', 'Prívesok', 'Náhrdelník', 'Talizman'],
  suffix: ['vlka', 'búrky', 'popola', 'krypty', 'tieňov', 'úsvitu', 'draka', 'mrazu', 'plameňa', 'ticha', 'odvahy', 'krvi', 'hviezd', 'priepasti', 'lovca', 'mudrca', 'divočiny', 'zabudnutia', 'strážcu', 'noci'],
  uniqueRing: ['Oko búrky', 'Pečať dračej svätyne', 'Prsteň Popolového kolosa', 'Obrúčka večného mrazu'],
  uniqueAmulet: ['Ignaraxovo srdce', 'Slza úsvitu', 'Náhrdelník zabudnutých kráľov', 'Talizman arkánového ohňa'],
};
let itemSeq = 1;
/** level = zone number (1-3); rarity can be forced or given a floor */
function makeItem(level = 1, forced, minRarity = 0) {
  let rarity = forced;
  if (rarity === undefined) {
    const w = RARITY.map((r, i) => (i < minRarity ? 0 : r.w * (1 + (level - 1) * r.lv)));
    let roll = Math.random() * w.reduce((a, b) => a + b, 0); rarity = 0;
    for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) { rarity = i; break; } }
  }
  const type = Math.random() < 0.6 ? 'ring' : 'amulet', keys = Object.keys(STATS), stats = [];
  for (let n = Math.min(6, rarity + 1); n > 0; n--) {
    const k = keys.splice((Math.random() * keys.length) | 0, 1)[0], s = STATS[k];
    let v = rand(s.base[0], s.base[1]) * (1 + rarity * 0.45) * (1 + (level - 1) * 0.3) * (type === 'amulet' ? 1.15 : 1);
    stats.push([k, s.base[1] < 5 ? Math.round(v * 10) / 10 : Math.round(v)]);
  }
  const name = rarity === 5 ? pick(type === 'ring' ? ITEM_NAMES.uniqueRing : ITEM_NAMES.uniqueAmulet) : `${pick(ITEM_NAMES[type])} ${pick(ITEM_NAMES.suffix)}`;
  return { id: Date.now().toString(36) + '_' + itemSeq++, type, rarity, name, stats, level };
}
const fmtStat = (k, v) => `+${String(v).replace('.', ',')}${STATS[k].unit} ${STATS[k].name}`;

// ------------------------------------------------------------------ inventory state (kept in localStorage between sessions)
const INV = { bag: Array(28).fill(null), eq: { amulet: null, ring1: null, ring2: null }, coins: 0, keys: 0 };
const SAVE_KEY = 'kroniky_popola_inventar_v1';
function saveInv() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(INV)); } catch (e) { /* storage unavailable – inventory stays in memory */ } }
function loadInv() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (d && Array.isArray(d.bag) && d.eq) { for (let i = 0; i < 28; i++) INV.bag[i] = d.bag[i] || null; for (const k in INV.eq) INV.eq[k] = d.eq[k] || null; INV.coins = Math.max(0, d.coins | 0); INV.keys = Math.max(0, d.keys | 0); } } catch (e) { /* ignore corrupt save */ }
}
function equipBonus() {
  const b = {}; for (const k in STATS) b[k] = 0;
  for (const s in INV.eq) { const it = INV.eq[s]; if (it) for (const [k, v] of it.stats) b[k] += v; }
  return b;
}
function targetSlot(it) { return it.type === 'amulet' ? 'amulet' : !INV.eq.ring1 ? 'ring1' : !INV.eq.ring2 ? 'ring2' : 'ring1'; }
function equipFromBag(i) { const it = INV.bag[i]; if (!it) return; const s = targetSlot(it); INV.bag[i] = INV.eq[s]; INV.eq[s] = it; invChanged(); const p = G.player; if (p) { burst(p.pos.x, 1.2, p.pos.z, { n: 18, color: RARITY[it.rarity].color, int: 2.4, up: 1.6, s0: 2, s1: 7, size: 0.3, l0: 0.3, l1: 0.7, r: 0.8 }); } }
function unequip(slot) { const it = INV.eq[slot]; if (!it) return; const i = INV.bag.indexOf(null); if (i < 0) { toast('Inventár je plný'); return; } INV.bag[i] = it; INV.eq[slot] = null; invChanged(); }
function discard(i) { const it = INV.bag[i]; if (!it) return; INV.bag[i] = null; invChanged(); const p = G.player; if (p && G.state === 'playing') dropItem(it, p.pos.x + Math.sin(p.facing) * 2.2, p.pos.z + Math.cos(p.facing) * 2.2, true); }
function invChanged() { recomputeStats(); saveInv(); renderInventory(); hideTip(); }

// ------------------------------------------------------------------ world drops
const dropLights = [0, 1].map(() => { const L = new THREE.PointLight(0xffffff, 0, 11, 2); scene.add(L); return L; });
const dropRoot = new THREE.Group(); scene.add(dropRoot);
function itemMesh(it) {
  const g = new THREE.Group(), col = RARITY[it.rarity].color;
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.9, roughness: 0.3, emissive: col, emissiveIntensity: 0.5 });
  const gem = new THREE.MeshBasicMaterial({ color: hdr(col, 2.4) });
  if (it.type === 'ring') { g.add(new THREE.Mesh(geo('iring', () => new THREE.TorusGeometry(0.27, 0.065, 8, 22)), gold)); const j = new THREE.Mesh(geo('igem', () => new THREE.OctahedronGeometry(0.12, 0)), gem); j.position.y = 0.31; g.add(j); }
  else { const j = new THREE.Mesh(geo('igem2', () => new THREE.OctahedronGeometry(0.21, 0)), gem); j.scale.y = 1.35; g.add(j); const loop = new THREE.Mesh(geo('iloop', () => new THREE.TorusGeometry(0.36, 0.03, 6, 22, Math.PI * 1.25)), gold); loop.position.y = 0.42; loop.rotation.z = -Math.PI * 0.125 + Math.PI * 1.5; g.add(loop); }
  g.userData.mats = [gold, gem]; return g;
}
function dropItem(it, x, z, quiet) {
  const r = RARITY[it.rarity], g = new THREE.Group(), mesh = itemMesh(it);
  const beam = makeBeam(r.color, 1.5 + it.rarity * 0.35, 0.7 + it.rarity * 0.14, 4.5 + it.rarity * 1.7);
  const glow = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: TEX.glow, color: hdr(r.color, 1.4 + it.rarity * 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(2.6 + it.rarity * 0.4, 1, 2.6 + it.rarity * 0.4); glow.position.y = 0.05; glow.renderOrder = 6;
  g.add(mesh, beam, glow); g.position.set(x, 0, z); dropRoot.add(g);
  const lbl = document.createElement('div'); lbl.className = 'lootlbl'; lbl.textContent = it.name; lbl.style.color = r.css; $('#labels').appendChild(lbl);
  const d = { it, g, mesh, beam, glow, lbl, x, z, t: 0, mats: [...mesh.userData.mats, beam.material, glow.material] };
  G.drops.push(d);
  if (!quiet) { flash(x, 1, z, r.color, 3 + it.rarity * 0.8, 0.35); if (it.rarity >= 3) { sfx('rareDrop', { x, z }, 1, it.rarity); ringFx(x, z, { color: r.color, r0: 0.3, r1: 3 + it.rarity, dur: 0.6, int: 2.5 }); toast(`${r.name} predmet!`, r.css); } }
  return d;
}
function dropGlobe(x, z) {
  const g = new THREE.Group(), core = new THREE.Mesh(geo('globe', () => new THREE.IcosahedronGeometry(0.3, 2)), new THREE.MeshBasicMaterial({ color: hdr(0xff2a20, 2.2) })), gl = mkGlow(0xff3020, 1.6, 2);
  g.add(core, gl); g.position.set(x, 0, z); dropRoot.add(g);
  G.drops.push({ globe: true, g, mesh: core, x, z, t: 0, mats: [core.material, gl.material] });
}
function rollLoot(e) {
  const lvl = G.zoneIndex + 1 + (G.tier - 1), pw = MON_POWER[e.type] || 1;
  rollEconomy(e);
  if (pw === 3) { for (let i = 0; i < 2; i++) dropItem(makeItem(lvl, undefined, 2), e.pos.x + randS(1.5), e.pos.z + randS(1.5)); return; }   // mini-boss: 2 items, blue or better
  if (Math.random() < e.def.loot * (1 + G.zoneIndex * 0.12) * (1 + 0.25 * (G.tier - 1))) dropItem(makeItem(lvl), e.pos.x + randS(0.6), e.pos.z + randS(0.6));
  else if (Math.random() < 0.13) dropGlobe(e.pos.x, e.pos.z);
}
function removeDrop(i) { const d = G.drops[i]; dropRoot.remove(d.g); for (const m of d.mats) m.dispose(); if (d.lbl) d.lbl.remove(); G.drops.splice(i, 1); }
function clearDrops() { for (let i = G.drops.length - 1; i >= 0; i--) removeDrop(i); for (const L of dropLights) L.intensity = 0; }
let bagFullT = 0;
function updateDrops(dt) {
  const p = G.player; bagFullT -= dt; let l0 = null, l1 = null;
  for (let i = G.drops.length - 1; i >= 0; i--) {
    const d = G.drops[i]; d.t += dt;
    if (d.coin || d.key) { if (updateEconDrop(d, dt, p, dist2D(p.pos, d))) removeDrop(i); continue; }
    const pop = Math.min(1, d.t / 0.45), y = (d.globe ? 0.55 : 0.75) + Math.sin(pop * Math.PI) * 1.4 * (1 - pop * 0.3) + Math.sin(d.t * 2.4) * 0.09;
    d.mesh.position.y = y; d.mesh.rotation.y += dt * 2.2;
    if (d.beam) { d.beam.material.opacity = Math.min(1, d.t * 2) * (0.75 + Math.sin(d.t * 3) * 0.15); d.beam.rotation.y += dt * 0.5; }
    const dist = dist2D(p.pos, d);
    if (!d.globe) {
      d.score = d.it.rarity * 100 - dist; if (dist < 34) { if (!l0 || d.score > l0.score) { l1 = l0; l0 = d; } else if (!l1 || d.score > l1.score) l1 = d; }
      if (toScreen(d.x, 1.9, d.z, _scr) && dist < 30) { d.lbl.style.display = ''; d.lbl.style.transform = `translate(-50%,-50%) translate(${_scr.x.toFixed(1)}px,${_scr.y.toFixed(1)}px)`; } else d.lbl.style.display = 'none';
      if (Math.random() < dt * (2 + d.it.rarity * 2)) sparks.emit(d.x + randS(0.4), 0.2, d.z + randS(0.4), 0, rand(1.5, 4), 0, rgb(RARITY[d.it.rarity].color, 2.2), rand(0.5, 1.1), 0.2, 0, 0.3, 0);
    }
    if (d.t > 0.5 && !p.dead && dist < 1.5) {
      if (d.globe) { if (p.hp < p.st.maxHp) { healPlayer(p.st.maxHp * 0.25); flash(d.x, 1, d.z, 0xff4030, 3, 0.3); burst(p.pos.x, 1, p.pos.z, { n: 16, color: 0xff5040, int: 2.2, up: 2, s0: 2, s1: 6, size: 0.3, l0: 0.3, l1: 0.7, r: 0.6 }); removeDrop(i); } continue; }
      const slot = INV.bag.indexOf(null);
      if (slot < 0) { if (bagFullT <= 0) { toast('Inventár je plný'); bagFullT = 2.5; } continue; }
      INV.bag[slot] = d.it; const r = RARITY[d.it.rarity];
      toast(`Získané: ${d.it.name}`, r.css); sfx('pickup', null, 1, d.it.rarity); flash(d.x, 1, d.z, r.color, 3.5, 0.3); burst(d.x, 0.8, d.z, { n: 16, color: r.color, int: 2.4, up: 2, s0: 2, s1: 8, size: 0.3, l0: 0.3, l1: 0.7 });
      removeDrop(i); saveInv(); renderInventory(); pulseInvButton();
    }
  }
  [l0, l1].forEach((d, i) => { const L = dropLights[i]; if (d) { L.color.setHex(RARITY[d.it.rarity].color); L.position.set(d.x, 1.4, d.z); L.intensity = (10 + d.it.rarity * 7) * Math.min(1, d.t * 2) * (0.85 + Math.sin(d.t * 4) * 0.15); } else L.intensity = 0; });
}

// ------------------------------------------------------------------ inventory UI
const itemIcon = (it) => it.type === 'ring'
  ? `<svg viewBox="0 0 32 32"><circle cx="16" cy="19" r="8.5" fill="none" stroke="#d9b25a" stroke-width="3.2"/><path d="M16 3.5l5 5-5 5-5-5z" fill="${RARITY[it.rarity].css}" stroke="#fff" stroke-width=".8"/></svg>`
  : `<svg viewBox="0 0 32 32"><path d="M6 4q10 16 20 0" fill="none" stroke="#d9b25a" stroke-width="2"/><path d="M16 13l6 7-6 9-6-9z" fill="${RARITY[it.rarity].css}" stroke="#fff" stroke-width=".8"/></svg>`;
const EQ_SLOTS = [['ring1', 'Prsteň I'], ['amulet', 'Amulet'], ['ring2', 'Prsteň II']];
function cellHtml(it, cls, data) { return `<div class="cell ${cls} ${it ? 'has' : ''}" ${data} ${it ? `style="--rc:${RARITY[it.rarity].css}"` : ''}>${it ? itemIcon(it) : ''}</div>`; }
function renderInventory() {
  $('#equip').innerHTML = EQ_SLOTS.map(([s, n]) => `<figure>${cellHtml(INV.eq[s], 'big', `data-eq="${s}"`)}<figcaption>${n}</figcaption></figure>`).join('');
  $('#bag').innerHTML = INV.bag.map((it, i) => cellHtml(it, '', `data-bag="${i}"`)).join('');
  const p = G.player;
  if (p) {
    const s = p.st, pc = (v) => Math.round(v * 100) + ' %';
    $('#stats').innerHTML = [['Život', s.maxHp], [p.def.resName, s.maxMana], ['Poškodenie', pc(s.dmgMul)], ['Krit. šanca', pc(s.crit)], ['Krit. poškodenie', pc(s.critDmg)], ['Rýchlosť útoku', pc(s.atkSpeed)],
      ['Rýchlosť pohybu', pc(s.moveSpeed)], ['Zníž. poškodenia', pc(s.armor)], ['Obnova schopností', '+' + pc(s.cdr)], ['Regenerácia', `${s.hpRegen.toFixed(1)} / ${s.manaRegen.toFixed(1)}`]].map(([n, v]) => `<span>${n}</span><b>${v}</b>`).join('');
  }
}
function itemAt(el) { const c = el.closest && el.closest('.cell'); if (!c) return null; if (c.dataset.bag !== undefined) return { it: INV.bag[+c.dataset.bag], bag: +c.dataset.bag }; if (c.dataset.eq) return { it: INV.eq[c.dataset.eq], eq: c.dataset.eq }; return null; }
function showTip(ref, x, y) {
  const it = ref.it, r = RARITY[it.rarity], tip = $('#tip');
  let html = `<h4 style="color:${r.css}">${it.name}</h4><div class="r" style="color:${r.css}">${r.name} · ${it.type === 'ring' ? 'prsteň' : 'amulet'}</div>` + it.stats.map(([k, v]) => `<div class="st">${fmtStat(k, v)}</div>`).join('');
  if (ref.bag !== undefined) { // comparison with what it would replace
    const cur = INV.eq[targetSlot(it)], diff = {};
    for (const [k, v] of it.stats) diff[k] = (diff[k] || 0) + v; if (cur) for (const [k, v] of cur.stats) diff[k] = (diff[k] || 0) - v;
    const lines = Object.entries(diff).filter(([, v]) => Math.abs(v) > 0.01).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'dn'}">${v > 0 ? '▲' : '▼'} ${String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',')}${STATS[k].unit} ${STATS[k].name}</span>`);
    html += `<div class="cmp">${cur ? `Namiesto: <span style="color:${RARITY[cur.rarity].css}">${cur.name}</span><br>` : 'Po nasadení:<br>'}${lines.join('<br>')}</div>`;
  }
  tip.innerHTML = html; tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w - 16)) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, y - 10)) + 'px';
}
function hideTip() { $('#tip').style.display = 'none'; }
function toggleInventory(force) {
  G.invOpen = force !== undefined ? force : !G.invOpen;
  $('#inv').classList.toggle('hidden', !G.invOpen); hideTip(); if (G.invOpen) renderInventory();
}
function pulseInvButton() { const b = $('#btn-inv'); b.animate([{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }], { duration: 500 }); }
function initInventoryUI() {
  loadInv(); renderInventory(); renderPurse();
  const inv = $('#inv');
  inv.addEventListener('click', (e) => { const r = itemAt(e.target); if (!r || !r.it) return; if (r.bag !== undefined) equipFromBag(r.bag); else unequip(r.eq); });
  inv.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = itemAt(e.target); if (r && r.it && r.bag !== undefined) discard(r.bag); });
  inv.addEventListener('mousemove', (e) => { const r = itemAt(e.target); if (r && r.it) showTip(r, e.clientX, e.clientY); else hideTip(); });
  inv.addEventListener('mouseleave', hideTip);
  $('#btn-inv').addEventListener('click', () => toggleInventory());
  $('#inv-close').addEventListener('click', () => toggleInventory(false));
}
// =====================================================================================
//  Economy – coins (copper / silver / gold), chest keys and treasure chests
//  1 striebro = 100 medi, 1 zlato = 100 striebra.  Wallet + keys live in the inventory save.
// =====================================================================================
const COIN_S = 100, COIN_Z = 10000;
// monster power: 1 = common, 2 = strong, 3 = mini-boss, 4 = boss (drives coins, keys and XP)
const MON_POWER = { wolf: 1, imp: 1, goblin: 1, archer: 1, cultist: 2, skeleton: 2, alpha: 2, wolfLord: 3, krugKing: 3, scarecrow: 3, boss: 4 };
const COIN_CSS = { z: '#ffd34a', s: '#d8e4ee', m: '#d9824a' };
const coinIco = (k) => `<i class="coin ${k}"></i>`;
/** 12345 → "1 z 23 s 45 m" (html with coin icons, or plain text) */
function fmtCoins(c, html = true) {
  c = Math.max(0, Math.round(c)); const z = Math.floor(c / COIN_Z), s = Math.floor((c % COIN_Z) / COIN_S), m = c % COIN_S, out = [];
  if (z) out.push(html ? `<b>${z}</b>${coinIco('z')}` : `${z} z`);
  if (s) out.push(html ? `<b>${s}</b>${coinIco('s')}` : `${s} s`);
  if (m || !out.length) out.push(html ? `<b>${m}</b>${coinIco('m')}` : `${m} m`);
  return out.join(html ? ' ' : ' ');
}
function addCoins(c) { INV.coins = Math.max(0, (INV.coins | 0) + Math.round(c)); saveInv(); renderPurse(); }
function renderPurse() {
  const h = `<span class="pc">${fmtCoins(INV.coins | 0)}</span><span class="pk" title="Kľúče od truhlíc">${keyIco}<b>${INV.keys | 0}</b></span>`;
  for (const el of document.querySelectorAll('.purse')) el.innerHTML = h;
}
const keyIco = '<svg class="kico" viewBox="0 0 24 24"><circle cx="7" cy="12" r="4.2" fill="none" stroke="#ffd34a" stroke-width="2.4"/><path d="M11 12h11M18 12v4M21 12v3" stroke="#ffd34a" stroke-width="2.4" fill="none"/></svg>';

// ------------------------------------------------------------------ drop tables (higher power = bigger drop, but every part still has to pass its own roll)
const zoneMul = () => 1 + 0.35 * G.zoneIndex;
function rollCoins(power) {
  const T = G.tier, chance = [0, 0.5, 0.68, 1, 1][power] * (1 + 0.04 * G.zoneIndex);
  if (Math.random() > chance) return 0;
  let c = Math.round(rand(3, 9) * Math.pow(power, 1.6) * zoneMul() * tierLoot());
  if (Math.random() < [0, 0.05, 0.14, 0.7, 1][power] * (1 + 0.1 * (T - 1))) c += COIN_S * (power >= 4 ? randInt(4, 9) : power === 3 ? randInt(1, 3) : 1) * Math.round(tierLoot());
  if (Math.random() < [0, 0.002, 0.01, 0.08, 0.4][power] * (1 + 0.15 * (T - 1))) c += COIN_Z * (power >= 4 && Math.random() < 0.25 ? 2 : 1);
  return c;
}
const keyChance = (power) => [0, 0.035, 0.07, 1, 1][power] * (1 + 0.1 * (G.tier - 1));
function rollEconomy(e) {
  const pw = MON_POWER[e.type] || 1, c = rollCoins(pw);
  if (c > 0) dropCoins(c, e.pos.x + randS(0.9), e.pos.z + randS(0.9));
  if (Math.random() < keyChance(pw)) dropKey(e.pos.x + randS(0.9), e.pos.z + randS(0.9));
}

// ------------------------------------------------------------------ world objects: coin piles + keys (share G.drops with items)
const coinMats = {};
function coinMat(k) {
  if (!coinMats[k]) coinMats[k] = new THREE.MeshStandardMaterial({ color: { z: 0xe8b830, s: 0xc8d2dc, m: 0xc06a38 }[k], metalness: 0.95, roughness: 0.28, emissive: { z: 0xffb020, s: 0x9fb8d0, m: 0xa04a18 }[k], emissiveIntensity: 0.45 });
  return coinMats[k];
}
function dropCoins(c, x, z) {
  const k = c >= COIN_Z ? 'z' : c >= COIN_S ? 's' : 'm', g = new THREE.Group(), pile = new THREE.Group(), n = Math.min(9, 2 + Math.round(Math.log2(1 + c / 6)));
  const cg = geo('coin', () => new THREE.CylinderGeometry(0.17, 0.17, 0.045, 14));
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(cg, coinMat(i === 0 || Math.random() < 0.6 ? k : k === 'z' ? 's' : 'm')); m.position.set(randS(0.22), i * 0.04 + (i > 3 ? -0.08 : 0), randS(0.22)); m.rotation.set(randS(0.5), rand(TAU), randS(0.5)); m.castShadow = true; pile.add(m); }
  const gl = mkGlow({ z: 0xffc040, s: 0xbfd8ff, m: 0xff8a40 }[k], k === 'z' ? 1.8 : 1.1, k === 'z' ? 2.4 : 1.6);
  g.add(pile, gl); g.position.set(x, 0, z); dropRoot.add(g);
  G.drops.push({ coin: c, ck: k, g, mesh: pile, x, z, t: 0, mats: [gl.material] });
  if (k === 'z') { flash(x, 1, z, 0xffc040, 3, 0.3); sparks.emit(x, 0.8, z, 0, 4, 0, rgb(0xffd060, 3), 0.8, 0.5, 0, 0.5, 0); }
}
function keyMesh() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xf0c050, metalness: 0.9, roughness: 0.25, emissive: 0xffa020, emissiveIntensity: 0.6 });
  const bow = new THREE.Mesh(geo('kbow', () => new THREE.TorusGeometry(0.17, 0.05, 8, 18)), m); bow.position.y = 0.36;
  const shaft = new THREE.Mesh(geo('kshaft', () => new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8)), m);
  const t1 = new THREE.Mesh(geo('ktooth', () => new THREE.BoxGeometry(0.15, 0.07, 0.05)), m); t1.position.set(0.08, -0.2, 0);
  const t2 = t1.clone(); t2.position.y = -0.08; t2.scale.x = 0.7;
  g.add(bow, shaft, t1, t2); g.userData.mats = [m]; return g;
}
function dropKey(x, z) {
  const g = new THREE.Group(), mesh = keyMesh(), beam = makeBeam(0xffd060, 1.2, 0.5, 4.5);
  const glow = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: TEX.glow, color: hdr(0xffc040, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(2.4, 1, 2.4); glow.position.y = 0.05; glow.renderOrder = 6; g.add(mesh, beam, glow); g.position.set(x, 0, z); dropRoot.add(g);
  const lbl = document.createElement('div'); lbl.className = 'lootlbl key'; lbl.textContent = 'Kľúč od truhlice'; $('#labels').appendChild(lbl);
  G.drops.push({ key: true, g, mesh, beam, glow, lbl, x, z, t: 0, mats: [...mesh.userData.mats, beam.material, glow.material] });
  flash(x, 1, z, 0xffd060, 3, 0.3); sfx('key', { x, z }, 0.6);
}
/** per-frame for coin / key drops; returns true when the drop was picked up (caller removes it) */
function updateEconDrop(d, dt, p, dist) {
  if (d.coin) {
    d.mesh.position.y = Math.max(0, Math.sin(Math.min(1, d.t / 0.4) * Math.PI) * 1.1) + 0.05; d.mesh.rotation.y += dt * 1.5;
    if (d.t > 0.45 && !p.dead && dist < 3.2) { // magnet
      const k = Math.min(1, dt * (5 + (3.2 - dist) * 4)); d.x += (p.pos.x - d.x) * k; d.z += (p.pos.z - d.z) * k; d.g.position.set(d.x, 0, d.z);
    }
    if (d.t > 0.45 && !p.dead && dist < 0.9) {
      addCoins(d.coin); sfx('coins', null, d.ck === 'z' ? 1 : 0.7, d.ck === 'z' ? 2 : d.ck === 's' ? 1 : 0);
      dmgNumber(p.pos.x, 2.4, p.pos.z, '+' + fmtCoins(d.coin, false), 'coin' + d.ck);
      sparks.emit(d.x, 0.6, d.z, 0, 3, 0, rgb(d.ck === 'z' ? 0xffd060 : d.ck === 's' ? 0xdfe8f0 : 0xff9a50, 2.4), 0.5, 0.35, 0, 0.5, 0);
      return true;
    }
    return false;
  }
  // key (small magnet so it is easy to grab)
  if (d.t > 0.6 && !p.dead && dist < 2.6) { const k = Math.min(1, dt * 6); d.x += (p.pos.x - d.x) * k; d.z += (p.pos.z - d.z) * k; d.g.position.set(d.x, 0, d.z); }
  const pop = Math.min(1, d.t / 0.45); d.mesh.position.y = 0.8 + Math.sin(pop * Math.PI) * 1.2 + Math.sin(d.t * 2.4) * 0.09; d.mesh.rotation.y += dt * 2.4;
  d.beam.material.opacity = Math.min(1, d.t * 2) * (0.7 + Math.sin(d.t * 3) * 0.2);
  if (toScreen(d.x, 1.9, d.z, _scr) && dist < 30) { d.lbl.style.display = ''; d.lbl.style.transform = `translate(-50%,-50%) translate(${_scr.x.toFixed(1)}px,${_scr.y.toFixed(1)}px)`; } else d.lbl.style.display = 'none';
  if (Math.random() < dt * 5) sparks.emit(d.x + randS(0.4), 0.2, d.z + randS(0.4), 0, rand(1.5, 4), 0, rgb(0xffd060, 2.2), rand(0.5, 1.1), 0.2, 0, 0.3, 0);
  if (d.t > 0.5 && !p.dead && dist < 1.5) {
    INV.keys = (INV.keys | 0) + 1; saveInv(); renderPurse(); sfx('key', null, 1); toast('Získaný kľúč od truhlice', '#ffd34a');
    flash(d.x, 1, d.z, 0xffd060, 3.5, 0.3); burst(d.x, 0.8, d.z, { n: 16, color: 0xffd060, int: 2.4, up: 2, s0: 2, s1: 8, size: 0.3, l0: 0.3, l1: 0.7 });
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ treasure chests (Blender model maps/chest.glb: nodes "chest_base" + "chest_lid", lid pivots on its hinge)
let chestGLTF = null, chestLoading = null;
function loadChestModel() {
  if (!chestLoading) chestLoading = (async () => {
    for (const url of ['./maps/chest.glb', './chest.glb']) {
      try { const h = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (!h.ok) continue; chestGLTF = await gltfLoader.loadAsync(url); fixMaps(chestGLTF.scene); return chestGLTF; } catch (e) { /* try next */ }
    }
    console.warn('[truhlica] chest.glb sa nenašiel – používam jednoduchý model'); return null;
  })();
  return chestLoading;
}
function fixMaps(root) { root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m && m.map) m.map.anisotropy = 4; if (m && m.metalness > 0.5) m.metalness = 0.5; } }); }
function buildChestFallback() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x6a4024, roughness: 0.85 }), iron = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 0.9), wood); base.position.y = 0.38; g.add(base);
  const lid = new THREE.Group(); lid.position.set(0, 0.75, -0.45); const lm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 12, 1, false, 0, Math.PI), wood); lm.rotation.z = Math.PI / 2; lm.position.z = 0.45; lid.add(lm); g.add(lid);
  for (const x of [-0.5, 0.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.94), iron); b.position.set(x, 0.38, 0); g.add(b); }
  g.userData.lid = lid; return g;
}
function spawnChests(list) {
  G.chests = [];
  for (const c of list || []) {
    let g;
    if (chestGLTF) { g = chestGLTF.scene.clone(true); g.userData.lid = g.getObjectByName('chest_lid'); }
    else g = buildChestFallback();
    g.position.set(c.x, 0, c.z); g.rotation.y = c.rot || 0; g.scale.setScalar(c.scale || 1); actorRoot.add(g);
    const glow = getFlat(TEX.glow, 0xffc040, 0.9); glow.scale.set(3.4, 1, 3.4); glow.position.set(c.x, 0.04, c.z);
    G.chests.push({ g, lid: g.userData.lid, lid0: g.userData.lid ? g.userData.lid.rotation.x : 0, x: c.x, z: c.z, rich: !!c.rich, open: false, t: 0, glow, lbl: null });
    G.zone.circles.push({ x: c.x, z: c.z, r: 0.85 * (c.scale || 1), chest: true });
  }
}
function clearChests() { for (const c of G.chests || []) { actorRoot.remove(c.g); if (c.glow) freeFlat(c.glow); } G.chests = []; }
function nearestChest(maxD = 2.8) { const p = G.player; let best = null, bd = maxD; for (const c of G.chests || []) { if (c.open) continue; const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); if (d < bd) { bd = d; best = c; } } return best; }
function tryOpenChest(c) {
  c = c || nearestChest(); const p = G.player; if (!c || !p || p.dead || G.state !== 'playing') return false;
  if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) > 3.2) return false;
  if ((INV.keys | 0) <= 0) { sfx('deny'); toast('Truhlica je zamknutá – kľúče padajú z príšer', '#ffb070'); return true; }
  INV.keys--; saveInv(); renderPurse(); c.open = true; c.t = 0; sfx('chest', { x: c.x, z: c.z }, 1);
  p.wantFacing = Math.atan2(c.x - p.pos.x, c.z - p.pos.z);
  after(0.45, () => {
    flash(c.x, 1.2, c.z, 0xffd060, 6, 0.4); flashLight(c.x, 1.6, c.z, 0xffc040, 110, 14, 0.8); beamFx(c.x, c.z, 0xffd060, 1.6, 10, 0.7, 2.4);
    burst(c.x, 0.9, c.z, { n: 60, color: 0xffd060, color2: 0xffffff, int: 3, up: 3, s0: 3, s1: 11, size: 0.32, l0: 0.4, l1: 1.0, r: 0.5, grav: 6 });
    const lvl = G.zoneIndex + 1 + (G.tier - 1), n = c.rich ? 3 : 2;
    for (let i = 0; i < n; i++) after(0.12 * i, () => dropItem(makeItem(lvl, undefined, 1), c.x + Math.sin(c.g.rotation.y + randS(1.2)) * rand(1.6, 2.6), c.z + Math.cos(c.g.rotation.y + randS(1.2)) * rand(1.6, 2.6)));
    const coins = Math.round((rand(1, 2.5) * COIN_S * (c.rich ? 2 : 1) + rand(10, 60)) * zoneMul() * tierLoot());
    for (let i = 0; i < 3; i++) after(0.1 + i * 0.1, () => dropCoins(Math.round(coins / 3), c.x + randS(1.6), c.z + randS(1.6)));
    if (Math.random() < 0.08 * tierLoot()) after(0.4, () => dropCoins(COIN_Z, c.x + randS(1.2), c.z + randS(1.2)));
    if (Math.random() < 0.15) after(0.5, () => dropKey(c.x + randS(1.4), c.z + randS(1.4)));
  });
  return true;
}
function updateRegions() {
  const p = G.player, R = G.zone && G.zone.env.regions; if (!R || !p || p.dead) return;
  for (const r of R) if (!G.regionSeen[r.name] && p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1) { G.regionSeen[r.name] = true; banner(r.name, r.sub); sfx('portal', null, 0.4); }
}
function updateChests(dt) {
  updateRegions();
  const p = G.player; let near = null;
  for (const c of G.chests || []) {
    if (c.open) {
      c.t += dt; if (c.lid) c.lid.rotation.x = c.lid0 - easeOut(Math.min(1, c.t / 0.55)) * 1.9;
      if (c.glow) { c.glow.material.opacity = Math.max(0, 1 - c.t / 1.5); if (c.t > 1.5) { freeFlat(c.glow); c.glow = null; } }
      if (c.t < 2.5 && Math.random() < dt * 25) sparks.emit(c.x + randS(0.5), 0.9, c.z + randS(0.4), 0, rand(1.5, 3.5), 0, rgb(0xffd060, 2.4), rand(0.4, 0.9), 0.2, 0, 0.3, 0);
      continue;
    }
    if (c.glow) c.glow.material.opacity = 0.55 + Math.sin(G.time * 3 + c.x) * 0.2;
    if (Math.random() < dt * 3) sparks.emit(c.x + randS(0.7), 0.3, c.z + randS(0.5), 0, rand(1, 2.5), 0, rgb(0xffc040, 2), rand(0.5, 1), 0.18, 0, 0.3, 0);
    if (p && !p.dead && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 3) near = c;
  }
  G.nearChest = near;
}
// =====================================================================================
//  Zones – Divočina, Dungeon (krypta), Boss Room (Dračia svätyňa); collisions; portal
// =====================================================================================
function srng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** seamless tiling texture: the drawing is repeated in all 9 neighbouring cells with the same seed */
function tileTex(size, bg, seed, draw, srgb = true) {
  const t = canvasTex(size, (x, s) => { x.fillStyle = bg; x.fillRect(0, 0, s, s); for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { x.save(); x.translate(ox, oy); draw(x, s, srng(seed)); x.restore(); } }, srgb);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
TEX.grass = tileTex(512, '#26401d', 7, (x, s, r) => {
  const pal = ['#1f3818', '#2e4d22', '#35552a', '#223c1a', '#3a5a26', '#2a3f1c'];
  for (let i = 0; i < 220; i++) { const cx = r() * s, cy = r() * s, rr = 10 + r() * 46, g = x.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, pal[(r() * pal.length) | 0] + 'aa'); g.addColorStop(1, pal[0] + '00'); x.fillStyle = g; x.fillRect(cx - rr, cy - rr, rr * 2, rr * 2); }
  x.lineCap = 'round';
  for (let i = 0; i < 2600; i++) { const cx = r() * s, cy = r() * s, l = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 1.1; x.strokeStyle = r() < 0.5 ? `rgba(80,120,50,${0.25 + r() * 0.35})` : `rgba(12,26,10,${0.25 + r() * 0.3})`; x.lineWidth = 1 + r(); x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.stroke(); }
  for (let i = 0; i < 70; i++) { x.fillStyle = r() < 0.5 ? 'rgba(90,80,60,.5)' : 'rgba(40,36,30,.5)'; x.beginPath(); x.arc(r() * s, r() * s, 1 + r() * 2.5, 0, TAU); x.fill(); }
});
TEX.dirt = canvasTex(256, (x, s) => {
  const r = srng(3), c = s / 2, g = x.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(92,72,50,.95)'); g.addColorStop(0.55, 'rgba(80,62,44,.8)'); g.addColorStop(1, 'rgba(70,55,40,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * c * 0.8; x.fillStyle = r() < 0.5 ? 'rgba(130,108,80,.5)' : 'rgba(40,30,22,.45)'; x.beginPath(); x.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1 + r() * 3.5, 0, TAU); x.fill(); }
});
TEX.stone = tileTex(512, '#3a3631', 11, (x, s, r) => {
  const n = 4, w = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 46 + r() * 26, px = i * w, py = j * w; x.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`; x.fillRect(px + 3, py + 3, w - 6, w - 6);
    for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,240,220' : '0,0,0'},${0.04 + r() * 0.06})`; x.beginPath(); x.arc(px + 6 + r() * (w - 12), py + 6 + r() * (w - 12), 2 + r() * 9, 0, TAU); x.fill(); }
    x.fillStyle = 'rgba(255,240,215,.08)'; x.fillRect(px + 3, py + 3, w - 6, 3); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(px + 3, py + w - 6, w - 6, 3);
    if (r() < 0.45) { x.strokeStyle = 'rgba(10,8,6,.6)'; x.lineWidth = 1.5; x.beginPath(); let cx = px + r() * w, cy = py + r() * w; x.moveTo(cx, cy); for (let k = 0; k < 5; k++) { cx += (r() - 0.5) * 40; cy += (r() - 0.5) * 40; x.lineTo(cx, cy); } x.stroke(); }
    if (r() < 0.25) for (let k = 0; k < 30; k++) { x.fillStyle = `rgba(60,90,40,${0.2 + r() * 0.3})`; x.beginPath(); x.arc(px + r() * w, py + (r() < 0.5 ? 4 : w - 4) + (r() - 0.5) * 8, 1 + r() * 3, 0, TAU); x.fill(); }
  }
});
TEX.brick = tileTex(256, '#1e1b18', 21, (x, s, r) => {
  const rows = 6, h = s / rows;
  for (let j = 0; j < rows; j++) { let px = j % 2 ? -h * 0.9 : 0; while (px < s) { const w = h * (1.4 + r() * 1.2), v = 52 + r() * 30; x.fillStyle = `rgb(${v},${v - 4},${v - 10})`; x.fillRect(px + 2, j * h + 2, w - 4, h - 4); x.fillStyle = 'rgba(255,235,210,.07)'; x.fillRect(px + 2, j * h + 2, w - 4, 2); px += w; } }
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`; x.beginPath(); x.arc(r() * s, r() * s, 1 + r() * 4, 0, TAU); x.fill(); }
});
TEX.obsidian = tileTex(512, '#151012', 31, (x, s, r) => {
  for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '70,40,50' : '0,0,0'},${0.15 + r() * 0.25})`; x.beginPath(); const cx = r() * s, cy = r() * s; x.moveTo(cx, cy); for (let k = 0; k < 5; k++) x.lineTo(cx + (r() - 0.5) * 120, cy + (r() - 0.5) * 120); x.closePath(); x.fill(); }
});
TEX.lavaCracks = tileTex(512, '#000', 41, (x, s, r) => {
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (let i = 0; i < 14; i++) {
    let px = r() * s, py = r() * s, a = r() * TAU; const pts = [[px, py]];
    for (let j = 0; j < 9; j++) { a += (r() - 0.5) * 1.6; px += Math.cos(a) * (14 + r() * 26); py += Math.sin(a) * (14 + r() * 26); pts.push([px, py]); }
    for (const [w, c] of [[9, 'rgba(255,60,0,.35)'], [4, 'rgba(255,110,20,.9)'], [1.6, 'rgba(255,230,150,1)']]) { x.strokeStyle = c; x.lineWidth = w * (0.6 + r() * 0.0 + (i % 3) * 0.25); x.beginPath(); pts.forEach(([u, v], k) => (k ? x.lineTo(u, v) : x.moveTo(u, v))); x.stroke(); }
  }
});
TEX.runeBand = canvasTex(512, (x, s) => {
  x.fillStyle = '#000'; x.fillRect(0, 0, s, s); x.strokeStyle = '#fff'; x.lineWidth = 9; x.lineCap = 'round'; const r = srng(5);
  for (let i = 0; i < 8; i++) { const cx = i * 64 + 32; x.beginPath(); for (let k = 0; k < 3; k++) { x.moveTo(cx + (r() - 0.5) * 34, 180 + r() * 40); x.lineTo(cx + (r() - 0.5) * 34, 300 + r() * 40); } x.moveTo(cx - 18, 250 + (r() - 0.5) * 60); x.lineTo(cx + 18, 250 + (r() - 0.5) * 60); x.stroke(); }
  x.lineWidth = 5; x.beginPath(); x.moveTo(0, 150); x.lineTo(s, 150); x.moveTo(0, 362); x.lineTo(s, 362); x.stroke();
});

// ------------------------------------------------------------------ occlusion: dithered see-through cylinder from the camera to the hero
const OCC = { uOccCam: { value: new V3() }, uOccPlayer: { value: new V3() }, uOccR: { value: 2.6 }, uOccOn: { value: 0 } };
function occluder(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, OCC);
    sh.vertexShader = 'varying vec3 vOccWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 occP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        occP = instanceMatrix * occP;
      #endif
      vOccWorld = (modelMatrix * occP).xyz;`);
    sh.fragmentShader = 'varying vec3 vOccWorld; uniform vec3 uOccCam; uniform vec3 uOccPlayer; uniform float uOccR; uniform float uOccOn;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uOccOn > 0.5) {
        vec3 pa = vOccWorld - uOccCam, ba = uOccPlayer - uOccCam; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h); float k = (1.0 - smoothstep(uOccR * 0.45, uOccR, d)) * (1.0 - smoothstep(0.92, 1.0, h)) * 0.86;
        float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        if (k > n) discard;
      }`);
  };
  mat.customProgramCacheKey = () => 'occ';
  return mat;
}

// ------------------------------------------------------------------ collisions (circles, boxes, outer bounds)
function collide(pos, r) {
  const Z = G.zone; if (!Z) return;
  for (const c of Z.circles) { const dx = pos.x - c.x, dz = pos.z - c.z, m = c.r + r, d2 = dx * dx + dz * dz; if (d2 < m * m) { const d = Math.sqrt(d2) || 1e-3; pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; } }
  for (const b of Z.boxes) {
    const cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1), dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
      else { const l = pos.x - b.x0, rr = b.x1 - pos.x, t = pos.z - b.z0, bt = b.z1 - pos.z, m = Math.min(l, rr, t, bt); if (m === l) pos.x = b.x0 - r; else if (m === rr) pos.x = b.x1 + r; else if (m === t) pos.z = b.z0 - r; else pos.z = b.z1 + r; }
    }
  }
  const B = Z.bounds;
  if (B.areas) clampAreas(pos, r, B.areas);
  else if (B.r) { const d = Math.hypot(pos.x, pos.z), m = B.r - r; if (d > m) { pos.x *= m / d; pos.z *= m / d; } }
  else { pos.x = clamp(pos.x, B.x0 + r, B.x1 - r); pos.z = clamp(pos.z, B.z0 + r, B.z1 - r); }
}
function inAreas(x, z, r, A) { for (const a of A) if (x >= a.x0 + r && x <= a.x1 - r && z >= a.z0 + r && z <= a.z1 - r) return true; return false; }
function clampAreas(pos, r, A) {
  if (inAreas(pos.x, pos.z, r, A)) return;
  let bx = pos.x, bz = pos.z, bd = 1e18;
  for (const a of A) { const cx = clamp(pos.x, a.x0 + r, a.x1 - r), cz = clamp(pos.z, a.z0 + r, a.z1 - r), d = (cx - pos.x) ** 2 + (cz - pos.z) ** 2; if (d < bd) { bd = d; bx = cx; bz = cz; } }
  pos.x = bx; pos.z = bz;
}
function isBlocked(x, z, r) {
  const Z = G.zone; if (!Z) return false; const B = Z.bounds;
  if (B.areas ? !inAreas(x, z, r, B.areas) : B.r ? Math.hypot(x, z) > B.r - r : x < B.x0 + r || x > B.x1 - r || z < B.z0 + r || z > B.z1 - r) return true;
  for (const c of Z.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true;
  for (const b of Z.boxes) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
  return false;
}

// ------------------------------------------------------------------ shared lights for torches / pillars (assigned to the nearest sources every frame)
const torchLights = [];
for (let i = 0; i < 6; i++) { const L = new THREE.PointLight(0xff8a3a, 0, 15, 1.6); L.shadow.mapSize.set(512, 512); L.shadow.camera.near = 0.3; L.shadow.camera.far = 16; L.shadow.bias = -0.004; L.visible = false; scene.add(L); torchLights.push(L); }
const portalLight = new THREE.PointLight(0x8f7bff, 0, 18, 1.6); scene.add(portalLight);

// ------------------------------------------------------------------ helpers for building environments
const stdMat = (o) => occluder(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02, flatShading: true, ...o }));
function addMesh(parent, geom, mat, x, y, z, o = {}) {
  const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); if (o.ry) m.rotation.y = o.ry; if (o.s) m.scale.setScalar(o.s);
  m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false; parent.add(m); return m;
}
function instanced(parent, geom, mat, list, o = {}) {
  const im = new THREE.InstancedMesh(geom, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), col = new THREE.Color();
  list.forEach((it, i) => { e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e); sc.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1); m4.compose(new V3(it.x, it.y || 0, it.z), q, sc); im.setMatrixAt(i, m4); if (it.c !== undefined) im.setColorAt(i, col.setHex(it.c)); });
  im.castShadow = o.cast !== false; im.receiveShadow = o.receive !== false; parent.add(im); return im;
}
/** vertex-coloured by facing: tops get the "moss" colour */
function mossy(g, top, side) {
  g = g.toNonIndexed(); g.computeVertexNormals(); const n = g.attributes.normal, cols = [], a = new THREE.Color(top), b = new THREE.Color(side), c = new THREE.Color();
  for (let i = 0; i < n.count; i++) { c.copy(b).lerp(a, smooth(clamp((n.getY(i) - 0.25) / 0.6, 0, 1))); cols.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); return g;
}
function makeGround(w, h, mat, seg = 1) { const g = new THREE.PlaneGeometry(w, h, seg, seg).rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m; }
function flameSprite(color, size) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: hdr(color, 2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.scale.setScalar(size); return s; }

// ------------------------------------------------------------------ portal
function buildPortal(color, stones = true) {
  const g = new THREE.Group(), inner = new THREE.Group(); inner.position.y = 2.75; g.add(inner);
  inner.add(new THREE.Mesh(geo('ptorus', () => new THREE.TorusGeometry(2.35, 0.2, 10, 56)), new THREE.MeshBasicMaterial({ color: hdr(color, 2.8) })));
  const swirl = new THREE.Mesh(geo('pdisc', () => new THREE.CircleGeometry(2.2, 56)), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: hdr(color, 1.4) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 p=vUv-0.5; float r=length(p)*2.0, a=atan(p.y,p.x);
        float s=sin(a*3.0+r*11.0-uTime*4.0)*0.5+0.5, s2=sin(a*5.0-r*15.0+uTime*2.6)*0.5+0.5;
        vec3 col=uColor*(0.5+1.8*s*s2)+vec3(1.0,0.95,1.0)*pow(max(0.0,1.0-r),3.0)*2.2;
        float al=(1.0-smoothstep(0.82,1.0,r))*(0.5+0.5*s); gl_FragColor=vec4(col*al,al); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  inner.add(swirl);
  const glow = flameSprite(color, 9); glow.material.opacity = 0.55; inner.add(glow);
  const rune = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: TEX.rune, color: hdr(color, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  rune.scale.set(8, 1, 8); rune.position.y = 0.06; rune.renderOrder = 6; g.add(rune);
  if (stones) for (const s of [-1, 1]) { const st = addMesh(g, boxG(0.9, 5.6, 0.9), stdMat({ color: 0x3a3a40 }), s * 2.95, 2.8, 0); st.rotation.z = s * 0.04; addMesh(g, boxG(1.3, 0.5, 1.3), stdMat({ color: 0x2a2a30 }), s * 2.95, 0.25, 0); }
  g.userData = { swirl, rune, inner, color };
  g.visible = false; return g;
}
function openPortal() {
  const Z = G.zone; if (!Z || !Z.def.next || Z.portalOpen || G.state !== 'playing') return;
  Z.portalOpen = true; Z.portalT = 0; Z.portal.visible = true;
  const { x, z } = Z.portalPos;
  sfx('portal', { x, z });
  after(0.35, () => { banner(Z.def.portalTitle || 'Portál sa otvoril', Z.def.portalSub || 'Cesta vedie ďalej'); shake(0.4); flash(x, 3, z, Z.def.portalColor, 14, 0.5); ringFx(x, z, { color: Z.def.portalColor, r0: 1, r1: 12, dur: 0.7, int: 3 }); burst(x, 2.6, z, { n: 80, color: Z.def.portalColor, color2: 0xffffff, int: 3, s0: 3, s1: 14, size: 0.4, l0: 0.4, l1: 1.0 }); });
  updateObjective();
}

// ------------------------------------------------------------------ zone definitions
const ZONES = [
  { id: 'wild', title: 'Divočina', sub: 'Temný hvozd', next: 1, portalColor: 0x8f7bff,
    start: [0, 46], portalPos: [0, -47], bounds: { x0: -36, x1: 36, z0: -53, z1: 52 },
    bg: 0x0e1812, fog: [0x14201a, 42, 98], hemi: [0xbcd6ff, 0x2a3a1a, 1.3], sun: [0xffe0b0, 2.9], exposure: 1.12, motes: 'fireflies',
    packs: [[8, 28, ['wolf', 'wolf', 'wolf']], [-12, 14, ['goblin', 'goblin', 'goblin', 'archer']], [11, -2, ['archer', 'archer', 'wolf', 'wolf']], [-10, -17, ['goblin', 'goblin', 'goblin', 'wolf', 'wolf']], [8, -31, ['archer', 'archer', 'goblin', 'goblin', 'wolf', 'wolf']]],
    build: buildWild },
  { id: 'crypt', title: 'Dungeon', sub: 'Zabudnutá krypta', next: 2, portalColor: 0xff5a20,
    start: [0, 46], portalPos: [0, -51], bounds: { x0: -17, x1: 17, z0: -56, z1: 52 },
    bg: 0x050405, fog: [0x0a0807, 34, 80], hemi: [0x8a94b0, 0x2a1c12, 1.15], sun: [0x9aaad0, 1.25], exposure: 1.2, motes: 'dust', torches: true,
    packs: [[0, 32, ['skeleton', 'skeleton', 'cultist']], [-7, 9, ['skeleton', 'skeleton']], [7, -1, ['cultist', 'cultist', 'skeleton']], [0, -28, ['skeleton', 'skeleton', 'skeleton', 'cultist', 'cultist']], [-9, -44, ['cultist']], [9, -44, ['cultist']]],
    build: buildCrypt },
  { id: 'sanctum', title: 'Boss Room', sub: 'Dračia svätyňa', next: 3, portalColor: 0xffc870, portalPos: [0, 7], portalTitle: 'Brána do mesta', portalSub: 'Útočisko Draheim ťa očakáva',
    start: [0, 23], bounds: { r: 29.4 },
    camDist: 34, bg: 0x0a0303, fog: [0x1c0705, 46, 110], hemi: [0x9a6a5c, 0x3a1406, 1.25], sun: [0xffb080, 2.0], exposure: 1.1, motes: 'embers', torches: true,
    boss: [0, -6], packs: [],
    build: buildSanctum },
  { id: 'town', title: 'Mesto', sub: 'Útočisko Draheim', next: null, safe: true,
    start: [0, 16], bounds: { x0: -34, x1: 34, z0: -34, z1: 34 }, lobby: [[-3.4, -12.6], [0, -13.2], [3.4, -12.6]], waypoint: [9.5, 4.5], merchant: [-5.5, -8.6, 0.6],
    camDist: 26, bg: 0x1b2032, fog: [0x262a3c, 48, 115], hemi: [0x9ab0e0, 0x3a2a1a, 1.25], sun: [0xffb070, 2.4], exposure: 1.1, motes: 'fireflies', torches: true,
    packs: [], build: buildTownFallback },
];
const TOWN_ZONE = 3;
/** minimal stand-in town, used only if maps/town.glb is missing */
function buildTownFallback() {
  const E = newEnv(), g = E.group;
  const ground = makeGround(80, 80, new THREE.MeshStandardMaterial({ color: 0x5a564e, roughness: 1 })); g.add(ground);
  addMesh(g, new THREE.CylinderGeometry(3.6, 3.7, 0.8, 32), new THREE.MeshStandardMaterial({ color: 0x8a8478 }), 0, 0.4, 0); E.circles.push({ x: 0, z: 0, r: 3.8 });
  addMesh(g, new THREE.CylinderGeometry(0.5, 0.75, 5, 4), new THREE.MeshStandardMaterial({ color: 0x5a5a66, emissive: 0x2050a0, emissiveIntensity: 0.6 }), 9.5, 2.5, 4.5); E.circles.push({ x: 9.5, z: 4.5, r: 1.6 });
  E.torches.push({ x: 9.5, y: 2.5, z: 4.5, color: 0x5ab0ff, int: 45, ph: 0, steady: true });
  return E;
}

function newEnv() { return { group: new THREE.Group(), circles: [], boxes: [], torches: [], update: null }; }

function buildWild(Z) {
  const E = newEnv(), g = E.group, R = srng(1234), rr = (a, b) => a + R() * (b - a);
  // ground with large-scale colour variation
  const gm = new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1, vertexColors: true }); TEX.grass.repeat.set(22, 22);
  const ground = makeGround(240, 240, gm, 70), pos = ground.geometry.attributes.position, cols = [];
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), n = Math.sin(x * 0.07) * Math.cos(z * 0.06) + Math.sin(x * 0.17 + z * 0.13) * 0.5, k = 0.78 + n * 0.14; cols.push(k * 1.02, k, k * 0.92); }
  ground.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.add(ground);
  // dirt path
  const path = [[0, 56], [4, 32], [-6, 12], [3, -8], [-4, -28], [0, -50]];
  const dirtMat = new THREE.MeshLambertMaterial({ map: TEX.dirt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const distToPath = (x, z) => { let best = 1e9; for (let i = 0; i < path.length - 1; i++) { const [ax, az] = path[i], [bx, bz] = path[i + 1], dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return best; };
  for (let i = 0; i < path.length - 1; i++) { const [ax, az] = path[i], [bx, bz] = path[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2.6);
    for (let k = 0; k < n; k++) { const t = k / n, m = new THREE.Mesh(flatGeo, dirtMat); m.position.set(lerp(ax, bx, t) + rr(-0.8, 0.8), 0.02 + (k % 5) * 0.002, lerp(az, bz, t) + rr(-0.8, 0.8)); const s = rr(5.5, 8); m.scale.set(s, 1, s * rr(0.8, 1.2)); m.rotation.y = rr(0, TAU); m.receiveShadow = true; m.renderOrder = 1; g.add(m); } }
  for (const [px, pz] of Z.def.packs) { const m = new THREE.Mesh(flatGeo, dirtMat); m.position.set(px, 0.018, pz); m.scale.set(11, 1, 11); m.rotation.y = rr(0, TAU); m.receiveShadow = true; g.add(m); }
  // trees (instanced pines + broadleaves)
  const clear = (x, z, pad = 0) => distToPath(x, z) > 6 + pad && Z.def.packs.every(([px, pz]) => Math.hypot(x - px, z - pz) > 7 + pad) && Math.hypot(x - Z.def.start[0], z - Z.def.start[1]) > 8 && Math.hypot(x - Z.def.portalPos[0], z - Z.def.portalPos[1]) > 10;
  const pines = [], oaks = [];
  const place = (x, z, inside) => { const s = inside ? rr(0.7, 1.1) : rr(0.85, 1.4), t = { x, z, s, ry: rr(0, TAU) }; (R() < 0.62 ? pines : oaks).push(t); if (inside) E.circles.push({ x, z, r: 0.55 * s }); };
  for (let i = 0; i < 1400 && pines.length + oaks.length < 120; i++) { const x = rr(-34, 34), z = rr(-51, 50); if (clear(x, z) && [...pines, ...oaks].every((t) => Math.hypot(t.x - x, t.z - z) > 4.2)) place(x, z, true); }
  for (let i = 0; i < 900; i++) { const x = rr(-70, 70), z = rr(-80, 80); if (Math.abs(x) > 37 || z < -54 || z > 53) { if (Math.hypot(x, z - 60) < 10) continue; place(x, z, false); } }
  const trunkG = new THREE.CylinderGeometry(0.22, 0.38, 2.6, 6).translate(0, 1.3, 0);
  const pineG = mergeGeometries([new THREE.ConeGeometry(2.3, 3.2, 7).translate(0, 3.0, 0), new THREE.ConeGeometry(1.8, 2.7, 7).translate(0, 4.5, 0), new THREE.ConeGeometry(1.2, 2.3, 7).translate(0, 5.8, 0)]);
  const oakG = mergeGeometries([new THREE.IcosahedronGeometry(2.0, 0).translate(0, 3.9, 0), new THREE.IcosahedronGeometry(1.5, 0).translate(1.1, 3.3, 0.5), new THREE.IcosahedronGeometry(1.4, 0).translate(-1.0, 4.4, -0.4)]);
  const trunkM = occluder(new THREE.MeshLambertMaterial({ color: 0x4a3626, flatShading: true }));
  const leafM = occluder(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  const all = [...pines, ...oaks];
  instanced(g, trunkG, trunkM, all);
  instanced(g, pineG, leafM, pines.map((t) => ({ ...t, c: pick([0x1f4a2a, 0x24532c, 0x1a3f26, 0x2a5a30]) })));
  instanced(g, oakG, leafM, oaks.map((t) => ({ ...t, c: pick([0x3a5a24, 0x456a2a, 0x2f5020, 0x52702e]) })));
  // mossy rocks
  const rockG = mossy(new THREE.DodecahedronGeometry(1, 0), 0x4a6a2e, 0x5a5a56), rocks = [];
  for (let i = 0; i < 400 && rocks.length < 46; i++) { const x = rr(-34, 34), z = rr(-51, 50); if (!clear(x, z, -2)) continue; const s = rr(0.5, 1.5); rocks.push({ x, z, y: s * 0.25, s, sx: s * rr(1, 1.5), sy: s * rr(0.6, 0.9), ry: rr(0, TAU), rx: rr(-0.3, 0.3) }); if (s > 0.9) E.circles.push({ x, z, r: s * 1.05 }); }
  instanced(g, rockG, occluder(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })), rocks);
  // fallen logs
  for (let i = 0; i < 6; i++) { let x, z, k = 0; do { x = rr(-30, 30); z = rr(-45, 44); } while (!clear(x, z, -1) && ++k < 50); const ry = rr(0, TAU), L = rr(3.5, 5.5);
    const log = addMesh(g, new THREE.CylinderGeometry(0.42, 0.5, L, 7).rotateZ(Math.PI / 2), trunkM, x, 0.4, z, { ry }); log.rotation.x = rr(-0.1, 0.1);
    for (let t = -0.35; t <= 0.36; t += 0.35) E.circles.push({ x: x + Math.cos(ry) * L * t, z: z - Math.sin(ry) * L * t, r: 0.6 }); }
  // grass tufts, flowers, glowing mushrooms
  const tuftG = mergeGeometries([new THREE.ConeGeometry(0.08, 0.7, 3).translate(0, 0.35, 0), new THREE.ConeGeometry(0.07, 0.55, 3).rotateZ(0.3).translate(0.12, 0.26, 0), new THREE.ConeGeometry(0.07, 0.6, 3).rotateZ(-0.35).translate(-0.12, 0.28, 0.05)]);
  const tufts = []; for (let i = 0; i < 1100; i++) { const x = rr(-40, 40), z = rr(-56, 56); if (distToPath(x, z) < 2.2) continue; tufts.push({ x, z, s: rr(0.7, 1.6), ry: rr(0, TAU), c: pick([0x3d6a2a, 0x4a7a30, 0x5a8a36, 0x35602a, 0x6a7a30]) }); }
  instanced(g, tuftG, new THREE.MeshLambertMaterial({ color: 0xffffff }), tufts, { cast: false });
  const flowers = []; for (let i = 0; i < 160; i++) { const x = rr(-36, 36), z = rr(-52, 52); if (distToPath(x, z) < 3) continue; flowers.push({ x, y: 0.35, z, s: rr(0.6, 1), c: pick([0xb070ff, 0xffd060, 0xff8aa0, 0x8ab0ff]) }); }
  instanced(g, geo('flower', () => new THREE.IcosahedronGeometry(0.12, 0)), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x221133 }), flowers, { cast: false });
  const mush = []; for (const t of all) if (Math.abs(t.x) < 38 && R() < 0.3) for (let k = 0; k < 3; k++) mush.push({ x: t.x + rr(-1.4, 1.4), y: 0, z: t.z + rr(-1.4, 1.4), s: rr(0.6, 1.2) });
  instanced(g, mergeGeometries([new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5).translate(0, 0.15, 0), new THREE.SphereGeometry(0.16, 7, 4, 0, TAU, 0, Math.PI / 2).translate(0, 0.28, 0)]), new THREE.MeshBasicMaterial({ color: hdr(0x40ffd8, 1.6) }), mush, { cast: false });
  // circle of standing stones around the portal
  const [px, pz] = Z.def.portalPos, stoneM = stdMat({ color: 0x55585e });
  for (let i = 0; i < 9; i++) { const a = Math.PI * 0.5 + (i / 9) * TAU + 0.35, x = px + Math.cos(a) * 7.5, z = pz + Math.sin(a) * 7.5; if (z > pz + 5) continue; const h = rr(2.6, 4.2); const st = addMesh(g, boxG(1.1, 1, 0.8), stoneM, x, h / 2, z, { ry: -a }); st.scale.y = h; st.rotation.z = rr(-0.08, 0.08); E.circles.push({ x, z, r: 0.85 }); }
  // warm sun shafts are suggested by the bloom; fireflies via motes
  return E;
}

function buildCrypt(Z) {
  const E = newEnv(), g = E.group, R = srng(77), rr = (a, b) => a + R() * (b - a);
  const floorM = new THREE.MeshStandardMaterial({ map: TEX.stone.clone(), roughness: 0.85, metalness: 0.05 }); floorM.map.repeat.set(36 / 8, 116 / 8); floorM.map.needsUpdate = true;
  const floor = makeGround(36, 116, floorM); floor.position.z = -2; g.add(floor);
  const outside = makeGround(200, 220, new THREE.MeshLambertMaterial({ color: 0x050404 })); outside.position.y = -0.02; g.add(outside);
  const wallMat = (len, h) => { const m = stdMat({ map: TEX.brick.clone(), color: 0xb8aa98, roughness: 0.95, flatShading: false }); m.map.repeat.set(len / 4, h / 4); m.map.needsUpdate = true; return m; };
  const wall = (x0, x1, z0, z1, h) => { const w = x1 - x0, d = z1 - z0; addMesh(g, new THREE.BoxGeometry(w, h, d), wallMat(Math.max(w, d), h), (x0 + x1) / 2, h / 2, (z0 + z1) / 2); E.boxes.push({ x0, x1, z0, z1 });
    addMesh(g, new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), stdMat({ color: 0x2c2824 }), (x0 + x1) / 2, h + 0.17, (z0 + z1) / 2); };
  wall(-19.5, -17, -58, 54, 5.2); wall(17, 19.5, -58, 54, 5.2); wall(-19.5, 19.5, -60, -56, 6.5); wall(-19.5, 19.5, 52, 54.5, 2.2);
  for (const z of [22, -14]) { wall(-17, -4, z - 0.7, z + 0.7, 3.8); wall(4, 17, z - 0.7, z + 0.7, 3.8);
    const archM = stdMat({ color: 0x4a4440 }); addMesh(g, boxG(1.2, 4.6, 1.8), archM, -4.6, 2.3, z); addMesh(g, boxG(1.2, 4.6, 1.8), archM, 4.6, 2.3, z); addMesh(g, boxG(10.4, 0.9, 1.8), archM, 0, 4.9, z); }
  // pillars
  const pilM = stdMat({ map: TEX.brick.clone(), color: 0xa89a88 }); pilM.map.repeat.set(1.5, 2); pilM.map.needsUpdate = true; const capM = stdMat({ color: 0x3a3430 });
  const pillar = (x, z) => { addMesh(g, geo('pil', () => new THREE.CylinderGeometry(0.85, 0.95, 5.6, 8)), pilM, x, 2.8, z); addMesh(g, boxG(2.1, 0.5, 2.1), capM, x, 0.25, z); addMesh(g, boxG(2.0, 0.45, 2.0), capM, x, 5.5, z); E.circles.push({ x, z, r: 1.1 }); };
  for (const z of [44, 31, 13, 2, -8, -24, -36, -46]) { pillar(-10.5, z); pillar(10.5, z); }
  // sarcophagi, altar, rubble, bones, candles
  const tombM = stdMat({ color: 0x6a6460 }), lidM = stdMat({ color: 0x7a746c });
  const tomb = (x, z, ry = 0) => { const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = ry; g.add(t); addMesh(t, boxG(2.2, 1.1, 4.2), tombM, 0, 0.55, 0); addMesh(t, boxG(2.5, 0.35, 4.5), lidM, 0, 1.25, 0); addMesh(t, boxG(0.9, 0.25, 0.9), lidM, 0, 1.5, -1.4);
    const hw = ry ? 2.25 : 1.25, hd = ry ? 1.25 : 2.25; E.boxes.push({ x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd }); };
  tomb(-5, 40); tomb(5, 40); tomb(0, 4); tomb(-13.8, -2, Math.PI / 2); tomb(13.8, 8, Math.PI / 2); tomb(-13.8, -40, Math.PI / 2);
  const altar = new THREE.Group(); altar.position.set(0, 0, -41); g.add(altar); addMesh(altar, boxG(5, 0.6, 3), capM, 0, 0.3, 0); addMesh(altar, boxG(3.4, 1.3, 1.6), tombM, 0, 1.25, 0);
  const altarFire = flameSprite(0xff3a80, 3.2); altarFire.position.set(0, 2.5, -41); g.add(altarFire); E.boxes.push({ x0: -2.5, x1: 2.5, z0: -42.5, z1: -39.5 });
  const rub = []; for (let i = 0; i < 70; i++) { const x = R() < 0.5 ? rr(-16.5, -12) : rr(12, 16.5), z = rr(-54, 50); rub.push({ x, z, y: 0.1, s: rr(0.2, 0.6), ry: rr(0, TAU), rx: rr(0, 1) }); }
  instanced(g, mossy(new THREE.DodecahedronGeometry(1, 0), 0x6a6458, 0x4a4640), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), rub);
  const bones = []; for (let i = 0; i < 90; i++) bones.push({ x: rr(-16, 16), y: 0.06, z: rr(-54, 50), sx: 1, sy: 1, sz: rr(0.5, 1.4), ry: rr(0, TAU) });
  instanced(g, boxG(0.09, 0.09, 0.6), new THREE.MeshLambertMaterial({ color: 0xcfc6b0 }), bones, { cast: false });
  const skulls = []; for (let i = 0; i < 26; i++) skulls.push({ x: R() < 0.5 ? rr(-16.4, -14) : rr(14, 16.4), y: 0.16, z: rr(-54, 50), s: rr(0.8, 1.2), ry: rr(0, TAU) });
  instanced(g, geo('skull', () => new THREE.IcosahedronGeometry(0.2, 0)), new THREE.MeshLambertMaterial({ color: 0xd8d0bc, flatShading: true }), skulls);
  // wall torches
  const bracketM = new THREE.MeshLambertMaterial({ color: 0x2a2420 }), flames = [];
  const torch = (x, z, nx, nz) => { const y = 3.0; addMesh(g, boxG(0.25, 0.8, 0.25), bracketM, x + nx * 0.25, y - 0.3, z + nz * 0.25, { cast: false }); const f = flameSprite(0xff8a30, 1.6), f2 = flameSprite(0xffe0a0, 0.7); f.position.set(x + nx * 0.4, y + 0.35, z + nz * 0.4); f2.position.copy(f.position); g.add(f, f2); flames.push({ f, f2, ph: rr(0, 10) }); E.torches.push({ x: x + nx * 0.9, y: y + 0.4, z: z + nz * 0.9, color: 0xff8a3a, int: 26, ph: rr(0, 10) }); };
  for (let z = 46; z > -54; z -= 11) { torch(-17, z, 1, 0); torch(17, z + 5.5, -1, 0); }
  for (const z of [22, -14]) { torch(-5.6, z + 0.7, 0, 1); torch(5.6, z + 0.7, 0, 1); }
  // candles around the altar and tombs
  const candles = []; for (let i = 0; i < 26; i++) { const a = rr(0, TAU), r = rr(3, 5.5); candles.push({ x: Math.cos(a) * r, z: -41 + Math.sin(a) * r * 0.7 }); }
  for (const [cx, cz] of [[-5, 40], [5, 40], [0, 4]]) for (let i = 0; i < 4; i++) candles.push({ x: cx + rr(-1.8, 1.8), z: cz + (R() < 0.5 ? -2.8 : 2.8) });
  instanced(g, geo('candle', () => new THREE.CylinderGeometry(0.07, 0.08, 0.4, 6).translate(0, 0.2, 0)), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }), candles.map((c) => ({ ...c, s: rr(0.7, 1.4) })), { cast: false });
  const cfl = []; for (const c of candles) { const s = flameSprite(0xffb050, 0.45); s.position.set(c.x, 0.55, c.z); g.add(s); cfl.push(s); }
  E.update = (dt, t) => { for (const fl of flames) { const k = 0.85 + Math.sin(t * 13 + fl.ph) * 0.08 + Math.sin(t * 23 + fl.ph * 2) * 0.07; fl.f.scale.set(1.5 * k, 2.0 * k, 1); fl.f2.scale.setScalar(0.75 * k); }
    altarFire.scale.setScalar(3.2 + Math.sin(t * 6) * 0.3); for (let i = 0; i < cfl.length; i++) cfl[i].scale.setScalar(0.42 + Math.sin(t * 17 + i) * 0.05);
    if (Math.random() < dt * 10) { const fl = pick(flames); sparks.emit(fl.f.position.x, fl.f.position.y + 0.2, fl.f.position.z, randS(0.3), rand(0.8, 1.8), randS(0.3), rgb(0xffa040, 2.5), rand(0.5, 1), 0.12, 0, 0.5, 0); }
    if (Math.random() < dt * 8) sparks.emit(randS(1.4), 2.6, -41 + randS(0.6), randS(0.4), rand(1, 2.5), randS(0.4), rgb(0xff3a80, 2.5), rand(0.6, 1.2), 0.25, 0, 0.5, 0); };
  return E;
}

function buildSanctum(Z) {
  const E = newEnv(), g = E.group, R = srng(99), rr = (a, b) => a + R() * (b - a);
  const lavaMap = TEX.lavaCracks.clone(); lavaMap.repeat.set(5, 5); lavaMap.needsUpdate = true; const obs = TEX.obsidian.clone(); obs.repeat.set(5, 5); obs.needsUpdate = true;
  const floorM = new THREE.MeshStandardMaterial({ map: obs, color: 0x8a7a80, roughness: 0.38, metalness: 0.35, emissive: 0xff5a14, emissiveMap: lavaMap, emissiveIntensity: 2 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30.2, 96).rotateX(-Math.PI / 2), floorM); floor.receiveShadow = true; g.add(floor);
  // inlaid runic ring on the floor
  const inlay = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: TEX.rune, color: hdr(0xff3a10, 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); inlay.scale.set(26, 1, 26); inlay.position.y = 0.03; inlay.renderOrder = 3; g.add(inlay);
  // flowing lava moat
  const lavaM = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, fog: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
      void main(){ vec2 p=vW.xz*0.16; float t=uTime*0.12; float q=fbm(p+vec2(t,-t*0.7)); float v=fbm(p*1.7+q*2.2-vec2(t*0.8,t));
        float crust=smoothstep(0.42,0.62,v); vec3 hot=mix(vec3(4.0,1.1,0.12),vec3(5.0,3.4,1.2),smoothstep(0.0,0.3,0.42-v));
        vec3 col=mix(hot,vec3(0.10,0.03,0.02),crust); gl_FragColor=vec4(col,1.0); }` });
  const moat = new THREE.Mesh(new THREE.RingGeometry(30.1, 46, 96, 1).rotateX(-Math.PI / 2), lavaM); moat.position.y = -0.25; g.add(moat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(30.3, 0.55, 6, 96).rotateX(Math.PI / 2), stdMat({ color: 0x1a1214, roughness: 0.6 })); rim.position.y = -0.05; rim.receiveShadow = true; g.add(rim);
  // jagged cavern walls beyond the lava
  const spikes = []; for (let i = 0; i < 110; i++) { const a = rr(0, TAU), r = rr(44, 58); spikes.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, sx: rr(3, 7), sy: rr(8, 22), sz: rr(3, 7), ry: rr(0, TAU), rx: rr(-0.15, 0.15) }); }
  instanced(g, new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x1e1416, roughness: 0.9, flatShading: true, emissive: 0x3a0800, emissiveIntensity: 0.6 }), spikes, { cast: false });
  // runic pillars with floating crystals
  const pilM = stdMat({ color: 0x241c20, roughness: 0.55, metalness: 0.2 }), bandM = new THREE.MeshBasicMaterial({ map: TEX.runeBand, color: hdr(0xff4a14, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const crystM = new THREE.MeshBasicMaterial({ color: hdr(0xff5a20, 3) }), crystals = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16, x = Math.cos(a) * 23.5, z = Math.sin(a) * 23.5;
    addMesh(g, geo('spil', () => new THREE.CylinderGeometry(1.0, 1.3, 7.5, 8)), pilM, x, 3.75, z); addMesh(g, boxG(3, 0.7, 3), pilM, x, 0.35, z);
    const band = new THREE.Mesh(geo('sband', () => new THREE.CylinderGeometry(1.07, 1.17, 2.2, 8, 1, true)), bandM); band.position.set(x, 3.6, z); g.add(band);
    const c = new THREE.Mesh(geo('scry', () => new THREE.OctahedronGeometry(0.75, 0)), crystM); c.scale.y = 1.6; c.position.set(x, 9, z); g.add(c);
    const gl = flameSprite(0xff4a14, 4.5); gl.position.copy(c.position); g.add(gl); crystals.push({ c, gl, ph: i });
    E.circles.push({ x, z, r: 1.5 }); E.torches.push({ x, y: 8.6, z, color: 0xff5a20, int: 60, ph: i, steady: true });
  }
  // braziers on the boss side
  for (const s of [-1, 1]) { const x = s * 9, z = -20; addMesh(g, geo('braz', () => new THREE.CylinderGeometry(1.1, 0.6, 1.4, 8)), pilM, x, 0.7, z); const f = flameSprite(0xff7a20, 3.5); f.position.set(x, 2, z); g.add(f); crystals.push({ fire: f, ph: s * 3, x, z }); E.circles.push({ x, z, r: 1.2 }); E.torches.push({ x, y: 2.4, z, color: 0xff7a30, int: 40, ph: s * 2 }); }
  E.update = (dt, t) => {
    lavaM.uniforms.uTime.value = t; floorM.emissiveIntensity = 1.7 + Math.sin(t * 1.3) * 0.45 + (G.boss && G.boss.hp < G.boss.maxHp * 0.5 ? 0.6 : 0); inlay.rotation.y = t * 0.03;
    for (const k of crystals) { if (k.c) { k.c.position.y = 9 + Math.sin(t * 1.4 + k.ph) * 0.35; k.c.rotation.y = t * 0.8 + k.ph; k.gl.position.y = k.c.position.y; } else { k.fire.scale.set(3.2 + Math.sin(t * 11 + k.ph) * 0.3, 4 + Math.sin(t * 7 + k.ph) * 0.5, 1); if (Math.random() < dt * 14) sparks.emit(k.x + randS(0.5), 2.2, k.z + randS(0.5), randS(0.5), rand(2, 4), randS(0.5), rgb(0xff8a30, 2.5), rand(0.5, 1), 0.2, 0, 0.3, 0); } }
  };
  return E;
}

// ------------------------------------------------------------------ ambient motes (fireflies / dust / embers) that wrap around the camera target
const motes = new Particles(360, true); scene.add(motes.points);
const moteBase = new Float32Array(360 * 4).map(() => Math.random());
function updateMotes(t) {
  const Z = G.zone, kind = Z ? Z.def.motes : 'fireflies', n = G.quality === 0 ? 160 : 360, W = 56, cx = CAM.target.x, cz = CAM.target.z, P = motes.p;
  const col = kind === 'fireflies' ? [0xd8ff70, 0x9fffb0] : kind === 'dust' ? [0xffd0a0, 0xc8b8a0] : [0xff7a20, 0xffc060];
  for (let i = 0; i < 360; i++) {
    const j = i * 3, b = i * 4;
    if (i >= n) { motes.alpha[i] = 0; continue; }
    let x = moteBase[b] * W, z = moteBase[b + 1] * W, y; const ph = moteBase[b + 2] * 100, sp = 0.4 + moteBase[b + 3];
    if (kind === 'embers') { y = ((moteBase[b + 2] * 14 + t * sp * 1.6) % 14); x += Math.sin(t * 0.6 + ph) * 1.5; }
    else if (kind === 'dust') { y = 0.5 + moteBase[b + 2] * 5 + Math.sin(t * 0.3 + ph) * 0.4; x += Math.sin(t * 0.15 * sp + ph) * 2; z += Math.cos(t * 0.12 * sp + ph) * 2; }
    else { y = 0.6 + moteBase[b + 2] * 3.2 + Math.sin(t * 0.9 * sp + ph) * 0.6; x += Math.sin(t * 0.35 * sp + ph) * 2.2; z += Math.cos(t * 0.3 * sp + ph * 1.3) * 2.2; }
    P[j] = cx + ((((x - cx) % W) + W * 1.5) % W) - W / 2; P[j + 1] = y; P[j + 2] = cz + ((((z - cz) % W) + W * 1.5) % W) - W / 2;
    const c = rgb(col[i & 1], kind === 'dust' ? 0.9 : 2.6); motes.c[j] = c[0]; motes.c[j + 1] = c[1]; motes.c[j + 2] = c[2];
    motes.size[i] = kind === 'dust' ? 0.12 : kind === 'embers' ? 0.16 + (i % 3) * 0.05 : 0.2;
    const fl = kind === 'fireflies' ? Math.max(0, Math.sin(t * (1.2 + sp) + ph)) ** 2 : kind === 'embers' ? Math.min(1, (14 - y) / 4) * Math.min(1, y) : 0.35;
    motes.alpha[i] = fl;
  }
  motes.aP.needsUpdate = motes.aC.needsUpdate = motes.aS.needsUpdate = motes.aA.needsUpdate = true;
}

// ------------------------------------------------------------------ zone lifecycle
const envCache = {};
function setZoneEnvironment(i) {
  const def = ZONES[i];
  if (G.zone && G.zone.env) scene.remove(G.zone.env.group);
  const env = envCache[def.id] || (envCache[def.id] = def.build({ def }));
  scene.add(env.group);
  G.zoneIndex = i;
  const pp = env.portalPos || def.portalPos;
  G.zone = { def, env, circles: env.circles.slice(), boxes: env.boxes, bounds: env.areas ? { areas: env.areas } : def.bounds, portal: null, portalOpen: false, portalT: 0, portalPos: pp ? { x: pp[0], z: pp[1] } : null, torches: !!def.torches || env.torches.length > 0 };
  if (pp && def.next) {
    if (!env.portal) { env.portal = buildPortal(def.portalColor, !env.fromGLB); env.portal.position.set(pp[0], 0, pp[1]); env.group.add(env.portal); }
    G.zone.portal = env.portal; env.portal.visible = false;
  }
  scene.background.setHex(def.bg); scene.fog = new THREE.Fog(def.fog[0], def.fog[1], def.fog[2]);
  hemi.color.setHex(def.hemi[0]); hemi.groundColor.setHex(def.hemi[1]); hemi.intensity = def.hemi[2];
  sun.color.setHex(def.sun[0]); sun.intensity = def.sun[1]; renderer.toneMappingExposure = def.exposure;
  const shadowTorches = G.quality === 2 && G.zone.torches;
  torchLights.forEach((L, k) => { L.visible = G.zone.torches; L.castShadow = shadowTorches && k < 2; L.intensity = 0; });
  portalLight.intensity = 0; portalLight.color.setHex(def.portalColor || 0xffffff);
}
const _tl = [];
function updateZone(dt, t) {
  const Z = G.zone; if (!Z) return;
  if (Z.env.update) Z.env.update(dt, t);
  // nearest torches get the real lights
  if (Z.torches) {
    const tx = CAM.target.x, tz = CAM.target.z; _tl.length = 0;
    for (const s of Z.env.torches) { s.d = (s.x - tx) ** 2 + (s.z - tz) ** 2; _tl.push(s); }
    _tl.sort((a, b) => a.d - b.d);
    torchLights.forEach((L, k) => { const s = _tl[k]; if (!s) { L.intensity = 0; return; } L.position.set(s.x, s.y, s.z); L.color.setHex(s.color);
      L.intensity = s.int * (s.steady ? 0.9 + Math.sin(t * 2 + s.ph) * 0.1 : 0.82 + Math.sin(t * 11 + s.ph) * 0.09 + Math.sin(t * 27 + s.ph * 3) * 0.07) * Math.min(1, Math.max(0, 1.3 - Math.sqrt(s.d) / 30)); });
  }
  if (Z.portal) {
    const P = Z.portal, u = P.userData; u.swirl.material.uniforms.uTime.value = t; u.rune.rotation.y = t * 0.4;
    if (Z.portalOpen) {
      Z.portalT += dt; const k = easeOut(Math.min(1, Z.portalT / 0.9)); u.inner.scale.setScalar(Math.max(0.001, k)); u.rune.scale.set(8 * k, 1, 8 * k);
      portalLight.position.set(P.position.x, 3, P.position.z + 1); portalLight.intensity = 60 * k * (0.9 + Math.sin(t * 3) * 0.1);
      if (Math.random() < dt * 40 * k) { const a = rand(TAU), r = rand(1.5, 3.2); sparks.emit(P.position.x + Math.cos(a) * r, 0.2, P.position.z + Math.sin(a) * r * 0.5, -Math.cos(a) * 1.2, rand(1.5, 4), -Math.sin(a) * 0.6, rgb(u.color, 2.6), rand(0.5, 1.1), 0.25, 0, 0.5, 0); }
      const p = G.player; if (G.state === 'playing' && p && !p.dead && Z.portalT > 0.8 && Math.hypot(p.pos.x - P.position.x, p.pos.z - P.position.z) < 2.2) goToZone(Z.def.next);
    } else { u.inner.scale.setScalar(0.001); u.rune.scale.set(0.001, 1, 0.001); }
  }
  if (Z.def.safe) updateTown(dt, t);
  // see-through cylinder towards the hero
  const p = G.player;
  if (p && G.state !== 'select') { OCC.uOccOn.value = 1; OCC.uOccCam.value.copy(camera.position); OCC.uOccPlayer.value.set(p.pos.x, 1.4, p.pos.z); } else OCC.uOccOn.value = 0;
}

/** removes every enemy, projectile, drop and effect from the world */
function clearWorld() {
  for (const e of G.enemies) { unfreeze(e, false); actorRoot.remove(e.root); for (const m of e.mats) m.dispose(); }
  G.enemies.length = 0; G.boss = null; G.miniBoss = null; clearProjectiles(); clearDrops(); clearChests(); clearMerchant(); clearFx(); timers.length = 0; for (const L of lightPool) freeLight(L);
  showBossBar(false); clearDmgNumbers();
}
function spawnZoneEnemies(def) {
  const env = G.zone.env, packs = env.packs || def.packs; let packN = 0;
  for (const [px, pz, list0, opt] of packs) {
    const list = list0.slice(); packN++;
    if (def.id === 'wild' && packN % 2 === 0) { const w = list.indexOf('wolf'); if (w >= 0 && list.filter((t) => t === 'wolf').length >= 2) list[w] = 'alpha'; }
    list.forEach((type, k) => { const a = (k / list.length) * TAU + rand(0.5), r = list.length > 1 ? rand(1.8, 3.4) : 0; spawnEnemy(type, px + Math.cos(a) * r, pz + Math.sin(a) * r, { opt }); });
  }
  for (const m of env.minis || def.minis || []) {
    spawnEnemy(m.type, m.x, m.z, { facing: m.rot, opt: true });
    m.guards.forEach((type, k) => { const a = (k / m.guards.length) * TAU, r = 3.6; spawnEnemy(type, m.x + Math.cos(a) * r, m.z + Math.sin(a) * r, { opt: true }); });
  }
  const bp = env.boss || def.boss; if (bp) G.boss = spawnEnemy('boss', bp[0], bp[1], { facing: 0 });
}
function enterZone(i) {
  clearWorld(); setZoneEnvironment(i);
  const def = ZONES[i], p = G.player, st = G.zone.env.start || def.start;
  p.pos.set(st[0], 0, st[1]); p.facing = p.wantFacing = Math.PI; p.moveTarget = p.atkTarget = null; p.dash = null; p.kb.set(0, 0, 0);
  if (p.cast) endCast(p, true);
  p.hp = p.st.maxHp; p.mana = p.st.maxMana; p.cds.fill(0); p.roarT = p.focusT = 0; p.shield = p.shieldT = p.willT = p.fearT = 0; G.regionSeen = {}; p.potCd = [0, 0]; p.hot = 0;
  const ex = INV.extraPot || [0, 0]; p.potions = [5 + (ex[0] | 0), 5 + (ex[1] | 0)];
  if (!def.safe && (ex[0] || ex[1])) { INV.extraPot = [0, 0]; saveInv(); }
  spawnZoneEnemies(def); spawnChests(G.zone.env.chests); if (def.safe) spawnMerchant();
  AUDIO.playMusic(def.id); G.dmgMul = 1 + 0.35 * (G.tier - 1);
  CAM.dist = def.camDist || 27; updateCamera(0, true); banner(def.title, def.sub); $('#hud-zone').textContent = def.sub ? `${def.title} – ${def.sub}` : def.title; updateObjective();
  flash(p.pos.x, 1.2, p.pos.z, p.def.color, 6, 0.5); ringFx(p.pos.x, p.pos.z, { tex: TEX.rune, color: p.def.color, r0: 3, r1: 1, dur: 0.8, spin: 3, int: 2.4 });
  burst(p.pos.x, 0.3, p.pos.z, { n: 40, color: p.def.color, color2: 0xffffff, int: 2.6, up: 2.5, s0: 2, s1: 9, size: 0.35, l0: 0.4, l1: 1, r: 1.2 });
}
function goToZone(i) {
  if (G.state !== 'playing') return; G.state = 'transition';
  const p = G.player; if (p) { sfx('teleport'); beamFx(p.pos.x, p.pos.z, p.def.color, 2.6, 14, 0.6, 2.4); burst(p.pos.x, 0.5, p.pos.z, { n: 50, color: p.def.color, color2: 0xffffff, int: 2.6, up: 3, s0: 2, s1: 10, size: 0.35, l0: 0.4, l1: 1, r: 1 }); }
  const f = $('#fade'); f.classList.add('on');
  Promise.all([ensureEnv(i), new Promise((r) => setTimeout(r, 480))]).then(() => { enterZone(i); G.state = 'playing'; requestAnimationFrame(() => f.classList.remove('on')); });
}
// ------------------------------------------------------------------ town: fountain, teleport stone (waypoint) + travel dialog
let travelTier = 1;
function waypointPos() { const w = (G.zone.env.waypoint || G.zone.def.waypoint); return { x: w[0], z: w[1] }; }
function updateTown(dt, t) {
  const env = G.zone.env, f = env.fountain;
  if (f) for (let i = 0; i < (G.quality ? 6 : 3); i++) {
    const a = rand(TAU), sp = rand(0.6, 1.6);
    smoke.emit(f[0] + Math.cos(a) * 0.12, f[1], f[2] + Math.sin(a) * 0.12, Math.cos(a) * sp, rand(3.2, 4.4), Math.sin(a) * sp, rgb(0xcfe6ff, 0.9), rand(0.7, 1.0), 0.16, 0.08, 0.2, 9);
  }
  const w = waypointPos();
  if (Math.random() < dt * 14) { const a = rand(TAU), r = rand(1.9, 2.4); sparks.emit(w.x + Math.cos(a) * r, 0.8, w.z + Math.sin(a) * r, 0, rand(1, 3), 0, rgb(0x5ab0ff, 2.2), rand(0.6, 1.2), 0.2, 0, 0.3, 0); }
}
function tryOpenTravel() {
  const p = G.player; if (!p || G.state !== 'playing' || !G.zone.def.safe) return false;
  const w = waypointPos(); if (Math.hypot(p.pos.x - w.x, p.pos.z - w.z) > 3.6) return false;
  openTravel(); return true;
}
function openTravel() {
  travelTier = Math.min(Math.max(1, G.tier), PROGRESS.maxTier); renderTravel(); $('#travel').classList.remove('hidden'); sfx('click');
}
function renderTravel() {
  const t = travelTier;
  $('#tr-tier').textContent = t; $('#tr-max').textContent = PROGRESS.maxTier;
  $('#tr-desc').innerHTML = t === 1 ? 'Základná obťažnosť.' : `Nepriatelia: <b>+${Math.round(60 * (t - 1))} %</b> života, <b>+${Math.round(35 * (t - 1))} %</b> poškodenia · korisť a skúsenosti: <b>+${Math.round(50 * (t - 1))} %</b>`;
  $('#tr-prev').disabled = t <= 1; $('#tr-next').disabled = t >= PROGRESS.maxTier;
}
function initTravelUI() {
  $('#tr-prev').addEventListener('click', () => { travelTier = Math.max(1, travelTier - 1); renderTravel(); sfx('click'); });
  $('#tr-next').addEventListener('click', () => { travelTier = Math.min(PROGRESS.maxTier, travelTier + 1); renderTravel(); sfx('click'); });
  $('#tr-close').addEventListener('click', () => { $('#travel').classList.add('hidden'); sfx('click'); });
  document.querySelectorAll('#tr-list button').forEach((b) => b.addEventListener('click', () => { $('#travel').classList.add('hidden'); G.tier = travelTier; goToZone(+b.dataset.z); }));
}

function fadeThen(fn) { const f = $('#fade'); f.classList.add('on'); setTimeout(() => { fn(); requestAnimationFrame(() => f.classList.remove('on')); }, 480); }
// =====================================================================================
//  Blender maps (./maps/<id>.glb) → environment: GPU instancing, collisions, markers
//  If a map file is missing, the procedural fallback from 08_zones.js is used.
// =====================================================================================
const lavaMaterial = () => new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, fog: false,
  vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: `uniform float uTime; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
    void main(){ vec2 p=vW.xz*0.16; float t=uTime*0.12; float q=fbm(p+vec2(t,-t*0.7)); float v=fbm(p*1.7+q*2.2-vec2(t*0.8,t));
      float crust=smoothstep(0.42,0.62,v); vec3 hot=mix(vec3(4.0,1.1,0.12),vec3(5.0,3.4,1.2),smoothstep(0.0,0.3,0.42-v));
      gl_FragColor=vec4(mix(hot,vec3(0.10,0.03,0.02),crust),1.0); }` });

async function loadMapGLB(id) {
  for (const base of ['./maps/', './']) {
    try { const g = await gltfLoader.loadAsync(base + id + '.glb'); console.log(`[mapa] ${base}${id}.glb načítaná`); return g; } catch (e) { /* try next location */ }
  }
  console.warn(`[mapa] ${id}.glb sa nenašla – používam procedurálnu záložnú mapu`);
  return null;
}
const flagOf = (o, k) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData[k] !== undefined) return p.userData[k]; return undefined; };

function envFromGLB(gltf) {
  const E = newEnv(), root = gltf.scene, meshes = [], fixed = new Set(), lavaMats = [], pulse = [], floats = [], flames = [];
  E.markers = []; root.updateMatrixWorld(true);
  const _p = new V3(), _q = new THREE.Quaternion(), _s = new V3(), box = new THREE.Box3();
  root.traverse((o) => {
    const u = o.userData || {};
    if (u.marker) { o.getWorldPosition(_p); E.markers.push({ name: u.marker, x: _p.x, y: _p.y, z: _p.z, u }); return; }
    if (u.col === 'circle') { o.getWorldPosition(_p); E.circles.push({ x: _p.x, z: _p.z, r: +u.r || 1 }); }
    else if (u.col === 'box') { box.setFromObject(o); E.boxes.push({ x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z }); }
    if (o.isMesh) meshes.push(o);
  });
  // ---- material fix-ups (shared materials are handled once)
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mt, k) => {
      if (flagOf(m, 'lava')) { const L = lavaMaterial(); lavaMats.push(L); if (Array.isArray(m.material)) m.material[k] = L; else m.material = L; return; }
      if (fixed.has(mt)) return; fixed.add(mt);
      for (const t of [mt.map, mt.normalMap, mt.emissiveMap]) if (t) { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      if (/^DECAL/.test(mt.name)) { mt.transparent = true; mt.depthWrite = false; mt.polygonOffset = true; mt.polygonOffsetFactor = -2; mt.alphaTest = 0; mt.roughness = 1; }
      else if (!/GROUND|FLOOR/i.test(mt.name)) occluder(mt);
      if (mt.normalMap) mt.normalScale.set(1, -1);
      if (/OBSIDIAN|PULSE/.test(mt.name)) pulse.push({ mt, base: mt.emissiveIntensity || 1 });
      mt.side = /PLANT|LEAF|TENT|BANNER|DECAL/i.test(mt.name) ? THREE.DoubleSide : mt.side;
    });
  }
  // ---- turn repeated meshes (linked duplicates in Blender) into InstancedMesh
  const groups = new Map();
  for (const m of meshes) { if (m.isSkinnedMesh) continue; const key = m.geometry.uuid + '|' + (Array.isArray(m.material) ? m.material.map((x) => x.uuid).join() : m.material.uuid); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(m); }
  const out = E.group;
  for (const list of groups.values()) {
    const m0 = list[0], cast = !flagOf(m0, 'noshadow') && !flagOf(m0, 'ground') && !flagOf(m0, 'lava') && !flagOf(m0, 'decal');
    if (list.length >= 3) {
      const im = new THREE.InstancedMesh(m0.geometry, m0.material, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m.matrixWorld)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = cast; im.receiveShadow = true; im.renderOrder = m0.renderOrder; out.add(im);
    } else for (const m of list) {
      m.matrixWorld.decompose(_p, _q, _s); const c = new THREE.Mesh(m.geometry, m.material); c.position.copy(_p); c.quaternion.copy(_q); c.scale.copy(_s);
      c.castShadow = cast; c.receiveShadow = true; c.userData = { ...m.userData, ...(m.parent ? m.parent.userData : {}) }; out.add(c);
      if (c.userData.float) floats.push({ o: c, y: c.position.y, ph: Math.random() * 10 });
    }
  }
  // ---- markers
  for (const mk of E.markers) {
    const u = mk.u;
    if (mk.name === 'TORCH') {
      const t = { x: mk.x, y: mk.y, z: mk.z, color: +u.color || 0xff8a3a, int: +u.int || 26, ph: Math.random() * 10, steady: !!u.steady };
      if (!u.nolight) E.torches.push(t);
      if (u.flame) { const f = flameSprite(t.color, 1.6), f2 = flameSprite(0xffe0a0, 0.7); f.material.color.multiplyScalar(0.55); f2.material.color.multiplyScalar(0.6); f.position.set(mk.x, mk.y + 0.1, mk.z); f2.position.copy(f.position); out.add(f, f2); flames.push({ f, f2, ph: t.ph, big: +u.flame }); }
    }
    if (mk.name === 'COL') E.circles.push({ x: mk.x, z: mk.z, r: +u.r || 1 });
    if (mk.name === 'COLBOX') E.boxes.push({ x0: mk.x - (+u.w || 1) / 2, x1: mk.x + (+u.w || 1) / 2, z0: mk.z - (+u.d || 1) / 2, z1: mk.z + (+u.d || 1) / 2 });
    if (mk.name === 'SPAWN') E.start = [mk.x, mk.z];
    if (mk.name === 'SHOW') E.show = [mk.x, mk.z];
    if (mk.name === 'PORTAL') E.portalPos = [mk.x, mk.z];
    if (mk.name === 'BOSS') E.boss = [mk.x, mk.z];
    if (mk.name === 'WAYPOINT') E.waypoint = [mk.x, mk.z];
    if (mk.name === 'FOUNTAIN') E.fountain = [mk.x, mk.y, mk.z];
    if (mk.name === 'LOBBY') (E.lobby || (E.lobby = []))[+u.slot || 0] = [mk.x, mk.z];
    if (mk.name === 'CHEST') (E.chests || (E.chests = [])).push({ x: mk.x, z: mk.z, rot: +u.rot || 0, rich: !!u.rich, scale: +u.scale || 1 });
    if (mk.name === 'REGION') (E.regions || (E.regions = [])).push({ name: String(u.title || ''), sub: String(u.sub || ''), x0: mk.x - (+u.w || 1) / 2, x1: mk.x + (+u.w || 1) / 2, z0: mk.z - (+u.d || 1) / 2, z1: mk.z + (+u.d || 1) / 2 });
    if (mk.name === 'MERCHANT') E.merchant = [mk.x, mk.z, +u.rot || 0];
    if (mk.name === 'AREA') (E.areas || (E.areas = [])).push({ x0: mk.x - (+u.w || 1) / 2, x1: mk.x + (+u.w || 1) / 2, z0: mk.z - (+u.d || 1) / 2, z1: mk.z + (+u.d || 1) / 2 });
    if (mk.name === 'MINIBOSS') (E.minis || (E.minis = [])).push({ x: mk.x, z: mk.z, type: String(u.type || 'wolfLord'), rot: +u.rot || 0, guards: String(u.guards || '').split(',').map((s) => s.trim()).filter((s) => ENEMY_DEFS[s]) });
    if (mk.name === 'PACK') (E.packs || (E.packs = [])).push([mk.x, mk.z, String(u.types || '').split(',').map((s) => s.trim()).filter((s) => ENEMY_DEFS[s]), !!u.opt]);
  }
  E.update = (dt, t) => {
    for (const L of lavaMats) L.uniforms.uTime.value = t;
    const enr = G.boss && G.boss.hp < G.boss.maxHp * 0.5 ? 0.5 : 0;
    for (const p of pulse) p.mt.emissiveIntensity = p.base * (0.8 + Math.sin(t * 1.3) * 0.2 + enr);
    for (const f of floats) { f.o.position.y = f.y + Math.sin(t * 1.4 + f.ph) * 0.3; f.o.rotation.y = t * 0.7 + f.ph; }
    for (const fl of flames) { const k = (0.85 + Math.sin(t * 13 + fl.ph) * 0.08 + Math.sin(t * 23 + fl.ph * 2) * 0.07) * Math.sqrt(fl.big); fl.f.scale.set(1.5 * k, 2.0 * k, 1); fl.f2.scale.setScalar(0.75 * k);
      if (Math.random() < dt * 4 * fl.big) sparks.emit(fl.f.position.x + randS(0.15), fl.f.position.y + 0.3, fl.f.position.z + randS(0.15), randS(0.3), rand(0.8, 2.2), randS(0.3), rgb(0xffa040, 2.5), rand(0.5, 1.1), 0.13, 0, 0.5, 0); }
  };
  return E;
}

const envPending = {};
/** builds (once) the environment of zone i – Blender map if available, procedural otherwise */
function ensureEnv(i) {
  const def = ZONES[i];
  if (envCache[def.id] && ZONE_MONSTERS[def.id].every((t) => t in MONSTER_CACHE)) return Promise.resolve(envCache[def.id]);
  if (envCache[def.id]) return loadZoneMonsters(def.id).then(() => envCache[def.id]);
  if (!envPending[def.id]) envPending[def.id] = (params.has('proc') ? Promise.resolve(null) : loadMapGLB(def.id)).then((g) => {
    const env = g ? envFromGLB(g) : def.build({ def }); env.fromGLB = !!g; envCache[def.id] = env; return env;
  }).then((env) => Promise.all([params.has('procmon') ? null : loadZoneMonsters(def.id), loadChestModel(), def.safe ? loadMerchantModel() : null]).then(() => env));
  return envPending[def.id];
}
// =====================================================================================
//  UI – HUD, ability bar, damage numbers, banners, select screen, end screens
// =====================================================================================
const ICONS = {
  orb: '<circle cx="20" cy="20" r="6.5" fill="#fff"/><ellipse cx="20" cy="20" rx="14" ry="6" transform="rotate(-30 20 20)"/><path d="M8 8l3 3M32 32l-3-3M31 8l-2 2"/>',
  snow: '<path d="M20 5v30M7 12.5l26 15M7 27.5l26-15M16 7l4 4 4-4M16 33l4-4 4 4M7.5 17.5l5.5-1.5-1.5-5.5M32.5 22.5l-5.5 1.5 1.5 5.5M7.5 22.5l5.5 1.5-1.5 5.5M32.5 17.5l-5.5-1.5 1.5-5.5"/>',
  meteor: '<circle cx="26" cy="26" r="7" fill="#fff"/><path d="M6 6l14 14M5 14l11 11M14 5l11 11"/><path d="M14 34h22" stroke-dasharray="3 3"/>',
  bolt: '<path d="M23 3L10 22h9l-3 15 14-21h-9z" fill="#fff" stroke="none"/>',
  blink: '<circle cx="12" cy="24" r="6" stroke-dasharray="3 2.5"/><circle cx="29" cy="15" r="6" fill="#fff"/><path d="M15 19l9-5"/>',
  slash: '<path d="M7 31C9 16 20 8 34 7 23 12 15 21 12 33z" fill="#fff" stroke="none"/><path d="M9 25l-3 3M31 11l3-3"/>',
  slam: '<path d="M20 4v15M14 13l6 6 6-6"/><path d="M4 28h32M10 28l-3 7M20 28v8M30 28l3 7M14 28l-2 4M26 28l2 4"/>',
  vortex: '<path d="M20 20c0-3 4-3 4 0 0 5-8 5-8 0 0-7 12-7 12 0 0 9-16 9-16 0 0-11 20-11 20 0"/>',
  roar: '<path d="M8 22l7-4v-6l6 4 5-7 1 9 7 2-7 5 2 9-8-5-6 6-1-8z" fill="#fff" stroke="none"/>',
  charge: '<path d="M14 20h20M27 13l7 7-7 7"/><path d="M4 14h8M3 20h7M4 26h8"/>',
  arrow: '<path d="M8 32L31 9M31 9h-9M31 9v9M8 32l-2-6M8 32l6 2"/>',
  volley: '<path d="M8 33L20 8M20 8l-5 4M20 8l2 6M8 33L32 13M32 13h-6M32 13l-1 6M8 33L35 25M35 25l-5-3M35 25l-4 4"/>',
  rain: '<path d="M10 4v14M10 18l-3-4M10 18l3-4M20 8v16M20 24l-3-4M20 24l3-4M30 4v14M30 18l-3-4M30 18l3-4"/><ellipse cx="20" cy="32" rx="14" ry="3.5"/>',
  hawk: '<path d="M20 18C14 9 7 9 3 12c6 0 10 4 12 9l5 4 5-4c2-5 6-9 12-9-4-3-11-3-17 6z" fill="#fff" stroke="none"/><path d="M20 25v8"/>',
  roll: '<path d="M30 14a11 11 0 1 0 1 10"/><path d="M31 6v8h-8"/>',
};
ICONS.potHp = '<path d="M16 6h8v6l7 9a8.5 8.5 0 0 1-7 13h-8a8.5 8.5 0 0 1-7-13l7-9z" fill="#ff4a3a" fill-opacity=".85"/><path d="M15 5h10"/><path d="M12 24h16" stroke-opacity=".6"/>';
ICONS.potMp = '<path d="M16 6h8v6l7 9a8.5 8.5 0 0 1-7 13h-8a8.5 8.5 0 0 1-7-13l7-9z" fill="#4a8aff" fill-opacity=".85"/><path d="M15 5h10"/><path d="M12 24h16" stroke-opacity=".6"/>';
const svgIcon = (k) => `<svg viewBox="0 0 40 40" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
let iconSeq = 0;
/** painted ability icon: coloured radial backdrop, grain, vignette, glowing glyph */
function paintedIcon(k, color, color2 = '#0b0908') {
  const id = 'pi' + iconSeq++;
  return `<svg viewBox="0 0 40 40"><defs><radialGradient id="${id}g" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".18" stop-color="${color}"/><stop offset=".62" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color2}"/></radialGradient>
    <filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="${iconSeq}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .45 0"/></filter></defs>
    <rect width="40" height="40" fill="${color2}"/><rect width="40" height="40" fill="url(#${id}g)"/><rect width="40" height="40" filter="url(#${id}n)"/>
    <g fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}f)" transform="translate(4 4) scale(.8)">${ICONS[k]}</g>
    <rect width="40" height="40" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3"/></svg>`;
}

// ------------------------------------------------------------------ toast / banner / objective / boss bar / hurt
let toastTimer = 0;
function toast(msg, color) { const t = $('#toast'); t.textContent = msg; t.style.color = color || ''; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2300); }
function banner(title, sub) { const b = $('#banner'); $('#ban-t').textContent = title; $('#ban-s').textContent = sub || ''; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function updateObjective() {
  const Z = G.zone, o = $('#objective'); if (!Z) return;
  const n = aliveEnemies().filter((e) => !e.def.boss && !e.opt).length, minis = aliveEnemies().filter((e) => e.def.mini).length;
  const tier = G.tier > 1 ? `<br><small>Úroveň výpravy ${G.tier}</small>` : '';
  if (Z.def.safe) { o.innerHTML = 'Mesto je bezpečné<br>Teleportný kameň: <b>F</b>'; return; }
  if (Z.def.boss && !G.boss && Z.portalOpen) { o.innerHTML = 'Ignarax padol!<br>Vstúp do <b>brány do mesta</b>'; return; }
  if (Z.def.boss) o.innerHTML = G.boss ? `Poraz <b>Ignaraxa, Ohnivého draka</b>${n ? `<br>Prisluhovači: <b>${n}</b>` : ''}` : '<b>Svätyňa je očistená</b>';
  else if (Z.portalOpen) o.innerHTML = 'Vstúp do <b>portálu</b>';
  else o.innerHTML = `Zabi všetkých nepriateľov<br>Zostáva: <b>${n}</b>`;
  if (!Z.def.boss && minis) o.innerHTML += `<br><small>Voliteľné: ${minis === 1 ? '1 mini-boss' : minis + ' mini-bossovia'} na odbočkách</small>`;
  o.innerHTML += tier;
}
function showBossBar(on, name) { $('#boss').classList.toggle('hidden', !on); if (name) $('#boss .nm').textContent = name; $('#boss').classList.toggle('mini', !!(G.miniBoss && !G.boss)); if (on) updateBossBar(); }
function updateBossBar() { const b = G.boss || G.miniBoss; const f = b ? Math.max(0, b.hp / b.maxHp) * 100 : 0; $('#boss i').style.width = f + '%'; $('#boss u').style.width = f + '%'; }
let hurtK = 0;
function hurtFlash(k) { hurtK = Math.max(hurtK, k); }

// ------------------------------------------------------------------ floating damage numbers (pooled DOM nodes)
const dmgPool = [], dmgLive = [];
function dmgNumber(x, y, z, text, cls) {
  if (!SETTINGS.dmgNumbers && cls !== 'info' && cls !== 'heal') return;
  let d = dmgPool.pop();
  if (!d) { d = { el: document.createElement('div') }; $('#labels').appendChild(d.el); }
  d.el.className = 'dmg ' + (cls || ''); d.el.textContent = text; d.el.style.display = '';
  d.x = x; d.y = y; d.z = z; d.t = 0; d.vx = randS(28); d.crit = cls === 'crit'; d.life = d.crit ? 1.15 : 0.9;
  dmgLive.push(d);
  if (dmgLive.length > 70) { const o = dmgLive.shift(); o.el.style.display = 'none'; dmgPool.push(o); }
}
function updateDmgNumbers(dt) {
  for (let i = dmgLive.length - 1; i >= 0; i--) {
    const d = dmgLive[i]; d.t += dt;
    if (d.t >= d.life || !toScreen(d.x, d.y, d.z, _scr)) { d.el.style.display = 'none'; dmgPool.push(d); dmgLive.splice(i, 1); continue; }
    const k = d.t / d.life, rise = 70 * easeOut(Math.min(1, k * 1.4)), sc = d.crit ? (k < 0.12 ? 0.6 + k / 0.12 * 0.9 : 1.5 - Math.min(0.4, (k - 0.12) * 1.5)) : (k < 0.1 ? 0.7 + k * 3 : 1);
    d.el.style.transform = `translate(-50%,-50%) translate(${(_scr.x + d.vx * k).toFixed(1)}px,${(_scr.y - rise).toFixed(1)}px) scale(${sc.toFixed(3)})`;
    d.el.style.opacity = k > 0.7 ? (1 - (k - 0.7) / 0.3).toFixed(3) : '1';
  }
}
function clearDmgNumbers() { for (const d of dmgLive) { d.el.style.display = 'none'; dmgPool.push(d); } dmgLive.length = 0; }

// ------------------------------------------------------------------ ability bar
const slotEls = [], potEls = [];
function buildHUD(def) {
  $('#hud-name').textContent = `${def.name} – ${def.cls}`;
  const orb = document.querySelector('.orb.mp'); orb.style.setProperty('--res-hi', def.res[0]); orb.style.setProperty('--res', def.res[1]); orb.style.setProperty('--res-lo', def.res[2]);
  $('#mp-lbl').textContent = def.resName;
  if (!$('#portrait').firstChild || $('#portrait').dataset.hero !== def.id) { $('#portrait').innerHTML = paintedIcon(def.abilities[0].icon, def.css); $('#portrait').dataset.hero = def.id; }
  for (const o of ['#orb-hp .orb', '#orb-mp .orb']) { const el = document.querySelector(o); if (!el.querySelector('.bub')) for (let i = 0; i < 6; i++) { const b = document.createElement('i'); b.className = 'bub'; b.style.left = (12 + i * 14) + '%'; b.style.animationDelay = (i * 0.57) + 's'; b.style.animationDuration = (2.6 + (i % 3) * 0.8) + 's'; el.insertBefore(b, el.querySelector('.shine')); } }
  const pbox = $('#potions'); pbox.innerHTML = ''; potEls.length = 0;
  POTIONS.forEach((pt, i) => {
    const s = document.createElement('div'); s.className = 'slot small';
    s.innerHTML = `<div class="ic">${paintedIcon(pt.icon, pt.color, '#120806')}</div><div class="cd"></div><div class="cdt"></div><span class="key">${pt.key}</span><span class="cnt"></span>`;
    s.addEventListener('mouseenter', () => { const t = $('#abtip'); t.innerHTML = `<b>${pt.name}</b><i>Kláves ${pt.key} · obnovenie ${pt.cd} s</i>${pt.desc}`; t.style.display = 'block'; });
    s.addEventListener('mouseleave', () => { $('#abtip').style.display = 'none'; });
    s.addEventListener('mousedown', (e) => { e.stopPropagation(); usePotion(i); });
    pbox.appendChild(s); potEls.push({ s, cd: s.querySelector('.cd'), cdt: s.querySelector('.cdt'), cnt: s.querySelector('.cnt'), last: '' });
  });
  const box = $('#slots'); box.innerHTML = ''; slotEls.length = 0;
  def.abilities.forEach((ab, i) => {
    const s = document.createElement('div'); s.className = 'slot';
    s.innerHTML = `<div class="ic">${paintedIcon(ab.icon, def.css)}</div><div class="cd"></div><div class="cdt"></div><span class="key">${ab.key}</span><div class="lock"><svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="#c9a45c"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="#c9a45c" stroke-width="2.2"/></svg><b>${UNLOCK_LV[i] || 1}</b></div>`;
    s.addEventListener('mouseenter', () => { const t = $('#abtip'), p = G.player, locked = p && !abilityUnlocked(p, i); t.innerHTML = `<b>${ab.name}</b><i>${keyLabel(ab.key)}${ab.cd ? ` · obnovenie ${String(ab.cd).replace('.', ',')} s` : ''}${ab.cost ? ` · ${ab.cost} ${def.resName.toLowerCase()}` : ''}</i>${ab.desc}${locked ? `<em class="lk">🔒 Odomkne sa na úrovni ${UNLOCK_LV[i]}</em>` : ''}`; t.style.display = 'block'; });
    s.addEventListener('mouseleave', () => { $('#abtip').style.display = 'none'; });
    box.appendChild(s); slotEls.push({ s, cd: s.querySelector('.cd'), cdt: s.querySelector('.cdt'), last: '' });
  });
}
const keyLabel = (k) => (k === 'MEDZ' ? 'Medzerník' : k === 'ĽTM' ? 'Ľavé tlačidlo myši' : k === 'PTM' ? 'Pravé tlačidlo myši' : 'Kláves ' + k);
function unlockSlotFx(i) { const s = slotEls[i]; if (!s) return; s.s.classList.remove('locked', 'unlocked'); void s.s.offsetWidth; s.s.classList.add('unlocked'); }
function denySlot(i) { const s = slotEls[i]; if (!s) return; s.s.classList.remove('deny'); void s.s.offsetWidth; s.s.classList.add('deny'); }
function readySlot(i) { const s = slotEls[i]; if (!s) return; s.s.classList.remove('ready'); void s.s.offsetWidth; s.s.classList.add('ready'); }
let hudAcc = 0;
function updateHUD(dt) {
  const p = G.player; if (!p) return;
  $('#hp-fill').style.height = (p.hp / p.st.maxHp * 100).toFixed(1) + '%'; $('#mp-fill').style.height = (p.mana / p.st.maxMana * 100).toFixed(1) + '%';
  hudAcc += dt;
  if (hudAcc > 0.1) {
    hudAcc = 0; $('#hp-val').textContent = `${Math.ceil(p.hp)} / ${p.st.maxHp}`; $('#mp-val').textContent = `${Math.floor(p.mana)} / ${p.st.maxMana}`;
    $('#orb-hp').classList.toggle('low', p.hp / p.st.maxHp < 0.3 && !p.dead);
    const need = xpNeed(p.level); $('#lvl').textContent = p.level; $('#xp-fill').style.width = (p.xp / need * 100).toFixed(1) + '%'; $('#xp-txt').textContent = `${Math.floor(p.xp)} / ${need} XP`; $('#lvl-r').textContent = `Úroveň ${p.level}`;
    POTIONS.forEach((pt, i) => { const s = potEls[i]; if (!s) return; s.cnt.textContent = p.potions[i]; s.s.classList.toggle('nomana', p.potions[i] <= 0); });
    const buffs = [];
    if (p.roarT > 0) buffs.push(['roar', '#ffc64a', p.roarT]);
    if (p.focusT > 0) buffs.push(['hawk', '#5fe8ff', p.focusT]);
    if (p.cast && p.cast.ab.fn === 'bladeVortex') buffs.push(['vortex', '#8feaff', p.cast.cast - p.cast.t]);
    if (p.hot > 0) buffs.push(['potHp', '#ff4a3a', p.hot]);
    if (p.shield > 0 && p.shieldT > 0) buffs.push(['shield', '#9a7bff', p.shieldT]);
    if (p.willT > 0) buffs.push(['ironWill', '#ffc64a', p.willT]);
    const key = buffs.map((b) => b[0]).join();
    if (key !== $('#buffs').dataset.k) { $('#buffs').dataset.k = key; $('#buffs').innerHTML = buffs.map((b) => `<div class="buff">${paintedIcon(b[0], b[1])}<b></b></div>`).join(''); }
    $('#buffs').querySelectorAll('b').forEach((el, i) => { el.textContent = Math.ceil(buffs[i][2]) + ''; });
  }
  POTIONS.forEach((pt, i) => { const s = potEls[i]; if (!s) return; const rem = Math.max(0, p.potCd[i]); s.cd.style.setProperty('--p', rem > 0 ? (1 - rem / pt.cd).toFixed(3) : '1'); const txt = rem > 0 ? Math.ceil(rem) + '' : ''; if (txt !== s.last) { s.cdt.textContent = txt; s.last = txt; } });
  slotEls.forEach((s, i) => s.s.classList.toggle('active', !!(p.cast && p.cast.i === i)));
  p.def.abilities.forEach((ab, i) => {
    const s = slotEls[i]; if (!s) return; const rem = Math.max(0, p.cds[i]), f = i === 0 || rem <= 0 ? 1 : 1 - rem / p.cdMax[i];
    s.cd.style.setProperty('--p', f.toFixed(3));
    const txt = i > 0 && rem > 0 ? (rem < 1 ? rem.toFixed(1).replace('.', ',') : Math.ceil(rem) + '') : '';
    if (txt !== s.last) { s.cdt.textContent = txt; s.last = txt; }
    s.s.classList.toggle('nomana', p.mana < ab.cost);
    const lk = !abilityUnlocked(p, i); if (lk !== s.locked) { s.locked = lk; s.s.classList.toggle('locked', lk); }
  });
  hurtK = Math.max(0, hurtK - dt * 1.8); $('#hurt').style.opacity = (hurtK + (p.hp / p.st.maxHp < 0.3 && !p.dead ? 0.25 + Math.sin(G.time * 5) * 0.12 : 0)).toFixed(3);
}

// ------------------------------------------------------------------ hero select
function buildSelectUI() {
  const list = $('#sel-list');
  list.innerHTML = HERO_ORDER.map((id) => { const h = HEROES[id]; return `<div class="hero-card panel" data-id="${id}"><div class="sig" style="background:radial-gradient(circle, ${h.css}88, #0b0908 72%)">${svgIcon(h.abilities[0].icon)}</div><div><h3>${h.name} – ${h.cls}</h3><div>${h.role}</div></div></div>`; }).join('');
  list.addEventListener('click', (e) => { const c = e.target.closest('.hero-card'); if (c) selectHero(c.dataset.id); });
  $('#sel-play').addEventListener('click', () => startGame());
  $('#end-retry').addEventListener('click', () => retry());
  $('#end-switch').addEventListener('click', () => backToSelect());
  $('#end-town').addEventListener('click', () => reviveInTown());
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sfx('click')));
}
function showHeroInfo(id) {
  const h = HEROES[id];
  $('#sel-name').textContent = h.name; $('#sel-name').style.color = h.css; $('#sel-role').textContent = `${h.cls} · ${h.role}`; $('#sel-desc').textContent = h.desc;
  $('#sel-abil').innerHTML = h.abilities.map((a, i) => `<li><span class="k">${a.key}</span><div><b>${a.name}${UNLOCK_LV[i] > 1 ? ` <small class="ul">úr. ${UNLOCK_LV[i]}</small>` : ''}</b><em>${a.desc}</em></div></li>`).join('');
  document.querySelectorAll('.hero-card').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
}
const setStatus = (t) => { $('#sel-status').textContent = t; };

// ------------------------------------------------------------------ end screen
function endGame(victory) {
  if (G.state === 'select' || !$('#end').classList.contains('hidden')) return;
  G.state = victory ? 'victory' : 'dead'; toggleInventory(false);
  const e = $('#end'); e.classList.remove('hidden'); e.classList.toggle('dead', !victory);
  $('#end-title').textContent = victory ? 'Víťazstvo!' : 'Padol si';
  $('#end-text').textContent = victory ? 'Ignarax, Ohnivý drak, padol. Dračia svätyňa je očistená a jej poklady sú tvoje.' : `${ZONES[G.zoneIndex].title} – ${ZONES[G.zoneIndex].sub} ťa tentoraz pohltila.`;
  $('#end-retry').textContent = victory ? 'Hrať znova' : 'Skúsiť znova';
  $('#end-town').classList.toggle('hidden', G.zoneIndex === TOWN_ZONE);
}

// ------------------------------------------------------------------ keys
function onKeyPress(code) {
  if (code === 'Escape') {
    if (!$('#travel').classList.contains('hidden')) { $('#travel').classList.add('hidden'); return; }
    if (SHOP.open) { closeShop(); return; }
    if (G.invOpen) { toggleInventory(false); return; }
    if (G.state === 'playing' || G.state === 'paused' || G.state === 'select') toggleSettings();
    return;
  }
  if (G.state === 'select') { if (code === 'Enter' && $('#settings').classList.contains('hidden')) startGame(); else if (code === 'ArrowLeft' || code === 'ArrowRight') { const i = HERO_ORDER.indexOf(G.heroId); selectHero(HERO_ORDER[(i + (code === 'ArrowLeft' ? 2 : 1)) % 3]); } return; }
  if (G.state !== 'playing') return;
  if (code === 'KeyF') interact();
  if (code === 'KeyQ') usePotion(0);
  if (code === 'KeyE') usePotion(1);
  if (code === 'KeyI' || code === 'Tab') toggleInventory();
  if (code === 'KeyH') { SETTINGS.showHelp = !SETTINGS.showHelp; applySettings(); saveSettings(); }
  if (code === 'KeyG') { SETTINGS.quality = (SETTINGS.quality + 2) % 3; applySettings(); saveSettings(); toast('Grafika: ' + ['nízka', 'stredná', 'vysoká'][G.quality]); }
}
// =====================================================================================
//  AUDIO – soundtrack per zone (./ost/*.mp3, crossfade) + procedurally synthesised SFX
//  (Web Audio; no sample files needed for the effects)
// =====================================================================================
const OST = {
  lobby: 'Duria - Path of Destiny - Born in the Era of Heroes (Character Creation).mp3',
  town: 'Duria - Path of Destiny - Born in the Era of Heroes (Character Creation).mp3',
  wild: 'Duria - Path of Destiny - The Source of Evil (Hagastove Grotto).mp3',
  crypt: 'Duria - Path of Destiny - They Came out of Nowhere (Darbmoor).mp3',
  sanctum: 'Duria - Path of Destiny - Save the Holy Relic (Grimmagstone).mp3',
};
const AUDIO = {
  ctx: null, master: null, music: null, sfx: null, noise: null, ready: false, track: null, els: [], cur: -1, wanted: null, last: {}, voices: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.music = c.createGain(); this.sfx = c.createGain();
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.sfx.connect(comp); comp.connect(this.master); this.music.connect(this.master); this.master.connect(c.destination);
    // shared noise buffer (2 s white noise) + a short reverb impulse for "space"
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
    const ir = c.createBuffer(2, c.sampleRate * 1.6, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const a = ir.getChannelData(ch); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 3.2); }
    this.verb = c.createConvolver(); this.verb.buffer = ir; this.verbIn = c.createGain(); this.verbIn.gain.value = 0.22; this.verbIn.connect(this.verb); this.verb.connect(this.sfx);
    for (let i = 0; i < 2; i++) { const el = new Audio(); el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; const src = c.createMediaElementSource(el), g = c.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.music); this.els.push({ el, g }); }
    this.ready = true; this.applyVolumes();
    if (this.wanted) { const w = this.wanted; this.wanted = null; this.playMusic(w); }
  },
  applyVolumes() {
    if (!this.ready) return; const s = SETTINGS, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.vMaster / 100, t, 0.05); this.music.gain.setTargetAtTime((s.vMusic / 100) * 0.55, t, 0.05); this.sfx.gain.setTargetAtTime((s.vSfx / 100) * 0.8, t, 0.05);
  },
  playMusic(key) {
    if (!this.ready) { this.wanted = key; return; }
    if (this.track === key) return; this.track = key;
    const file = OST[key]; const t = this.ctx.currentTime;
    if (this.cur >= 0) { const o = this.els[this.cur]; o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + 2.2); const el = o.el; setTimeout(() => { if (this.els[this.cur].el !== el) el.pause(); }, 2400); }
    if (!file) { this.cur = -1; return; }
    this.cur = (this.cur + 1) % 2; const n = this.els[this.cur];
    n.el.src = './ost/' + encodeURIComponent(file); n.el.currentTime = 0;
    n.el.play().catch(() => { /* file missing or blocked – stay silent */ });
    n.g.gain.cancelScheduledValues(t); n.g.gain.setValueAtTime(0, t); n.g.gain.linearRampToValueAtTime(1, t + 2.5);
  },
};
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => AUDIO.init(), { capture: true }));

// ------------------------------------------------------------------ synthesis helpers
function _env(g, t, a, peak, d, end = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); }
function _out(pan, vol, verb) {
  const c = AUDIO.ctx, g = c.createGain(); g.gain.value = vol;
  const p = c.createStereoPanner ? c.createStereoPanner() : null;
  if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(AUDIO.sfx); if (verb) p.connect(AUDIO.verbIn); } else { g.connect(AUDIO.sfx); if (verb) g.connect(AUDIO.verbIn); }
  return g;
}
function _noise(t, dur, out, o = {}) {
  const c = AUDIO.ctx, s = c.createBufferSource(); s.buffer = AUDIO.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f0 || 1000, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
  const g = c.createGain(); _env(g, t, o.a ?? 0.005, o.v ?? 1, dur);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  return f;
}
function _tone(t, dur, out, o = {}) {
  const c = AUDIO.ctx, s = c.createOscillator(); s.type = o.type || 'sine';
  s.frequency.setValueAtTime(o.f0 || 440, t); if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? dur));
  if (o.det) s.detune.value = o.det;
  const g = c.createGain(); _env(g, t, o.a ?? 0.005, o.v ?? 0.5, dur);
  let node = s;
  if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; s.connect(f); node = f; }
  if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibAmt || 12; l.connect(lg); lg.connect(s.frequency); l.start(t); l.stop(t + dur + 0.05); }
  node.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.05);
}
function _dist(amount = 30) { const c = AUDIO.ctx, ws = c.createWaveShaper(), n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) / (Math.PI + amount * Math.abs(x)); } ws.curve = curve; return ws; }

/** sound recipes: (t, out, k) – k is a 0..1 random for variation */
const SFX_LIB = {
  click: (t, o) => _tone(t, 0.06, o, { f0: 900, f1: 600, v: 0.25, type: 'triangle' }),
  // ---- Aurora
  arcaneCast: (t, o, k) => { _tone(t, 0.35, o, { f0: 330 + k * 40, f1: 880, v: 0.18, type: 'sine', vib: 9, vibAmt: 30 }); _tone(t, 0.35, o, { f0: 495, f1: 1320, v: 0.1, type: 'triangle' }); _noise(t, 0.3, o, { f0: 2000, f1: 6000, q: 2, v: 0.25, a: 0.08 }); },
  arcaneBolt: (t, o, k) => { _noise(t, 0.28, o, { f0: 600, f1: 3500, q: 3, v: 0.6 }); _tone(t, 0.25, o, { f0: 700 + k * 100, f1: 260, v: 0.25, type: 'sawtooth', lp: 2200 }); },
  arcaneHit: (t, o) => { _noise(t, 0.3, o, { f0: 1800, f1: 300, q: 1.5, v: 0.8 }); _tone(t, 0.3, o, { f0: 520, f1: 130, v: 0.35, type: 'square', lp: 1500 }); _tone(t, 0.4, o, { f0: 1500, f1: 2400, v: 0.08 }); },
  frostNova: (t, o) => { _noise(t, 0.7, o, { f0: 5000, f1: 900, q: 0.8, v: 0.7, type: 'highpass' }); for (let i = 0; i < 7; i++) _tone(t + i * 0.035, 0.6, o, { f0: 1800 + Math.random() * 2600, v: 0.09, type: 'sine' }); _tone(t, 0.5, o, { f0: 160, f1: 60, v: 0.5 }); },
  meteorRune: (t, o) => { _tone(t, 0.7, o, { f0: 110, f1: 220, v: 0.3, type: 'sawtooth', lp: 900, a: 0.2 }); _noise(t, 0.7, o, { f0: 400, f1: 2400, q: 4, v: 0.35, a: 0.3 }); },
  meteorFall: (t, o) => { _noise(t, 0.5, o, { f0: 3000, f1: 300, q: 2, v: 0.9, a: 0.25 }); _tone(t, 0.5, o, { f0: 1400, f1: 220, v: 0.12, type: 'sine', a: 0.2 }); },
  explosion: (t, o, k) => { _noise(t, 1.3, o, { type: 'lowpass', f0: 2600, f1: 120, q: 0.7, v: 1.4, a: 0.004 }); _tone(t, 0.9, o, { f0: 120 + k * 20, f1: 32, v: 1.0, type: 'sine' }); _noise(t + 0.02, 0.5, o, { f0: 4000, f1: 1200, q: 1, v: 0.3, type: 'highpass' }); },
  lightning: (t, o) => { const c = AUDIO.ctx; for (let i = 0; i < 4; i++) _noise(t + i * 0.045 + Math.random() * 0.02, 0.09, o, { type: 'highpass', f0: 2500, q: 0.7, v: 0.9 }); _tone(t, 0.35, o, { f0: 90, f1: 55, v: 0.35, type: 'sawtooth', lp: 3000 }); _noise(t, 0.5, o, { f0: 700, f1: 200, q: 1, v: 0.4 }); },
  blink: (t, o) => { _tone(t, 0.35, o, { f0: 1600, f1: 160, v: 0.22, type: 'sine', vib: 30, vibAmt: 60 }); _noise(t, 0.3, o, { f0: 5000, f1: 500, q: 6, v: 0.5 }); },
  // ---- Gwen
  swing: (t, o, k) => { _noise(t, 0.2, o, { f0: 700 + k * 300, f1: 3500, q: 2.2, v: 0.75, a: 0.03 }); },
  slashHit: (t, o, k) => { _noise(t, 0.12, o, { type: 'highpass', f0: 3000, v: 0.6 }); _tone(t, 0.18, o, { f0: 2200 + k * 600, f1: 1400, v: 0.12, type: 'triangle' }); _noise(t, 0.16, o, { type: 'lowpass', f0: 900, v: 0.7 }); },
  slamJump: (t, o) => { _noise(t, 0.4, o, { f0: 300, f1: 1400, q: 1.5, v: 0.4, a: 0.1 }); },
  slam: (t, o) => { _tone(t, 0.9, o, { f0: 95, f1: 30, v: 1.2 }); _noise(t, 1.1, o, { type: 'lowpass', f0: 1400, f1: 90, v: 1.2 }); for (let i = 0; i < 6; i++) _noise(t + 0.05 + i * 0.07, 0.12, o, { f0: 700 + Math.random() * 900, q: 3, v: 0.35 }); },
  vortex: (t, o) => { for (let i = 0; i < 8; i++) _noise(t + i * 0.3, 0.26, o, { f0: 600, f1: 2600, q: 2, v: 0.45, a: 0.08 }); _tone(t, 2.4, o, { f0: 220, f1: 240, v: 0.08, type: 'sawtooth', lp: 900, vib: 6, vibAmt: 20, a: 0.2 }); },
  roar: (t, o) => { const c = AUDIO.ctx, d = _dist(60); d.connect(o); const g = c.createGain(); g.connect(d); _env(g, t, 0.06, 0.6, 1.0); const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(110, t); s.frequency.linearRampToValueAtTime(80, t + 1.0); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 1.5; s.connect(f); f.connect(g); s.start(t); s.stop(t + 1.2); _noise(t, 1.0, o, { f0: 400, f1: 200, q: 1, v: 0.6, a: 0.05 }); _tone(t, 0.8, o, { f0: 440, f1: 880, v: 0.08, type: 'triangle', a: 0.2 }); },
  charge: (t, o) => { _noise(t, 0.35, o, { f0: 400, f1: 4000, q: 1.2, v: 0.8, a: 0.02 }); _tone(t, 0.3, o, { f0: 300, f1: 900, v: 0.12, type: 'sawtooth', lp: 1800 }); },
  // ---- Ashe
  bowShot: (t, o, k) => { _tone(t, 0.18, o, { f0: 190 + k * 30, f1: 120, v: 0.45, type: 'triangle' }); _noise(t, 0.05, o, { type: 'highpass', f0: 3000, v: 0.4 }); _noise(t + 0.02, 0.22, o, { f0: 1200, f1: 5000, q: 3, v: 0.35 }); },
  iceHit: (t, o, k) => { _noise(t, 0.2, o, { type: 'highpass', f0: 4000, v: 0.6 }); for (let i = 0; i < 3; i++) _tone(t + i * 0.02, 0.25, o, { f0: 2400 + Math.random() * 2000, v: 0.08 }); },
  volley: (t, o) => { for (let i = 0; i < 5; i++) SFX_LIB.bowShot(t + i * 0.012, o, Math.random()); },
  flare: (t, o) => { _noise(t, 0.55, o, { f0: 800, f1: 6000, q: 2, v: 0.6, a: 0.05 }); _tone(t, 0.5, o, { f0: 600, f1: 2400, v: 0.12, type: 'sine' }); },
  spear: (t, o, k) => { _noise(t, 0.08, o, { f0: 3000, f1: 800, q: 1.5, v: 0.5 }); _tone(t, 0.18, o, { f0: 2600 + k * 1500, v: 0.05 }); _noise(t, 0.15, o, { type: 'lowpass', f0: 600, v: 0.35 }); },
  hawk: (t, o) => { _tone(t, 0.5, o, { f0: 1800, f1: 2600, v: 0.18, type: 'triangle', vib: 18, vibAmt: 140 }); _tone(t + 0.25, 0.4, o, { f0: 2400, f1: 1600, v: 0.14, type: 'triangle', vib: 18, vibAmt: 140 }); _noise(t, 0.5, o, { f0: 1500, f1: 400, q: 2, v: 0.3 }); },
  wisp: (t, o) => _tone(t, 0.2, o, { f0: 1200, f1: 2200, v: 0.08, type: 'sine' }),
  roll: (t, o) => { _noise(t, 0.32, o, { f0: 300, f1: 1100, q: 1, v: 0.6, a: 0.04 }); _noise(t + 0.05, 0.4, o, { type: 'highpass', f0: 4000, v: 0.2, a: 0.1 }); },
  // ---- combat / world
  hit: (t, o, k) => { _noise(t, 0.09, o, { type: 'lowpass', f0: 1400 + k * 600, v: 0.55 }); _tone(t, 0.1, o, { f0: 180, f1: 90, v: 0.35 }); },
  crit: (t, o) => { _noise(t, 0.15, o, { type: 'highpass', f0: 2500, v: 0.5 }); _tone(t, 0.25, o, { f0: 1500, f1: 1900, v: 0.14, type: 'triangle' }); _tone(t, 0.18, o, { f0: 140, f1: 60, v: 0.5 }); },
  hurt: (t, o) => { _tone(t, 0.18, o, { f0: 150, f1: 80, v: 0.6, type: 'triangle' }); _noise(t, 0.14, o, { type: 'lowpass', f0: 800, v: 0.6 }); },
  death: (t, o, k) => { _tone(t, 0.45, o, { f0: 200 + k * 60, f1: 60, v: 0.35, type: 'sawtooth', lp: 700 }); _noise(t, 0.35, o, { type: 'lowpass', f0: 900, f1: 200, v: 0.5 }); },
  enemySwing: (t, o) => _noise(t, 0.18, o, { f0: 500, f1: 1800, q: 2, v: 0.35, a: 0.04 }),
  enemyCast: (t, o) => { _tone(t, 0.3, o, { f0: 260, f1: 140, v: 0.18, type: 'sawtooth', lp: 1200 }); _noise(t, 0.25, o, { f0: 900, f1: 400, q: 4, v: 0.3 }); },
  enemyBow: (t, o) => { _tone(t, 0.12, o, { f0: 220, f1: 150, v: 0.25, type: 'triangle' }); _noise(t, 0.15, o, { f0: 1500, f1: 3500, q: 3, v: 0.2 }); },
  darkHit: (t, o) => { _noise(t, 0.25, o, { f0: 900, f1: 200, q: 2, v: 0.6 }); _tone(t, 0.25, o, { f0: 300, f1: 100, v: 0.25, type: 'square', lp: 900 }); },
  bossRoar: (t, o) => { const c = AUDIO.ctx, d = _dist(120); d.connect(o); const g = c.createGain(); g.connect(d); _env(g, t, 0.15, 0.7, 1.8); for (const f0 of [55, 58, 82]) { const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(f0, t); s.frequency.linearRampToValueAtTime(f0 * 0.8, t + 1.9); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; s.connect(f); f.connect(g); s.start(t); s.stop(t + 2.1); } _noise(t, 1.8, o, { type: 'lowpass', f0: 900, f1: 200, v: 0.8, a: 0.2 }); },
  bossSlam: (t, o) => { SFX_LIB.slam(t, o); _tone(t, 1.4, o, { f0: 60, f1: 25, v: 1.3 }); },
  breath: (t, o) => { _noise(t, 2.0, o, { type: 'lowpass', f0: 2200, f1: 900, v: 0.9, a: 0.25 }); _noise(t, 2.0, o, { f0: 400, f1: 250, q: 1, v: 0.6, a: 0.3 }); },
  summon: (t, o) => { _tone(t, 1.0, o, { f0: 80, f1: 160, v: 0.4, type: 'sawtooth', lp: 600, a: 0.3 }); _noise(t, 1.0, o, { f0: 300, f1: 1500, q: 3, v: 0.4, a: 0.4 }); },
  // ---- ui / loot
  pickup: (t, o, k, r = 0) => { const base = [523, 587, 659, 784, 880, 1046][r]; [0, 4, 7].forEach((s, i) => _tone(t + i * 0.06, 0.35, o, { f0: base * Math.pow(2, s / 12), v: 0.12, type: 'triangle' })); if (r >= 3) _noise(t, 0.6, o, { type: 'highpass', f0: 6000, v: 0.15, a: 0.1 }); },
  rareDrop: (t, o, k, r = 3) => { const base = [0, 0, 392, 440, 523, 587][r]; [0, 7, 12, 16, 19].forEach((s, i) => _tone(t + i * 0.07, 0.6, o, { f0: base * Math.pow(2, s / 12), v: 0.1, type: 'sine', vib: 5, vibAmt: 6 })); _noise(t, 0.9, o, { type: 'highpass', f0: 5000, v: 0.12, a: 0.2 }); },
  potion: (t, o) => { for (let i = 0; i < 6; i++) _tone(t + i * 0.05, 0.08, o, { f0: 400 + Math.random() * 500, f1: 900, v: 0.1, type: 'sine' }); _tone(t + 0.25, 0.4, o, { f0: 660, f1: 990, v: 0.1, type: 'triangle' }); },
  levelUp: (t, o) => { [0, 4, 7, 12, 16].forEach((s, i) => _tone(t + i * 0.09, 0.8, o, { f0: 440 * Math.pow(2, s / 12), v: 0.13, type: 'triangle' })); _noise(t + 0.3, 1.0, o, { type: 'highpass', f0: 6000, v: 0.15, a: 0.2 }); },
  portal: (t, o) => { _tone(t, 1.6, o, { f0: 110, f1: 220, v: 0.3, type: 'sawtooth', lp: 800, a: 0.4, vib: 4, vibAmt: 8 }); _tone(t, 1.6, o, { f0: 330, f1: 660, v: 0.1, type: 'sine', a: 0.6 }); _noise(t, 1.5, o, { f0: 600, f1: 3000, q: 5, v: 0.3, a: 0.5 }); },
  teleport: (t, o) => { _tone(t, 0.8, o, { f0: 200, f1: 1200, v: 0.2, type: 'sine', vib: 12, vibAmt: 40 }); _noise(t, 0.8, o, { f0: 400, f1: 6000, q: 3, v: 0.5, a: 0.2 }); },
  deny: (t, o) => _tone(t, 0.12, o, { f0: 220, f1: 180, v: 0.2, type: 'square', lp: 900 }),
  coins: (t, o, k, r = 0) => { const n = 3 + r * 2; for (let i = 0; i < n; i++) { const tt = t + i * 0.045 + Math.random() * 0.02, f = (r === 2 ? 3200 : r === 1 ? 2700 : 2100) * (0.9 + Math.random() * 0.25); _tone(tt, 0.09 + r * 0.03, o, { f0: f, v: 0.07, type: 'sine' }); _tone(tt, 0.06, o, { f0: f * 2.76, v: 0.03, type: 'sine' }); } _noise(t, 0.08, o, { type: 'highpass', f0: 7000, v: 0.05 }); },
  key: (t, o) => { [0, 0.07, 0.15].forEach((d, i) => _tone(t + d, 0.12, o, { f0: [2400, 3000, 2600][i], v: 0.06, type: 'triangle' })); _tone(t + 0.2, 0.5, o, { f0: 1318, v: 0.06, type: 'sine', vib: 6, vibAmt: 4 }); },
  chest: (t, o) => { _noise(t, 0.45, o, { type: 'bandpass', f0: 380, f1: 900, q: 6, v: 0.25, a: 0.05 }); _tone(t + 0.02, 0.4, o, { f0: 140, f1: 220, v: 0.12, type: 'sawtooth', lp: 700 }); _tone(t + 0.42, 0.25, o, { f0: 90, f1: 50, v: 0.35, type: 'sine' }); _noise(t + 0.42, 0.18, o, { type: 'lowpass', f0: 600, v: 0.3 }); [0, 4, 7, 12, 16].forEach((s, i) => _tone(t + 0.5 + i * 0.06, 0.7, o, { f0: 784 * Math.pow(2, s / 12), v: 0.06, type: 'sine', vib: 5, vibAmt: 5 })); _noise(t + 0.5, 1.0, o, { type: 'highpass', f0: 6000, v: 0.08, a: 0.2 }); },
  shop: (t, o) => { [0, 0.06].forEach((d, i) => _tone(t + d, 0.25, o, { f0: [1568, 2093][i], v: 0.07, type: 'triangle' })); for (let i = 0; i < 4; i++) _tone(t + 0.1 + i * 0.04, 0.08, o, { f0: 2600 + Math.random() * 900, v: 0.04, type: 'sine' }); },
  unlock: (t, o) => { [0, 5, 7, 12, 17, 19, 24].forEach((s, i) => _tone(t + i * 0.07, 0.9, o, { f0: 392 * Math.pow(2, s / 12), v: 0.08, type: i % 2 ? 'sine' : 'triangle', vib: 5, vibAmt: 4 })); _noise(t, 1.4, o, { type: 'highpass', f0: 4000, v: 0.08, a: 0.4 }); },
};
/** play a sound at an optional world position (pan + distance attenuation), rate-limited per name */
function sfx(name, pos, vol = 1, extra) {
  if (!AUDIO.ready || !SFX_LIB[name] || SETTINGS.vSfx <= 0) return;
  const c = AUDIO.ctx, now = c.currentTime, gap = { hit: 0.04, crit: 0.06, iceHit: 0.05, spear: 0.035, death: 0.05, slashHit: 0.05, wisp: 0.08, enemySwing: 0.08, darkHit: 0.06, bowShot: 0.03 }[name] || 0.015;
  if (now - (AUDIO.last[name] || 0) < gap) return; AUDIO.last[name] = now;
  let pan = 0, att = 1;
  if (pos) { const d = Math.hypot(pos.x - CAM.target.x, pos.z - CAM.target.z); att = clamp(1.25 - d / 32, 0, 1); pan = clamp((pos.x - CAM.target.x) / 18, -0.85, 0.85); if (att <= 0.02) return; }
  try { SFX_LIB[name](now + 0.005, _out(pan, vol * att, true), Math.random(), extra); } catch (e) { /* never let audio break the game */ }
}
/** per-ability sounds: at cast start and at the impact frame */
const ABIL_SFX = {
  arcaneBolt: ['arcaneCast', 'arcaneBolt'], frostNova: ['arcaneCast', 'frostNova'], meteor: ['meteorRune', null], chainLightning: ['arcaneCast', 'lightning'], blink: [null, 'blink'],
  cleave: [null, 'swing'], seismicSlam: ['slamJump', 'slam'], bladeVortex: [null, 'vortex'], dragonRoar: [null, 'roar'], charge: ['charge', null],
  frostArrow: [null, 'bowShot'], volley: [null, 'volley'], arrowRain: [null, 'flare'], hawkshot: [null, 'hawk'], shadowRoll: ['roll', null],
};
// =====================================================================================
//  SETTINGS – volumes, graphics, gameplay options (saved in localStorage) + panel
// =====================================================================================
const SETTINGS_KEY = 'kroniky_popola_nastavenia_v1';
const SETTINGS = { vMaster: 80, vMusic: 60, vSfx: 85, quality: 2, shadows: true, bloom: true, shake: true, dmgNumbers: true, showFps: true, showHelp: true, autoQuality: true };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* defaults */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) { /* storage unavailable */ } }

let shadowsWere = null;
function applySettings() {
  G.quality = SETTINGS.quality;
  applyQuality();
  bloom.enabled = SETTINGS.bloom && G.quality >= 1;
  if (shadowsWere !== SETTINGS.shadows) {
    shadowsWere = SETTINGS.shadows; renderer.shadowMap.enabled = SETTINGS.shadows; sun.castShadow = SETTINGS.shadows;
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }
  $('#fps').style.display = SETTINGS.showFps ? '' : 'none';
  $('#help').classList.toggle('hidden', !SETTINGS.showHelp);
  AUDIO.applyVolumes();
}

const SETTING_ROWS = [
  { h: 'Zvuk' },
  { k: 'vMaster', t: 'Celková hlasitosť', type: 'range' },
  { k: 'vMusic', t: 'Hudba', type: 'range' },
  { k: 'vSfx', t: 'Zvukové efekty', type: 'range' },
  { h: 'Grafika' },
  { k: 'quality', t: 'Kvalita', type: 'choice', opts: ['Nízka', 'Stredná', 'Vysoká'] },
  { k: 'shadows', t: 'Tiene', type: 'bool' },
  { k: 'bloom', t: 'Žiara (bloom)', type: 'bool' },
  { k: 'autoQuality', t: 'Automaticky znížiť kvalitu pri nízkom FPS', type: 'bool' },
  { h: 'Hra' },
  { k: 'shake', t: 'Otrasy kamery', type: 'bool' },
  { k: 'dmgNumbers', t: 'Čísla poškodenia', type: 'bool' },
  { k: 'showFps', t: 'Zobraziť FPS', type: 'bool' },
  { k: 'showHelp', t: 'Nápoveda ovládania', type: 'bool' },
];
function buildSettingsUI() {
  const body = $('#set-body');
  body.innerHTML = SETTING_ROWS.map((r) => {
    if (r.h) return `<h3>${r.h}</h3>`;
    if (r.type === 'range') return `<label class="row"><span>${r.t}</span><input type="range" min="0" max="100" step="1" data-k="${r.k}"><b data-v="${r.k}"></b></label>`;
    if (r.type === 'bool') return `<label class="row"><span>${r.t}</span><button class="tog" data-k="${r.k}"></button></label>`;
    return `<div class="row"><span>${r.t}</span><div class="seg" data-k="${r.k}">${r.opts.map((o, i) => `<button data-i="${i}">${o}</button>`).join('')}</div></div>`;
  }).join('');
  body.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('input', () => { SETTINGS[el.dataset.k] = +el.value; syncSettingsUI(); applySettings(); saveSettings(); }));
  body.querySelectorAll('button.tog').forEach((el) => el.addEventListener('click', () => { SETTINGS[el.dataset.k] = !SETTINGS[el.dataset.k]; syncSettingsUI(); applySettings(); saveSettings(); sfx('click'); }));
  body.querySelectorAll('.seg button').forEach((el) => el.addEventListener('click', () => { const k = el.parentElement.dataset.k; SETTINGS[k] = +el.dataset.i; syncSettingsUI(); applySettings(); saveSettings(); sfx('click'); }));
  $('#set-close').addEventListener('click', () => toggleSettings(false));
  $('#set-resume').addEventListener('click', () => toggleSettings(false));
  $('#set-lobby').addEventListener('click', () => { toggleSettings(false); backToSelect(); });
  $('#set-town').addEventListener('click', () => { toggleSettings(false); if (G.state === 'playing' && G.zone && G.zone.def.id !== 'town') goToZone(TOWN_ZONE); });
  $('#btn-set').addEventListener('click', () => toggleSettings());
  $('#sel-settings').addEventListener('click', () => toggleSettings());
  syncSettingsUI();
}
function syncSettingsUI() {
  const body = $('#set-body');
  body.querySelectorAll('input[type=range]').forEach((el) => { el.value = SETTINGS[el.dataset.k]; el.style.setProperty('--f', SETTINGS[el.dataset.k] + '%'); });
  body.querySelectorAll('b[data-v]').forEach((el) => { el.textContent = SETTINGS[el.dataset.v] + ' %'; });
  body.querySelectorAll('button.tog').forEach((el) => { el.classList.toggle('on', !!SETTINGS[el.dataset.k]); el.textContent = SETTINGS[el.dataset.k] ? 'Zapnuté' : 'Vypnuté'; });
  body.querySelectorAll('.seg').forEach((el) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.i === SETTINGS[el.dataset.k])));
}
function toggleSettings(force) {
  const open = force !== undefined ? force : $('#settings').classList.contains('hidden');
  $('#settings').classList.toggle('hidden', !open);
  const inGame = G.state === 'playing' || G.state === 'paused';
  $('#set-ingame').classList.toggle('hidden', !inGame);
  $('#set-town').classList.toggle('hidden', !(inGame && G.zone && G.zone.def.id !== 'town'));
  if (inGame) G.state = open ? 'paused' : 'playing';
  if (open) { syncSettingsUI(); toggleInventory(false); }
  sfx('click');
}
// =====================================================================================
//  Town merchant – buy / sell rings & amulets, elixirs and chest keys; interaction prompt (F)
// =====================================================================================
const SHOP = { stock: [], open: false, sel: null, npc: null, lbl: null };
const VALUE_BASE = [25, 80, 260, 900, 3200, 9000];            // copper, by rarity
const itemValue = (it) => Math.round(VALUE_BASE[it.rarity] * (1 + 0.35 * ((it.level || 1) - 1)) * (1 + 0.04 * it.stats.length));
const buyPrice = (it) => itemValue(it) * 4;
const SHOP_GOODS = [
  { id: 'pot0', name: 'Elixír života', icon: 'potHp', color: '#ff4a3a', desc: '+1 elixír života navyše do ďalšej výpravy (najviac +5).', price: () => 40 },
  { id: 'pot1', name: 'Elixír sily', icon: 'potMp', color: '#4a8aff', desc: '+1 elixír sily navyše do ďalšej výpravy (najviac +5).', price: () => 40 },
  { id: 'key', name: 'Kľúč od truhlice', icon: 'key', color: '#ffd34a', desc: 'Otvorí jednu truhlicu v divočine.', price: () => 6 * COIN_S * Math.max(1, PROGRESS.maxTier) },
];
ICONS.key = '<circle cx="12" cy="20" r="6.5"/><path d="M18.5 20H35M30 20v6M34 20v5"/>';
ICONS.coins = '<ellipse cx="20" cy="27" rx="11" ry="4"/><ellipse cx="20" cy="21" rx="11" ry="4"/><ellipse cx="20" cy="15" rx="11" ry="4" fill="#fff" fill-opacity=".5"/>';

function shopLevel() { const p = G.player; return Math.max(1, Math.min(PROGRESS.maxTier + 1, 1 + Math.floor(((p && p.level) || 1) / 8))); }
/** merchants never sell legendary or unique items – those only come from monsters and chests */
function restockShop() {
  const lvl = shopLevel(); SHOP.stock = [];
  for (let i = 0; i < 9; i++) { const r = Math.random(), rar = r < 0.3 ? 0 : r < 0.68 ? 1 : r < 0.9 ? 2 : 3; SHOP.stock.push(makeItem(lvl, rar)); }
  SHOP.sel = null;
}

// ------------------------------------------------------------------ merchant NPC in town (model "obchodnik npc.glb" in the game folder, procedural fallback)
let npcGLTF = null, npcLoading = null;
function loadMerchantModel() {
  if (!npcLoading) npcLoading = (async () => {
    for (const url of ['./' + encodeURIComponent('obchodnik npc.glb'), './npc/' + encodeURIComponent('obchodnik npc.glb'), './models/' + encodeURIComponent('obchodnik npc.glb')]) {
      try {
        const h = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (!h.ok) continue;
        const g = await gltfLoader.loadAsync(url), mats = new Map();
        g.scene.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          const conv = (mt) => { if (!mats.has(mt)) mats.set(mt, convertUnlit(mt, [])); return mats.get(mt); };
          o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); });
        console.log('[obchodník] model načítaný –', g.animations.length, 'animácií'); return (npcGLTF = g);
      } catch (e) { console.warn('[obchodník] model sa nepodarilo načítať', e); }
    }
    return null;
  })();
  return npcLoading;
}
const NPC_ANIM = { name: 'Hwei', anim: { idle: ['Idle1_Base', 'IdleW.Hwei_13_24.anm'], run: ['RunSlow'] } };
function buildMerchantModel() {
  if (!npcGLTF) return null;
  const root = new THREE.Group(), model = SkeletonUtils.clone(npcGLTF.scene); root.add(model);
  model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model); model.scale.setScalar(2.15 / Math.max(0.01, box.max.y));
  const anim = new AnimCtl(model, npcGLTF.animations, NPC_ANIM, true); anim.setBase('idle');
  return { root, mats: [], anim, gltf: true };
}
function spawnMerchant() {
  const env = G.zone.env, m = env.merchant || G.zone.def.merchant; if (!m) return;
  const b = buildMerchantModel() || buildBiped({ skin: 0xc89070, cloth: 0x4a2050, dark: 0x24140e, eye: 0x1a0e08, hood: true, robe: true, sleeve: true, weapon: 'staff', orb: 0xffb030, scale: 1.08 });
  b.root.position.set(m[0], 0, m[1]); b.root.rotation.y = m[2] || 0; actorRoot.add(b.root);
  const sign = mkGlow(0xffc040, 1.6, 1.4); sign.position.set(m[0], 3.25, m[1]); fxRoot.add(sign);
  const lbl = document.createElement('div'); lbl.className = 'npclbl'; lbl.innerHTML = '<b>Hwei</b><small>obchodník</small>'; $('#labels').appendChild(lbl);
  SHOP.npc = { ...b, x: m[0], z: m[1], face: m[2] || 0, t: 0, sign, fidget: rand(6, 10) }; SHOP.lbl = lbl;
  G.zone.circles.push({ x: m[0], z: m[1], r: 0.6 });
  if (!SHOP.stock.length || SHOP.tier !== PROGRESS.maxTier) { SHOP.tier = PROGRESS.maxTier; restockShop(); }
}
function clearMerchant() {
  if (SHOP.npc) { actorRoot.remove(SHOP.npc.root); fxRoot.remove(SHOP.npc.sign); SHOP.npc.sign.material.dispose(); if (SHOP.npc.anim) SHOP.npc.anim.stopAll(); for (const m of SHOP.npc.mats) m.dispose(); SHOP.npc = null; }
  if (SHOP.lbl) { SHOP.lbl.remove(); SHOP.lbl = null; }
  closeShop();
}
function updateMerchant(dt) {
  const n = SHOP.npc; if (!n) return; n.t += dt; const p = G.player;
  let want = n.face; if (p && Math.hypot(p.pos.x - n.x, p.pos.z - n.z) < 7) want = Math.atan2(p.pos.x - n.x, p.pos.z - n.z);
  n.root.rotation.y += clamp(angDiff(n.root.rotation.y, want), -dt * 3, dt * 3);
  if (n.anim) {   // idle, now and then a little painting / laughing fidget
    n.fidget -= dt;
    if (n.fidget <= 0 && !n.anim.one) { n.fidget = rand(7, 12); const pick_ = pick([['WashBrush.Hwei_13_24.anm', 1.0], ['IdleVar1_loop.Hwei_13_24.anm', 1.2], ['Laugh', 1.5]]); n.anim.playOnce({ clips: [pick_[0]], at: pick_[1], after: 1 }, pick_[1]); n.relT = pick_[1] + 1.2; }
    if (n.anim.one && (n.relT -= dt) <= 0) n.anim.release();
    n.anim.update(dt);
  } else poseBiped(n.P, n.t, { walk: 0, cast: SHOP.open ? 0.25 + Math.sin(n.t * 3) * 0.1 : 0 });
  n.sign.position.y = 3.25 + Math.sin(n.t * 2) * 0.12; n.sign.material.opacity = 0.75 + Math.sin(n.t * 3) * 0.2;
  if (SHOP.lbl) { if (toScreen(n.x, 2.75, n.z, _scr)) { SHOP.lbl.style.display = ''; SHOP.lbl.style.transform = `translate(-50%,-100%) translate(${_scr.x.toFixed(1)}px,${_scr.y.toFixed(1)}px)`; } else SHOP.lbl.style.display = 'none'; }
}
const nearMerchant = () => { const n = SHOP.npc, p = G.player; return n && p && !p.dead && Math.hypot(p.pos.x - n.x, p.pos.z - n.z) < 3.9; };
function tryOpenShop() { if (!nearMerchant() || G.state !== 'playing') return false; openShop(); return true; }

// ------------------------------------------------------------------ interaction prompt (chest / merchant / teleport stone) – one key: F
function interactTarget() {
  const p = G.player; if (!p || p.dead || G.state !== 'playing') return null;
  if (G.nearChest) return { kind: 'chest', html: `<kbd>F</kbd>Otvoriť truhlicu <span class="pk">${keyIco}<b>${INV.keys | 0}</b></span>` };
  if (nearMerchant() && !SHOP.open) return { kind: 'shop', html: '<kbd>F</kbd>Obchod – Hwei' };
  if (G.zone && G.zone.def.safe) { const w = waypointPos(); if (Math.hypot(p.pos.x - w.x, p.pos.z - w.z) < 3.6 && $('#travel').classList.contains('hidden')) return { kind: 'travel', html: '<kbd>F</kbd>Teleportný kameň' }; }
  return null;
}
let promptKey = '';
function updateInteract() {
  const t = interactTarget(), pr = $('#prompt'), k = t ? t.kind + (t.kind === 'chest' ? INV.keys : '') : '';
  if (k !== promptKey) { promptKey = k; if (t) pr.innerHTML = t.html; pr.classList.toggle('hidden', !t); }
}
function interact() {
  const t = interactTarget(); if (!t) return false;
  if (t.kind === 'chest') return tryOpenChest(G.nearChest);
  if (t.kind === 'shop') return tryOpenShop();
  if (t.kind === 'travel') return tryOpenTravel();
  return false;
}

// ------------------------------------------------------------------ shop window
function openShop() {
  SHOP.open = true; SHOP.sel = null; if (!SHOP.stock.length) restockShop();
  const n = SHOP.npc; if (n && n.anim) { n.anim.playOnce({ clips: ['Laugh', 'Taunt'], at: 1.2, after: 1 }, 1.2); n.relT = 2.6; n.fidget = rand(8, 12); }
  $('#shop').classList.remove('hidden'); toggleInventory(false); renderShop(); sfx('shop'); promptKey = '';
}
function closeShop() { if (!SHOP.open) return; SHOP.open = false; $('#shop').classList.add('hidden'); hideTip(); promptKey = ''; }
function goodsCell(g, i) {
  const extra = g.id === 'key' ? INV.keys | 0 : (INV.extraPot || [0, 0])[+g.id.slice(3)] | 0;
  return `<div class="cell has good ${SHOP.sel && SHOP.sel.good === i ? 'sel' : ''}" data-good="${i}" style="--rc:${g.color}"><div class="gi">${paintedIcon(g.icon, g.color)}</div><span class="cnt">${extra || ''}</span></div>`;
}
function renderShop() {
  if (!SHOP.open) return;
  $('#shop-stock').innerHTML = SHOP.stock.map((it, i) => it ? `<div class="cell has ${SHOP.sel && SHOP.sel.stock === i ? 'sel' : ''}" data-stock="${i}" style="--rc:${RARITY[it.rarity].css}">${itemIcon(it)}<span class="pr">${fmtCoins(buyPrice(it), false)}</span></div>` : '<div class="cell sold"></div>').join('');
  $('#shop-goods').innerHTML = SHOP_GOODS.map(goodsCell).join('');
  $('#shop-bag').innerHTML = INV.bag.map((it, i) => it ? `<div class="cell has ${SHOP.sel && SHOP.sel.bag === i ? 'sel' : ''}" data-sbag="${i}" style="--rc:${RARITY[it.rarity].css}">${itemIcon(it)}</div>` : '<div class="cell"></div>').join('');
  renderPurse();
  const s = SHOP.sel, box = $('#shop-sel');
  if (!s) { box.innerHTML = '<span class="muted">Vyber predmet – vľavo tovar na kúpu, vpravo tvoje predmety na predaj.</span>'; return; }
  let name, color, lines = '', price, verb, can = true;
  if (s.stock !== undefined) { const it = SHOP.stock[s.stock]; name = it.name; color = RARITY[it.rarity].css; lines = it.stats.map(([k, v]) => fmtStat(k, v)).join('<br>'); price = buyPrice(it); verb = 'Kúpiť'; can = INV.coins >= price && INV.bag.includes(null); }
  else if (s.good !== undefined) { const g = SHOP_GOODS[s.good]; name = g.name; color = g.color; lines = g.desc; price = g.price(); verb = 'Kúpiť'; can = INV.coins >= price && (g.id === 'key' || ((INV.extraPot || [0, 0])[+g.id.slice(3)] | 0) < 5); }
  else { const it = INV.bag[s.bag]; if (!it) { SHOP.sel = null; return renderShop(); } name = it.name; color = RARITY[it.rarity].css; lines = it.stats.map(([k, v]) => fmtStat(k, v)).join('<br>'); price = itemValue(it); verb = 'Predať'; }
  box.innerHTML = `<div class="si"><b style="color:${color}">${name}</b><div class="st">${lines}</div></div><button id="shop-act" class="btn ${verb === 'Predať' ? 'sell' : ''}" ${can ? '' : 'disabled'}>${verb} za ${fmtCoins(price)}</button>`;
  $('#shop-act').onclick = () => (verb === 'Kúpiť' ? (s.good !== undefined ? buyGood(s.good) : buyItem(s.stock)) : sellItem(s.bag));
}
function buyItem(i) {
  const it = SHOP.stock[i], slot = INV.bag.indexOf(null); if (!it) return;
  const price = buyPrice(it); if (INV.coins < price) { sfx('deny'); toast('Nemáš dosť peňazí'); return; } if (slot < 0) { sfx('deny'); toast('Inventár je plný'); return; }
  INV.coins -= price; INV.bag[slot] = it; SHOP.stock[i] = null; SHOP.sel = { bag: slot }; sfx('coins', null, 0.8, 1); sfx('pickup', null, 0.7, it.rarity);
  toast(`Kúpené: ${it.name}`, RARITY[it.rarity].css); saveInv(); renderInventory(); renderShop();
}
function buyGood(i) {
  const g = SHOP_GOODS[i], price = g.price(); if (INV.coins < price) { sfx('deny'); toast('Nemáš dosť peňazí'); return; }
  if (g.id === 'key') INV.keys = (INV.keys | 0) + 1;
  else { INV.extraPot = INV.extraPot || [0, 0]; const k = +g.id.slice(3); if ((INV.extraPot[k] | 0) >= 5) { sfx('deny'); toast('Viac sa ich neunesieš'); return; } INV.extraPot[k] = (INV.extraPot[k] | 0) + 1; }
  INV.coins -= price; sfx('coins', null, 0.8, 1); toast(`Kúpené: ${g.name}`, g.color); saveInv(); renderShop();
}
function sellItem(i) {
  const it = INV.bag[i]; if (!it) return; const v = itemValue(it);
  INV.bag[i] = null; INV.coins = (INV.coins | 0) + v; SHOP.sel = null; sfx('coins', null, 0.9, it.rarity >= 2 ? 2 : 1);
  toast(`Predané: ${it.name} (+${fmtCoins(v, false)})`, RARITY[it.rarity].css); saveInv(); renderInventory(); renderShop();
}
function sellAllUpTo(maxR) {
  let n = 0, sum = 0; INV.bag.forEach((it, i) => { if (it && it.rarity <= maxR) { sum += itemValue(it); INV.bag[i] = null; n++; } });
  if (!n) { sfx('deny'); toast('Nie je čo predať'); return; }
  INV.coins = (INV.coins | 0) + sum; SHOP.sel = null; sfx('coins', null, 1, 2); toast(`Predaných ${n} predmetov za ${fmtCoins(sum, false)}`, '#ffd34a'); saveInv(); renderInventory(); renderShop();
}
function shopTip(el, x, y) {
  const c = el.closest && el.closest('.cell'); if (!c || !c.classList.contains('has')) { hideTip(); return; }
  if (c.dataset.good !== undefined) { const g = SHOP_GOODS[+c.dataset.good], tip = $('#tip'); tip.innerHTML = `<h4 style="color:${g.color}">${g.name}</h4><div class="st">${g.desc}</div><div class="cmp">Cena: ${fmtCoins(g.price())}</div>`; tip.style.display = 'block'; placeTip(tip, x, y); return; }
  const ref = c.dataset.stock !== undefined ? { it: SHOP.stock[+c.dataset.stock] } : { it: INV.bag[+c.dataset.sbag], bag: +c.dataset.sbag };
  if (!ref.it) return; showTip(ref, x, y);
  const tip = $('#tip'); tip.insertAdjacentHTML('beforeend', `<div class="cmp">${ref.bag !== undefined ? 'Predajná cena' : 'Cena'}: ${fmtCoins(ref.bag !== undefined ? itemValue(ref.it) : buyPrice(ref.it))}</div>`); placeTip(tip, x, y);
}
function placeTip(tip, x, y) { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 18)) + 'px'; tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, y - 10)) + 'px'; }
function initShopUI() {
  const sh = $('#shop');
  sh.addEventListener('click', (e) => {
    const c = e.target.closest && e.target.closest('.cell.has'); if (!c) return; sfx('click');
    if (c.dataset.stock !== undefined) SHOP.sel = { stock: +c.dataset.stock }; else if (c.dataset.good !== undefined) SHOP.sel = { good: +c.dataset.good }; else if (c.dataset.sbag !== undefined) SHOP.sel = { bag: +c.dataset.sbag };
    renderShop();
  });
  sh.addEventListener('dblclick', (e) => { const c = e.target.closest && e.target.closest('.cell.has'); if (!c) return; if (c.dataset.stock !== undefined) buyItem(+c.dataset.stock); else if (c.dataset.sbag !== undefined) sellItem(+c.dataset.sbag); else if (c.dataset.good !== undefined) buyGood(+c.dataset.good); });
  sh.addEventListener('mousemove', (e) => shopTip(e.target, e.clientX, e.clientY));
  sh.addEventListener('mouseleave', hideTip);
  $('#shop-close').addEventListener('click', () => { sfx('click'); closeShop(); });
  $('#shop-sell0').addEventListener('click', () => sellAllUpTo(0));
  $('#shop-sell1').addEventListener('click', () => sellAllUpTo(1));
  $('#shop-restock').addEventListener('click', () => {
    const fee = 25 * Math.max(1, PROGRESS.maxTier); if (INV.coins < fee) { sfx('deny'); toast('Nemáš dosť peňazí'); return; }
    INV.coins -= fee; saveInv(); restockShop(); sfx('shop'); renderShop();
  });
  $('#shop-restock').title = 'Hwei prinesie nový tovar';
  $('#prompt').addEventListener('click', () => interact());
}
// =====================================================================================
//  Late abilities – keys 3 / 4 / 5, unlocked at levels 21 / 26 / 32
//  Unlock order of the whole bar: ĽTM 1 · PTM 2 · [1] 4 · [2] 8 · Medzerník 12 · [3] 21 · [4] 26 · [5] 32
// =====================================================================================
const UNLOCK_LV = [1, 2, 4, 8, 12, 21, 26, 32];
const abilityUnlocked = (p, i) => p.level >= (UNLOCK_LV[i] || 1);
const LATE_ABILITIES = {
  aurora: [
    { key: '3', icon: 'frozenOrb', name: 'Mrazivá guľa', desc: 'Pomalá guľa ľadu, ktorá cestou chrlí ľadové črepiny na všetky strany a na konci vybuchne do mraziacej novy.', cd: 9, cost: 40, cast: 0.5, impact: 0.22, fn: 'frozenOrb', anim: { clips: ['Spell4'], kw: 'cast', at: 0.4, after: 0.35 } },
    { key: '4', icon: 'shield', name: 'Arkánová bariéra', desc: 'Šesťhranný štít pohltí poškodenie rovné 35 % života. Keď zanikne, odhodí nepriateľov arkánovým výbojom.', cd: 18, cost: 35, cast: 0.45, impact: 0.2, fn: 'arcaneShield', anim: { clips: ['Spell2'], kw: 'cast', at: 0.42, after: 0.4 } },
    { key: '5', icon: 'starfall', name: 'Hviezdna búrka', desc: 'Z oblohy dopadá roj arkánových komét do veľkého kruhu a na konci ho rozžiari obrovský výbuch.', cd: 40, cost: 70, cast: 0.75, impact: 0.36, fn: 'starfall', anim: { clips: ['Spell1_Recast', 'Spell2'], kw: 'cast', at: 0.5, after: 0.4 } },
  ],
  gwen: [
    { key: '3', icon: 'fissure', name: 'Rozštiepenie zeme', desc: 'Úder, ktorý roztrhne zem v dlhej línii. Skalné hroty vyhodia a omráčia všetkých v ceste.', cd: 9, cost: 30, cast: 0.6, impact: 0.3, fn: 'fissure', anim: { clips: ['Spell1_C.anm', 'Crit'], kw: 'attack', at: 0.35, after: 0.45 } },
    { key: '4', icon: 'ironWill', name: 'Neochvejná vôľa', desc: 'Na 6 s polovičné poškodenie, imunita voči odhodeniu a postupné liečenie. Okolití nepriatelia zamrznú od strachu.', cd: 22, cost: 30, cast: 0.5, impact: 0.24, fn: 'ironWill', anim: { clips: ['Spell4.anm', 'Spell2'], kw: 'cast', at: 0.4, after: 0.3 } },
    { key: '5', icon: 'dawnBlade', name: 'Meč úsvitu', desc: 'Z nebies sa zrúti obrovský zlatý meč. Dopad ničí a omráči, meč potom ešte 3 s pulzuje svetlom.', cd: 40, cost: 60, cast: 0.8, impact: 0.38, fn: 'dawnBlade', anim: { clips: ['Spell4_0', 'Spell2'], kw: 'cast', at: 0.7, after: 0.35 } },
  ],
  ashe: [
    { key: '3', icon: 'pierce', name: 'Prierazný šíp', desc: 'Nabitý šíp preletí celým bojiskom a zraní každého nepriateľa v línii.', cd: 8, cost: 28, cast: 0.62, impact: 0.36, track: true, fn: 'piercingShot', anim: { clips: ['Crit', 'Attack2'], kw: 'attack', at: 0.5, after: 0.45 } },
    { key: '4', icon: 'arrowRing', name: 'Kruh šípov', desc: 'Ashe vystrelí do kruhu 20 mrazivých šípov a odrazí nepriateľov od seba.', cd: 14, cost: 34, cast: 0.45, impact: 0.2, fn: 'arrowRing', anim: { clips: ['Attack2', 'Spell2'], kw: 'attack', at: 0.35, after: 0.5 } },
    { key: '5', icon: 'crystal', name: 'Kryštálový šíp', desc: 'Obrovský kryštálový šíp letí cez celú mapu. Prvého zasiahnutého zmrazí (čím ďalej, tým dlhšie) a vybuchne.', cd: 40, cost: 60, cast: 0.8, impact: 0.42, track: true, fn: 'crystalArrow', anim: { clips: ['Spell4'], kw: 'cast', at: 0.75, after: 0.35 } },
  ],
};
for (const id in LATE_ABILITIES) if (HEROES[id] && HEROES[id].abilities.length < 8) HEROES[id].abilities.push(...LATE_ABILITIES[id]);
Object.assign(ICONS, {
  frozenOrb: '<circle cx="20" cy="20" r="7" fill="#fff"/><path d="M20 4v8M20 28v8M4 20h8M28 20h8M8.7 8.7l5.6 5.6M25.7 25.7l5.6 5.6M8.7 31.3l5.6-5.6M25.7 14.3l5.6-5.6"/>',
  shield: '<path d="M20 4l13 7.5v15L20 34 7 26.5v-15z"/><path d="M20 11l6.5 3.8v7.4L20 26l-6.5-3.8v-7.4z" fill="#fff" fill-opacity=".5"/>',
  starfall: '<path d="M27 6l2 5 5 .5-4 3 1.5 5-4.5-3-4.5 3 1.5-5-4-3 5-.5z" fill="#fff"/><path d="M6 14l10 10M4 22l9 9M12 8l9 9"/><circle cx="10" cy="31" r="3"/>',
  fissure: '<path d="M4 34l7-6 3 3 6-8 3 4 6-9 3 3 4-7"/><path d="M14 20l-3-7M23 18l1-8M31 14l3-6"/>',
  ironWill: '<path d="M20 4l12 5v9c0 8-5 13-12 16C13 31 8 26 8 18V9z"/><path d="M14 19l4 4 8-9"/>',
  dawnBlade: '<path d="M20 3l3 5v18h-6V8z" fill="#fff" fill-opacity=".6"/><path d="M11 26h18M20 26v8M17 36h6"/><path d="M6 10l4 2M34 10l-4 2M8 4l3 4M32 4l-3 4"/>',
  pierce: '<path d="M4 20h28M27 14l7 6-7 6"/><path d="M4 16l4 4-4 4M10 15v10M16 15v10" stroke-opacity=".7"/>',
  arrowRing: '<circle cx="20" cy="20" r="5" fill="#fff"/><path d="M20 3v9M20 28v9M3 20h9M28 20h9M8 8l6 6M26 26l6 6M8 32l6-6M26 14l6-6"/>',
  crystal: '<path d="M5 20l7-5h16l7 5-7 5H12z" fill="#fff" fill-opacity=".55"/><path d="M12 15l4 5-4 5M28 15l-4 5 4 5M2 20h4"/>',
});

const _o3 = new V3();
const swordPool = [], cometPool = [];
function buildComet() {
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo('comet', () => new THREE.IcosahedronGeometry(0.42, 1)), basicHdr(0xe8e0ff, 3)), mkGlow(0x8a5cff, 2.8, 3.6)); return g;
}
function buildDawnSword() {
  const g = new THREE.Group(), gold = basicHdr(0xffd070, 2.2), white = basicHdr(0xfff6e0, 3);
  const blade = new THREE.Mesh(geo('dsblade', () => { const s = new THREE.Shape(); s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0.42, 8.2); s.lineTo(0, 9.6); s.lineTo(-0.42, 8.2); s.closePath();
    const gg = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 1 }); gg.translate(0, 0, -0.08); return gg; }), white);
  blade.rotation.z = Math.PI; blade.position.y = 0;            // tip points down
  const guard = new THREE.Mesh(geo('dsguard', () => new THREE.BoxGeometry(3.4, 0.38, 0.5)), gold); guard.position.y = 0.2;
  const grip = new THREE.Mesh(geo('dsgrip', () => new THREE.CylinderGeometry(0.17, 0.2, 2.2, 8)), gold); grip.position.y = 1.5;
  const pommel = new THREE.Mesh(geo('dspom', () => new THREE.OctahedronGeometry(0.45, 0)), white); pommel.position.y = 2.8;
  const glow = mkGlow(0xffc040, 2.6, 9); glow.position.y = -3.5;
  g.add(blade, guard, grip, pommel, glow); g.userData.glow = glow; return g;
}
const freezeArea = (x, z, R, dmg, sec) => { for (const e of enemiesIn(x, z, R)) damageEnemy(e, dmg, { freeze: sec }); };
function frostBlast(x, z, R, int = 1) {
  ringFx(x, z, { tex: TEX.frost, color: 0x7fc4ff, r0: 1, r1: R, dur: 0.35, int: 0.9, hold: 0.6, keep: true });
  ringFx(x, z, { color: 0xe8f8ff, r0: 0.5, r1: R + 0.8, dur: 0.34, int: 3 * int });
  flash(x, 1.2, z, 0x9fdcff, R * 1.6, 0.35); flashLight(x, 2.5, z, 0x7fc8ff, 150 * int, R * 3, 0.55); shake(0.35 * int);
  burst(x, 0.5, z, { n: Math.round(70 * int), color: 0xdff4ff, color2: 0x6fc0ff, int: 2.6, up: 1.4, s0: 6, s1: 20, size: 0.4, l0: 0.25, l1: 0.65, grav: 10 });
  burst(x, 0.3, z, { n: 14, smoke: true, color: 0xcfeaff, int: 1, flat: true, s0: 3, s1: 9, size: 1.5, size1: 3.5, l0: 0.5, l1: 1.0, r: 2 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, m = getShard('ice'); let t = 0; const r0 = R * rand(0.45, 0.85), h = rand(1.4, 2.6) * int;
    m.position.set(x + Math.cos(a) * r0, -0.1, z + Math.sin(a) * r0); m.rotation.set(randS(0.4), rand(TAU), randS(0.4));
    addFx((dt) => { t += dt; const k = easeOut(Math.min(1, t / 0.18)), f = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1; m.scale.set(0.7, h * k * f + 0.01, 0.7); m.material.opacity = 0.8 * f; return t < 1; }, () => freeShard(m)); }
}

Object.assign(ABIL, {
  // =============================== AURORA ===============================
  frozenOrb: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.3, 1.6);
      const orb = new THREE.Group(), core = new THREE.Mesh(geo('fo_core', () => new THREE.IcosahedronGeometry(0.55, 2)), basicHdr(0xe8f8ff, 3)), gl = mkGlow(0x6fc8ff, 2.8, 5.5);
      const rm = new THREE.MeshBasicMaterial({ color: hdr(0x9fe8ff, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const r1 = new THREE.Mesh(geo('pring', () => new THREE.TorusGeometry(0.46, 0.035, 6, 24)), rm), r2 = new THREE.Mesh(geo('pring', () => new THREE.TorusGeometry(0.46, 0.035, 6, 24)), rm); r1.scale.setScalar(2.3); r2.scale.setScalar(1.8); r2.rotation.x = 1.2;
      orb.add(core, gl, r1, r2); orb.position.copy(_mz); fxRoot.add(orb);
      const L = getLight(0x7fd8ff, 80, 16), dx = c.dir.x, dz = c.dir.z, speed = 7.5, life = 2.6; let t = 0, shot = 0, ang = rand(TAU), tick = 0;
      flash(_mz.x, _mz.y, _mz.z, 0x9fe8ff, 4, 0.25);
      addFx((dt) => {
        t += dt; orb.position.x += dx * speed * dt; orb.position.z += dz * speed * dt;
        r1.rotation.x += dt * 3; r1.rotation.y += dt * 5; r2.rotation.z += dt * 6; core.rotation.y += dt * 4; core.scale.setScalar(1 + Math.sin(t * 18) * 0.08);
        if (L) L.position.copy(orb.position);
        shot -= dt;
        if (shot <= 0) { shot = 0.08; ang += 2.39;
          for (let k = 0; k < 2; k++) { const a = ang + k * Math.PI; spawnProjectile({ kind: 'frost', x: orb.position.x, y: 1.5, z: orb.position.z, dx: Math.cos(a), dz: Math.sin(a), speed: 24, dmg: 14, team: 'player', range: 8, radius: 0.4, noLight: true, hit: { slow: 0.4, slowT: 2 } }); }
          if (Math.random() < 0.4) sfx('iceHit', orb.position, 0.25);
        }
        tick -= dt; if (tick <= 0) { tick = 0.25; for (const e of enemiesIn(orb.position.x, orb.position.z, 2.2)) damageEnemy(e, 22, { slow: 0.5, slowT: 2 }); }
        for (let i = 0; i < 3; i++) sparks.emit(orb.position.x + randS(0.5), orb.position.y + randS(0.5), orb.position.z + randS(0.5), randS(1), rand(-0.5, 1.5), randS(1), rgb(0xcff4ff, 2.5), rand(0.3, 0.7), 0.3, 0, 1, 0);
        if (Math.random() < 0.5) smoke.emit(orb.position.x, orb.position.y, orb.position.z, 0, 0.3, 0, rgb(0xbfe6ff, 1), rand(0.5, 0.9), 1, 2.4, 1, 0);
        return t < life && !p.dead;
      }, () => {
        const x = orb.position.x, z = orb.position.z; fxRoot.remove(orb); rm.dispose(); freeLight(L);
        sfx('frostNova', { x, z }, 1); frostBlast(x, z, 5.2, 1); freezeArea(x, z, 5.2, 70, 1.6);
      });
    },
  },
  arcaneShield: {
    fire(p) {
      const amt = Math.round(p.st.maxHp * 0.35); p.shield = amt; p.shieldMax = amt; p.shieldT = 6;
      const mat = new THREE.MeshBasicMaterial({ color: hdr(0x8f6bff, 1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const wire = new THREE.LineSegments(geo('shwire', () => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.75, 1))), new THREE.LineBasicMaterial({ color: hdr(0xc8b8ff, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ball = new THREE.Mesh(geo('shball', () => new THREE.IcosahedronGeometry(1.7, 2)), mat), g = new THREE.Group(); g.add(ball, wire); fxRoot.add(g);
      const L = getLight(0x9a6bff, 40, 10); let t = 0;
      ringFx(p.pos.x, p.pos.z, { tex: TEX.rune, color: 0x8f6bff, r0: 3, r1: 1.5, dur: 0.4, spin: 3, int: 2.4 }); flash(p.pos.x, 1.2, p.pos.z, 0xb894ff, 5, 0.3);
      burst(p.pos.x, 1.2, p.pos.z, { n: 40, color: 0xc8b8ff, color2: 0x6a4cff, int: 2.6, s0: 2, s1: 8, size: 0.32, l0: 0.3, l1: 0.7, h: 1.2 });
      addFx((dt) => {
        t += dt; const alive = p.shieldT > 0 && p.shield > 0 && !p.dead, k = Math.min(1, t / 0.2), hitF = p.shieldHit || 0; p.shieldHit = Math.max(0, hitF - dt * 4);
        g.position.set(p.pos.x, 1.15, p.pos.z); g.rotation.y += dt * 0.8; wire.rotation.x += dt * 0.3; g.scale.setScalar(k * (1 + hitF * 0.08));
        mat.opacity = (0.22 + 0.12 * (p.shield / p.shieldMax) + hitF * 0.4) * k; wire.material.opacity = 0.7 + hitF * 0.3;
        if (L) { L.position.copy(g.position); L.intensity = 30 + hitF * 60; }
        return alive;
      }, () => {
        const x = p.pos.x, z = p.pos.z; fxRoot.remove(g); mat.dispose(); wire.material.dispose(); freeLight(L); p.shield = 0; p.shieldT = 0;
        if (p.dead) return;
        sfx('arcaneHit', { x, z }, 1.2); ringFx(x, z, { color: 0xb894ff, r0: 1, r1: 7, dur: 0.4, int: 3 }); flash(x, 1.2, z, 0x9a6bff, 8, 0.3); shake(0.3);
        burst(x, 1.2, z, { n: 50, color: 0xd8ccff, color2: 0x6a4cff, int: 2.8, s0: 6, s1: 18, size: 0.35, l0: 0.2, l1: 0.5, h: 1 });
        for (const e of enemiesIn(x, z, 6.5)) damageEnemy(e, 60, { kb: 9, from: { x, z } });
      });
    },
  },
  starfall: {
    fire(p, c) {
      const d = Math.min(18, dist2D(p.pos, c.aim)), tx = p.pos.x + c.dir.x * d, tz = p.pos.z + c.dir.z * d, R = 9, N = 18, dur = 2.4;
      ringFx(tx, tz, { tex: TEX.rune, color: 0x9a6bff, r0: 2, r1: R, dur: 0.45, spin: 1.2, int: 2.2, keep: true, hold: dur, fadeIn: true });
      ringFx(tx, tz, { tex: TEX.glow, color: 0x5a3cff, r0: R * 0.6, r1: R * 1.4, dur: 0.6, int: 0.8, keep: true, hold: dur, fadeIn: true });
      beamFx(tx, tz, 0xb894ff, 3, 30, 0.6, 1.8); const L = getLight(0x9a6bff, 70, 30); if (L) L.position.set(tx, 6, tz);
      for (let i = 0; i < N; i++) after(0.25 + i * (dur / N) + rand(0.05), () => {
        let x, z; const inside = enemiesIn(tx, tz, R);
        if (inside.length && Math.random() < 0.55) { const e = pick(inside); x = e.pos.x + randS(0.8); z = e.pos.z + randS(0.8); } else { const a = rand(TAU), r = Math.sqrt(Math.random()) * (R - 1); x = tx + Math.cos(a) * r; z = tz + Math.sin(a) * r; }
        const cm = cometPool.pop() || buildComet(), sx = x - 7, sy = 24, sz = z - 5; let t = 0; fxRoot.add(cm);
        addFx((dt) => { t += dt; const k = Math.min(1, t / 0.32), kk = k * k; cm.position.set(lerp(sx, x, kk), lerp(sy, 0.5, kk), lerp(sz, z, kk));
          for (let j = 0; j < 3; j++) sparks.emit(cm.position.x + randS(0.3), cm.position.y + randS(0.3), cm.position.z + randS(0.3), randS(1), rand(1, 3), randS(1), rgb(Math.random() < 0.4 ? 0xffffff : 0x9a7bff, 2.8), rand(0.2, 0.5), 0.9, 0, 1, 0);
          return t < 0.32; }, () => {
          fxRoot.remove(cm); cometPool.push(cm);
          flash(x, 1, z, 0xb894ff, 6, 0.25); ringFx(x, z, { color: 0xd8ccff, r0: 0.3, r1: 3.2, dur: 0.3, int: 2.5 }); scorch(x, z, 1.8, 3);
          burst(x, 0.4, z, { n: 26, color: 0xd8ccff, color2: 0x6a4cff, int: 2.8, up: 1.8, s0: 3, s1: 12, size: 0.35, l0: 0.25, l1: 0.6, grav: 14 });
          if (i % 3 === 0) { shake(0.2); flashLight(x, 2, z, 0x9a6bff, 70, 12, 0.25); } sfx('arcaneHit', { x, z }, 0.6);
          for (const e of enemiesIn(x, z, 2.6)) damageEnemy(e, 75, { stun: 0.3, kb: 2, from: { x, z } });
        });
      });
      after(0.35 + dur, () => {
        freeLight(L); hitStop(0.08); shake(1); sfx('explosion', { x: tx, z: tz }, 1.2);
        flash(tx, 1.5, tz, 0xd8ccff, R * 2.4, 0.45, 4); beamFx(tx, tz, 0xb894ff, 5, 26, 0.5, 3); flashLight(tx, 3, tz, 0x9a6bff, 240, 34, 0.6);
        ringFx(tx, tz, { color: 0xffffff, r0: 1, r1: R + 2, dur: 0.45, int: 3.5 }); ringFx(tx, tz, { color: 0x8f6bff, r0: 0.5, r1: R + 4, dur: 0.6, int: 2.4, delay: 0.06 });
        burst(tx, 0.5, tz, { n: 120, color: 0xd8ccff, color2: 0x6a4cff, int: 3.2, up: 2, s0: 6, s1: 26, size: 0.5, l0: 0.3, l1: 1.0, grav: 12, r: 2 });
        for (const e of enemiesIn(tx, tz, R)) damageEnemy(e, 160, { kb: 9, stun: 0.8, from: { x: tx, z: tz } });
      });
    },
  },

  // =============================== GWEN ===============================
  fissure: {
    fire(p, c) {
      const f = Math.atan2(c.dir.x, c.dir.z), seen = new Set(), N = 14, x0 = p.pos.x, z0 = p.pos.z, dx = c.dir.x, dz = c.dir.z;
      slashFx(x0, z0, f, { r: 3.6, arc: 1.6, color: 0xffb830, color2: 0xfff0c0, dur: 0.2, int: 2.4, tilt: 0.6 }); shake(0.5); hitStop(0.05);
      for (let i = 0; i < N; i++) after(i * 0.032, () => {
        const dd = 1.6 + i * 1.1, x = x0 + dx * dd + randS(0.25), z = z0 + dz * dd + randS(0.25);
        rockRing(x, z, 0.55, 4, 1.4 + (i % 3) * 0.3, 0, 0xffb040);
        ringFx(x, z, { tex: TEX.cracks, color: 0xffc64a, int: 2.4, r0: 1.4, r1: 1.4, dur: 1.2, linear: true });
        burst(x, 0.3, z, { n: 12, color: 0xffc64a, color2: 0xffe9a8, int: 2.4, up: 2.2, s0: 2, s1: 8, size: 0.32, l0: 0.25, l1: 0.6, grav: 18 });
        burst(x, 0.3, z, { n: 4, smoke: true, color: 0x6a5c4c, int: 1, up: 1, s0: 1, s1: 3, size: 1.2, size1: 2.6, l0: 0.5, l1: 1.0 });
        if (i % 4 === 0) { flashLight(x, 1.5, z, 0xffb840, 60, 10, 0.25); sfx('slam', { x, z }, 0.45); }
        for (const e of enemiesIn(x, z, 1.9)) { if (seen.has(e)) continue; seen.add(e); damageEnemy(e, 95, { stun: 1.1, kb: 3, from: { x: x0, z: z0 } }); impactFx(e.pos.x, 1.2, e.pos.z, 0xffc64a, 1.1); }
      });
    },
  },
  ironWill: {
    fire(p) {
      const x = p.pos.x, z = p.pos.z; p.willT = 6; p.hot = Math.max(p.hot, 6); p.hotRate = p.st.maxHp * 0.3 / 6;
      ringFx(x, z, { color: 0xffd070, r0: 0.5, r1: 9, dur: 0.5, int: 3 }); beamFx(x, z, 0xffc64a, 2.6, 12, 0.6, 2.2); flash(x, 1.5, z, 0xffd070, 9, 0.35); shake(0.4);
      burst(x, 0.2, z, { n: 60, color: 0xffc64a, color2: 0xfff0c0, int: 3, up: 2.4, s0: 3, s1: 12, size: 0.38, l0: 0.4, l1: 0.9, r: 1.4 });
      for (const e of enemiesIn(x, z, 9)) { damageEnemy(e, 15, { stun: 1.2 }); burst(e.pos.x, e.def.h + 0.3, e.pos.z, { n: 6, color: 0xffd070, int: 2.4, s0: 1, s1: 3, size: 0.25, l0: 0.4, l1: 0.8 }); }
      const rune = getFlat(TEX.rune, 0xffb830, 1.8), shields = [];
      const smat = new THREE.MeshBasicMaterial({ color: hdr(0xffd070, 2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(geo('wshield', () => { const sh = new THREE.Shape(); sh.moveTo(0, 0.55); sh.lineTo(0.42, 0.38); sh.lineTo(0.38, -0.1); sh.quadraticCurveTo(0.3, -0.45, 0, -0.62); sh.quadraticCurveTo(-0.3, -0.45, -0.38, -0.1); sh.lineTo(-0.42, 0.38); sh.closePath(); return new THREE.ShapeGeometry(sh); }), smat); fxRoot.add(s); shields.push(s); }
      let t = 0;
      addFx((dt) => {
        t += dt; const k = Math.min(1, t / 0.25, Math.max(0, p.willT) / 0.4);
        rune.position.set(p.pos.x, 0.06, p.pos.z); rune.rotation.y += dt * 1.2; rune.scale.set(3.2 * k, 1, 3.2 * k); rune.material.opacity = 0.8 * k;
        shields.forEach((s, i) => { const a = t * 2.2 + i * TAU / 3; s.position.set(p.pos.x + Math.cos(a) * 1.5, 1.3 + Math.sin(t * 3 + i) * 0.15, p.pos.z + Math.sin(a) * 1.5); s.rotation.y = -a + Math.PI / 2; s.scale.setScalar(k); });
        smat.opacity = 0.85 * k;
        if (Math.random() < dt * 20) sparks.emit(p.pos.x + randS(0.8), rand(0.2, 2), p.pos.z + randS(0.8), 0, rand(1, 3), 0, rgb(0xffd070, 2.4), rand(0.4, 0.8), 0.25, 0, 0.5, 0);
        return p.willT > 0 && !p.dead;
      }, () => { freeFlat(rune); for (const s of shields) fxRoot.remove(s); smat.dispose(); });
    },
  },
  dawnBlade: {
    fire(p, c) {
      const d = Math.min(14, dist2D(p.pos, c.aim)), tx = p.pos.x + c.dir.x * d, tz = p.pos.z + c.dir.z * d, R = 7.5, fall = 0.42, delay = 0.35;
      ringFx(tx, tz, { tex: TEX.rune, color: 0xffb830, r0: R * 1.3, r1: R, dur: delay + fall, spin: 2.5, int: 2.6, keep: true, hold: 0.2, fadeIn: true });
      ringFx(tx, tz, { tex: TEX.glow, color: 0xffa020, r0: R * 0.4, r1: R * 1.2, dur: delay + fall, int: 0.9, keep: true, hold: 0.2, fadeIn: true });
      beamFx(tx, tz, 0xffd070, 2.4, 30, delay + fall, 1.6);
      const sw = swordPool.pop() || buildDawnSword(), L = getLight(0xffc040, 0, 34); sw.position.set(tx, 40, tz); sw.rotation.set(0, Math.atan2(c.dir.x, c.dir.z), 0); sw.visible = false; fxRoot.add(sw);
      let t = 0, landed = false, pulse = 0;
      addFx((dt) => {
        t += dt;
        if (t < delay + fall) {
          if (t >= delay) { const k = (t - delay) / fall, kk = k * k; sw.visible = true; sw.position.y = lerp(36, 6.2, kk); if (L) { L.position.set(tx, sw.position.y - 3, tz); L.intensity = 80 + 160 * kk; }
            for (let i = 0; i < 4; i++) sparks.emit(tx + randS(0.6), sw.position.y - rand(9), tz + randS(0.6), randS(1), rand(2, 5), randS(1), rgb(0xffd070, 3), rand(0.25, 0.6), 0.5, 0, 1, 0); }
          return true;
        }
        if (!landed) {
          landed = true; hitStop(0.1); shake(1.3); sfx('bossSlam', { x: tx, z: tz }, 1.3); sfx('explosion', { x: tx, z: tz }, 0.9);
          flash(tx, 1.5, tz, 0xfff0c0, 24, 0.5, 4); beamFx(tx, tz, 0xffd070, 5, 30, 0.5, 3.2);
          ringFx(tx, tz, { color: 0xffffff, r0: 1, r1: R + 3, dur: 0.45, int: 3.5 }); ringFx(tx, tz, { color: 0xffb830, r0: 0.5, r1: R + 1, dur: 0.6, int: 2.6, delay: 0.06 });
          ringFx(tx, tz, { tex: TEX.cracks, color: 0xffc64a, int: 3, r0: R * 0.9, r1: R * 0.9, dur: 3.4, linear: true }); scorch(tx, tz, R * 0.8, 6);
          rockRing(tx, tz, 3, 11, 2.2, 0, 0xffb040); rockRing(tx, tz, 5.6, 17, 1.6, 0.08, 0xffb040);
          burst(tx, 0.4, tz, { n: 120, color: 0xffd070, color2: 0xffffff, int: 3.2, up: 2.2, s0: 5, s1: 24, size: 0.6, l0: 0.35, l1: 1.0, grav: 14, r: 1.5 });
          burst(tx, 0.4, tz, { n: 26, smoke: true, color: 0x5a4c3c, int: 1, up: 1.2, s0: 2, s1: 9, size: 2, size1: 5, l0: 0.8, l1: 1.7, r: 3 });
          for (const e of enemiesIn(tx, tz, R)) damageEnemy(e, 280, { kb: 12, stun: 2, from: { x: tx, z: tz } });
        }
        const lt = t - delay - fall, fade = lt > 3 ? Math.max(0, 1 - (lt - 3) / 0.5) : 1;
        sw.position.y = 6.2 + (lt > 3 ? (lt - 3) * 6 : 0); sw.scale.setScalar(0.4 + 0.6 * fade); sw.userData.glow.material.opacity = fade;
        if (L) L.intensity = (90 + Math.sin(lt * 9) * 25) * fade;
        pulse -= dt;
        if (pulse <= 0 && lt < 3) { pulse = 0.6; ringFx(tx, tz, { color: 0xffd070, r0: 0.8, r1: 5.5, dur: 0.4, int: 2 }); for (const e of enemiesIn(tx, tz, 5.5)) damageEnemy(e, 35, { slow: 0.4, slowT: 1 }); }
        if (Math.random() < dt * 30) sparks.emit(tx + randS(2), rand(0.2, 6), tz + randS(2), 0, rand(1, 3), 0, rgb(0xffd070, 2.6), rand(0.4, 0.9), 0.3, 0, 0.5, 0);
        return lt < 3.5;
      }, () => { fxRoot.remove(sw); sw.scale.setScalar(1); sw.userData.glow.material.opacity = 1; swordPool.push(sw); freeLight(L); });
    },
  },

  // =============================== ASHE ===============================
  piercingShot: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.1); const ar = buildArrow(0xbff0ff, 3.4); ar.scale.setScalar(2.4); ar.position.copy(_mz); ar.rotation.y = Math.atan2(c.dir.x, c.dir.z); fxRoot.add(ar);
      flash(_mz.x, _mz.y, _mz.z, 0x9fe8ff, 5, 0.25); flashLight(_mz.x, _mz.y, _mz.z, 0x7fd8ff, 120, 16, 0.3); shake(0.3); ringFx(p.pos.x, p.pos.z, { color: 0x9fe8ff, r0: 0.4, r1: 3.4, dur: 0.3, int: 2.4 });
      const tr = getTrail(ar.position, 0.35, 0x9fe8ff, 2.6, 0.5), dx = c.dir.x, dz = c.dir.z, seen = new Set(), L = getLight(0x7fd8ff, 60, 12); let t = 0;
      addFx((dt) => {
        t += dt; ar.position.x += dx * 70 * dt; ar.position.z += dz * 70 * dt; tr.update(ar.position); if (L) L.position.copy(ar.position);
        for (let i = 0; i < 4; i++) sparks.emit(ar.position.x + randS(0.3), ar.position.y + randS(0.3), ar.position.z + randS(0.3), -dx * rand(2, 6), rand(0, 2), -dz * rand(2, 6), rgb(0xdff8ff, 2.6), rand(0.2, 0.5), 0.3, 0, 1, 0);
        for (const e of G.enemies) {
          if (e.dead || seen.has(e) || Math.hypot(e.pos.x - ar.position.x, e.pos.z - ar.position.z) > 1.3 + e.radius) continue;
          seen.add(e); damageEnemy(e, 140, { kb: 4, slow: 0.4, slowT: 2.5, from: p.pos }); impactFx(e.pos.x, 1.3, e.pos.z, 0x9fe8ff, 1.4); sfx('iceHit', e.pos, 0.8); hitStop(0.03);
          ringFx(e.pos.x, e.pos.z, { color: 0xbff0ff, r0: 0.3, r1: 2.6, dur: 0.3, int: 2.2 }); burst(e.pos.x, 1.3, e.pos.z, { n: 16, color: 0xdff8ff, color2: 0x6fc8ff, int: 2.6, s0: 3, s1: 12, size: 0.3, l0: 0.2, l1: 0.5, vx: dx * 8, vz: dz * 8 });
        }
        return t < 0.5;
      }, () => { fxRoot.remove(ar); freeTrail(tr); freeLight(L); });
    },
  },
  arrowRing: {
    fire(p) {
      const x = p.pos.x, z = p.pos.z; shake(0.3); flash(x, 1.3, z, 0x9fe8ff, 6, 0.3); flashLight(x, 1.5, z, 0x7fd8ff, 110, 16, 0.35);
      ringFx(x, z, { color: 0xbff0ff, r0: 0.5, r1: 5, dur: 0.35, int: 3 }); ringFx(x, z, { tex: TEX.frost, color: 0x7fc4ff, r0: 1, r1: 4.2, dur: 0.3, int: 0.9, hold: 0.5, keep: true });
      burst(x, 1.2, z, { n: 50, color: 0xdff8ff, color2: 0x6fc8ff, int: 2.6, flat: true, s0: 6, s1: 18, size: 0.32, l0: 0.2, l1: 0.5, drag: 3 });
      const N = 20; for (let i = 0; i < N; i++) { const a = i / N * TAU + rand(0.08); spawnProjectile({ kind: 'frost', x: x + Math.sin(a) * 0.8, y: 1.3, z: z + Math.cos(a) * 0.8, dx: Math.sin(a), dz: Math.cos(a), speed: 40, dmg: 34, team: 'player', range: 20, radius: 0.5, pierce: true, noLight: i % 5 !== 0, hit: { slow: 0.35, slowT: 2, kb: 1.5 } }); }
      for (const e of enemiesIn(x, z, 3.5)) damageEnemy(e, 20, { kb: 9, from: { x, z } });
      p.invuln = Math.max(p.invuln, 0.25);
    },
  },
  crystalArrow: {
    fire(p, c) {
      muzzle(p, c, _mz, 1.2); const g = new THREE.Group(), dx = c.dir.x, dz = c.dir.z;
      const crys = new THREE.Mesh(geo('crys', () => new THREE.OctahedronGeometry(0.7, 0).scale(0.55, 0.55, 2.6)), basicHdr(0xcff4ff, 3)); g.add(crys);
      const fin = new THREE.Mesh(geo('crysfin', () => new THREE.ConeGeometry(0.5, 1.8, 4).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: hdr(0x5fc8ff, 2.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      fin.position.z = -1.6; g.add(fin, mkGlow(0x6fd0ff, 3, 6)); g.position.copy(_mz); g.rotation.y = Math.atan2(dx, dz); fxRoot.add(g);
      const tr = getTrail(g.position, 0.6, 0x9fe8ff, 2.6, 0.6), L = getLight(0x7fd8ff, 110, 20), x0 = _mz.x, z0 = _mz.z; let t = 0, hit = null;
      flash(_mz.x, _mz.y, _mz.z, 0xbff0ff, 7, 0.35); shake(0.4); beamFx(p.pos.x, p.pos.z, 0x9fe8ff, 1.6, 10, 0.4, 2);
      addFx((dt) => {
        t += dt; g.position.x += dx * 34 * dt; g.position.z += dz * 34 * dt; crys.rotation.z += dt * 6; tr.update(g.position); if (L) L.position.copy(g.position);
        for (let i = 0; i < 6; i++) sparks.emit(g.position.x + randS(0.5), g.position.y + randS(0.5), g.position.z + randS(0.5), -dx * rand(3, 9), rand(0, 2.5), -dz * rand(3, 9), rgb(Math.random() < 0.3 ? 0xffffff : 0x9fe8ff, 2.8), rand(0.3, 0.7), 0.45, 0, 1, 0);
        if (Math.random() < 0.6) smoke.emit(g.position.x, g.position.y, g.position.z, 0, 0.4, 0, rgb(0xbfe6ff, 1), rand(0.5, 1.0), 1.2, 3, 1, 0);
        for (const e of G.enemies) if (!e.dead && Math.hypot(e.pos.x - g.position.x, e.pos.z - g.position.z) < 1.2 + e.radius) { hit = e; break; }
        return !hit && t < 1.8;
      }, () => {
        const x = hit ? hit.pos.x : g.position.x, z = hit ? hit.pos.z : g.position.z, far = Math.hypot(x - x0, z - z0);
        fxRoot.remove(g); fin.material.dispose(); freeTrail(tr); freeLight(L);
        hitStop(0.09); sfx('frostNova', { x, z }, 1.3); sfx('explosion', { x, z }, 0.7); frostBlast(x, z, 6, 1.4); beamFx(x, z, 0x9fe8ff, 3, 22, 0.5, 2.6);
        if (hit) { damageEnemy(hit, 220, { freeze: Math.min(3.5, 1.5 + far / 12) }); impactFx(x, 1.4, z, 0xbff0ff, 2); }
        for (const e of enemiesIn(x, z, 6)) if (e !== hit) damageEnemy(e, 120, { freeze: 1.5 });
      });
    },
  },
});
Object.assign(ABIL_SFX, {
  frozenOrb: ['arcaneCast', 'iceHit'], arcaneShield: ['arcaneCast', 'blink'], starfall: ['meteorRune', 'flare'],
  fissure: [null, 'slam'], ironWill: [null, 'roar'], dawnBlade: ['meteorRune', null],
  piercingShot: [null, 'bowShot'], arrowRing: [null, 'volley'], crystalArrow: ['flare', 'bowShot'],
});
// =====================================================================================
//  Game flow (lobby in the town, start, retry, revive) + main loop
// =====================================================================================
function particleScale() {
  const s = renderer.getPixelRatio() * innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const sys of [sparks, smoke, motes]) sys.mat.uniforms.uScale.value = s;
}
function onQualityChanged() {
  particleScale();
  if (G.zone) torchLights.forEach((L, k) => { L.castShadow = G.quality === 2 && G.zone.torches && k < 2 && (typeof SETTINGS === 'undefined' || SETTINGS.shadows); });
}

// ------------------------------------------------------------------ LOBBY: the three heroes on pedestals in front of the town hall
const LOBBY = { rigs: {}, slots: null, rings: [], labels: {}, camX: 0, camT: 0, loading: {} };
function lobbySlot(id) { return LOBBY.slots[HERO_ORDER.indexOf(id)]; }
function enterLobby() {
  G.state = 'select'; G.player = null; G.tier = 1;
  setZoneEnvironment(TOWN_ZONE); clearWorld();
  LOBBY.slots = G.zone.env.lobby || G.zone.def.lobby;
  if (!LOBBY.rings.length) HERO_ORDER.forEach(() => { const m = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: TEX.rune, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.renderOrder = 6; LOBBY.rings.push(m); });
  LOBBY.rings.forEach((m, i) => { const [x, z] = LOBBY.slots[i]; m.position.set(x, 0.39, z); scene.add(m); });
  $('#select').classList.remove('hidden'); $('#hud').classList.add('hidden'); $('#end').classList.add('hidden'); $('#travel').classList.add('hidden');
  HERO_ORDER.forEach((id) => { if (LOBBY.rigs[id]) placeLobbyRig(id); else loadLobbyHero(id); });
  AUDIO.playMusic('lobby');
  const sh = LOBBY.slots[1]; CAM.target.set(sh[0], 0, sh[1]);
}
function loadLobbyHero(id) {
  if (LOBBY.loading[id]) return LOBBY.loading[id];
  const tok = (LOBBY.tok = (LOBBY.tok || 0) + 1);
  return (LOBBY.loading[id] = loadHero(id, (s) => { if (G.heroId === id) setStatus(s); }).then((rig) => {
    delete LOBBY.loading[id];
    LOBBY.rigs[id] = rig;
    if (!rig.isGltf) { if (G.heroId === id) setStatus(rig.netError ? `Model ${HEROES[id].name} sa nepodarilo stiahnuť – skontroluj, či beží server (spustit.bat). Klikni na postavu pre nový pokus.` : `Model ${HEROES[id].files.join(' / ')} sa nenašiel – používam náhradnú postavu.`); }
    else if (G.heroId === id) setStatus('');
    if (G.state === 'select') placeLobbyRig(id);
    if (G.heroId === id) { $('#sel-play').disabled = false; flourish(id); }
    return rig;
  }).catch((err) => { delete LOBBY.loading[id]; console.error(err); setStatus('Chyba pri načítaní modelu: ' + err.message); }));
}
function placeLobbyRig(id) {
  const rig = LOBBY.rigs[id], [x, z] = lobbySlot(id);
  actorRoot.add(rig.root); rig.root.position.set(x, 0.36, z); rig.root.rotation.set(0, (x) * -0.06, 0);
  rig.pivot.rotation.set(0, 0, 0); rig.pivot.position.set(0, 1, 0); flashRig(rig, 1, 1, 1, 0);
  rig.anim.stopAll(); rig.anim.setBase('idle');
}
function flourish(id) {
  const rig = LOBBY.rigs[id]; if (!rig || G.state !== 'select') return;
  const [x, z] = lobbySlot(id), ab = rig.def.abilities[2];
  burst(x, 0.5, z, { n: 40, color: rig.def.color, color2: 0xffffff, int: 2.5, up: 2.4, s0: 2, s1: 8, size: 0.3, l0: 0.4, l1: 1.0, r: 1.0 });
  if (ab.anim && rig.isGltf) {
    rig.anim.playOnce(ab.anim, 0.55);
    after(0.55, () => { if (G.heroId !== id || G.state !== 'select') return; const s = ABIL_SFX[ab.fn]; sfx((s && (s[1] || s[0])) || 'arcaneCast', { x, z }, 0.6); ringFx(x, z, { color: rig.def.color, r0: 0.5, r1: 4, dur: 0.55, int: 3, y: 0.4 }); burst(x, 1.5, z, { n: 50, color: rig.def.color, color2: 0xffffff, int: 2.8, s0: 2, s1: 9, size: 0.35, l0: 0.4, l1: 1.0, h: 1 }); flashLight(x, 2, z + 1, rig.def.color, 60, 12, 0.6); });
    after(1.7, () => { if (rig.anim.one && G.state === 'select') rig.anim.release(); });
  }
}
function selectHero(id) {
  G.heroId = id; showHeroInfo(id);
  $('#sel-play').disabled = !LOBBY.rigs[id];
  if (LOBBY.rigs[id] && LOBBY.rigs[id].isGltf) { setStatus(''); flourish(id); }
  else { setStatus('Načítavam …'); if (LOBBY.rigs[id] && !LOBBY.rigs[id].isGltf) { actorRoot.remove(LOBBY.rigs[id].root); delete LOBBY.rigs[id]; } if (LOBBY.slots) loadLobbyHero(id); }
}
function updateLobby(dt) {
  if (!LOBBY.slots) return;
  const sel = HERO_ORDER.indexOf(G.heroId);
  HERO_ORDER.forEach((id, i) => {
    const rig = LOBBY.rigs[id]; if (rig && rig.root.parent) rig.anim.update(dt);
    const ring = LOBBY.rings[i], on = i === sel, col = HEROES[id].color;
    ring.rotation.y += dt * (on ? 0.8 : 0.2); const s = on ? 3.0 + Math.sin(G.time * 3) * 0.08 : 2.3; ring.scale.set(s, 1, s);
    ring.material.color.copy(hdr(on ? col : 0x8a7a5a, on ? 1.8 : 0.5));
    // floating name labels
    const el = LOBBY.labels[id] || (LOBBY.labels[id] = (() => { const d = document.createElement('div'); d.className = 'lobbylbl'; d.innerHTML = `<b>${HEROES[id].name}</b><span>${HEROES[id].cls}</span>`; d.style.setProperty('--c', HEROES[id].css); d.addEventListener('click', () => selectHero(id)); $('#lobby-labels').appendChild(d); return d; })());
    const [x, z] = LOBBY.slots[i];
    if (toScreen(x, 3.0, z, _scr)) { el.style.transform = `translate(-50%,-100%) translate(${_scr.x.toFixed(1)}px,${_scr.y.toFixed(1)}px)`; el.classList.toggle('sel', on); el.style.display = ''; } else el.style.display = 'none';
  });
  // camera drifts toward the selected hero
  const [sx, sz] = LOBBY.slots[Math.max(0, sel)], cz = LOBBY.slots[1][1];
  LOBBY.camX = lerp(LOBBY.camX, sx * 0.45, 1 - Math.exp(-dt * 3)); LOBBY.camT += dt;
  camera.position.set(LOBBY.camX + Math.sin(LOBBY.camT * 0.15) * 0.5, 3.2, cz + 11.5); camera.lookAt(LOBBY.camX, 1.55, cz - 0.6);
  CAM.target.set(LOBBY.camX, 0, cz); sun.target.position.set(LOBBY.camX, 0, cz); sun.position.copy(sun.target.position).add(sunDir);
}
canvas.addEventListener('mousedown', (e) => {  // click a hero in 3D to select
  if (G.state !== 'select' || !LOBBY.slots || e.button !== 0) return;
  let best = null, bd = 120;
  HERO_ORDER.forEach((id, i) => { const [x, z] = LOBBY.slots[i]; if (toScreen(x, 1.3, z, _scr)) { const d = Math.hypot(_scr.x - e.clientX, (_scr.y - e.clientY) * 0.6); if (d < bd) { bd = d; best = id; } } });
  if (best && best !== G.heroId) { selectHero(best); sfx('click'); }
});
function leaveLobby() {
  LOBBY.rings.forEach((m) => scene.remove(m));
  for (const id in LOBBY.rigs) actorRoot.remove(LOBBY.rigs[id].root);
  for (const id in LOBBY.labels) LOBBY.labels[id].style.display = 'none';
}

function startGame() {
  const rig = LOBBY.rigs[G.heroId];
  if (G.state !== 'select' || !rig) return;
  const zone = PROGRESS.maxTier > 1 ? TOWN_ZONE : 0;      // veterans start in town, newcomers in the wilderness
  G.state = 'transition'; G.tier = 1; toggleSettings(false); G.state = 'transition';
  const f = $('#fade'); f.classList.add('on');
  Promise.all([ensureEnv(zone), new Promise((r) => setTimeout(r, 480))]).then(() => {
    requestAnimationFrame(() => f.classList.remove('on'));
    leaveLobby();
    $('#select').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#end').classList.add('hidden');
    createPlayer(rig); buildHUD(rig.def); renderInventory();
    enterZone(zone); G.state = 'playing';
    if (zone === TOWN_ZONE) after(1.2, () => toast('Teleportný kameň (F) ťa prenesie na výpravu'));
  });
}
function retry() {
  const rig = G.player.rig, z = G.zoneIndex;
  ensureEnv(z).then(() => fadeThen(() => { $('#end').classList.add('hidden'); actorRoot.remove(rig.root); createPlayer(rig); renderInventory(); enterZone(z); G.state = 'playing'; }));
}
function reviveInTown() {
  const rig = G.player.rig;
  ensureEnv(TOWN_ZONE).then(() => fadeThen(() => { $('#end').classList.add('hidden'); actorRoot.remove(rig.root); createPlayer(rig); renderInventory(); enterZone(TOWN_ZONE); G.state = 'playing'; }));
}
function backToSelect() {
  fadeThen(() => { if (G.player) actorRoot.remove(G.player.root); toggleInventory(false); $('#travel').classList.add('hidden'); enterLobby(); selectHero(G.heroId); });
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, lowFps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  let dt = rdt * G.slowMo;
  if (G.hitStop > 0) { G.hitStop -= rdt; dt *= 0.05; }
  if (G.state === 'paused') dt = 0;
  G.dt = dt; G.time += dt;
  updateMouseGround();
  updateTimers();
  if (G.state === 'select') {
    updateLobby(rdt);
  } else if (G.player) {
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateDrops(dt); updateChests(dt); updateMerchant(dt); updateInteract();
    updateCamera(G.state === 'paused' ? 0 : rdt);
    updateHUD(rdt);
  }
  updateFx(dt);
  sparks.update(dt); smoke.update(dt);
  updateZone(dt, G.time); updateMotes(G.time);
  updateDmgNumbers(rdt);
  mouse.lPressed = false;
  if (G.quality >= 1 && bloom.enabled) composer.render(rdt); else renderer.render(scene, camera);
  // fps counter + optional automatic quality step-down
  fpsAcc += rdt; fpsN++;
  if (fpsAcc >= 0.5) {
    const fps = fpsN / fpsAcc; $('#fps').textContent = `${Math.round(fps)} FPS`;
    lowFps = fps < 40 && G.state === 'playing' && SETTINGS.autoQuality ? lowFps + fpsAcc : 0;
    if (lowFps > 4 && G.quality > 0) { SETTINGS.quality = G.quality - 1; applySettings(); saveSettings(); lowFps = 0; toast('Grafika znížená na ' + ['nízku', 'strednú'][G.quality] + ' (Esc = nastavenia)'); }
    fpsAcc = 0; fpsN = 0;
  }
}

// ------------------------------------------------------------------ boot
addEventListener('mousemove', (e) => { mouse.overUI = e.target !== canvas; });
if (params.has('q')) SETTINGS.quality = clamp(+params.get('q') | 0, 0, 2);
initInventoryUI(); buildSelectUI(); buildSettingsUI(); initTravelUI(); applySettings();
initShopUI(); loadChestModel(); loadMerchantModel();
const startHero = HEROES[params.get('hero')] ? params.get('hero') : 'aurora';
G.heroId = startHero; showHeroInfo(startHero); setStatus('Načítavam mesto …'); $('#sel-play').disabled = true;
ensureEnv(TOWN_ZONE).then(() => { enterLobby(); selectHero(startHero); ensureEnv(0).then(() => ensureEnv(1)).then(() => ensureEnv(2)); });
if (params.has('auto')) {
  const iv = setInterval(() => {
    if (G.state === 'select' && LOBBY.rigs[G.heroId]) {
      clearInterval(iv); startGame();
      if (params.has('zone')) { const z = clamp(+params.get('zone') | 0, 0, 3); const w = setInterval(() => { if (G.state === 'playing') { clearInterval(w); goToZone(z); } }, 100); }
    }
  }, 100);
}
if (params.has('debug')) window.GAME = { G, loadMonster, MONSTER_CACHE, INV, SHOP, openShop, dropCoins, dropKey, gainXP, tryOpenChest, interact, UNLOCK_LV, ensureEnv, envCache, THREE, tryCast, spawnEnemy, makeItem, dropItem, enterZone, goToZone, INV, damageEnemy, openPortal, camera, mouse, CAM, renderer, scene, LOBBY, PROGRESS, SETTINGS, AUDIO, sfx, toggleSettings, openTravel, TOWN_ZONE };
requestAnimationFrame(frame);
