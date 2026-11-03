// 3D view: lakebed mesh plus one terrain-following sheet per layer, all sampling a Data3DTexture.
import * as THREE from 'three';
import { OrbitControls } from '/twin/vendor/three/OrbitControls.js';

// floor: how visible low values are. 0 lets clean water show through, so pollution reads as a plume.
export const FIELD_STYLE = {
  T: { label: 'Temperature', unit: '°C', lo: 5, hi: 30, invert: 0, floor: 0.35, stops: [0x2b4c9b, 0x35b0ab, 0xf2c14e, 0xd1382c] },
  P: { label: 'Phosphorus', unit: 'µg/L', lo: 0, hi: 100, invert: 0, stops: [0x2a7f8e, 0x46b39d, 0xe0c23c, 0xf9e45b] },
  A: { label: 'Algae', unit: 'µg/L chl', lo: 0, hi: 60, invert: 0, stops: [0x2f9e6e, 0x4fbf4a, 0xa6d936, 0xf3f56a] },
  O: { label: 'Oxygen', unit: 'mg/L', lo: 0, hi: 12, invert: 1, stops: [0xd1382c, 0xe58a2e, 0x57b6c4, 0x1f4e8c] },
  X: { label: 'Toxin', unit: 'µg/L', lo: 0, hi: 5, invert: 0, stops: [0x7b3fa0, 0xb03aa0, 0xe8418f, 0xffa6db] },
  H: { label: 'Fish habitat', unit: '0–1', lo: 0, hi: 1, invert: 1, stops: [0x8b2d2d, 0xc98a2e, 0x7fbf5a, 0x1f9e78] },
  L: { label: 'Oil', unit: 'µg/L', lo: 0, hi: 2000, invert: 0, stops: [0x0b0b10, 0x3a2f1e, 0x8a5a1c, 0xf2a93b] },
};

const VERT = `
uniform float uK, uNz, uExplode, uSpacing, uEx;
in float aDepth;
out vec2 vUv; out float vDepth;
void main() {
  vUv = uv; vDepth = aDepth;
  float follow = -((uK + 0.5) / uNz) * aDepth * uEx;
  float stacked = 0.5 + (uNz - 1.0 - uK) * uSpacing;  // lifts above the map, surface layer on top
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, mix(follow, stacked, uExplode), position.z, 1.0);
}`;
const FRAG = `
precision highp float; precision highp sampler3D;
uniform sampler3D uTex; uniform float uK, uNz, uOpacity, uInvert, uFloor, uExplode; uniform vec3 uStops[4];
in vec2 vUv; in float vDepth; out vec4 outColor;
void main() {
  if (vDepth < 0.5) discard;
  float v = texture(uTex, vec3(vUv, (uK + 0.5) / uNz)).r;
  float t = v * 3.0;
  vec3 c = t < 1.0 ? mix(uStops[0], uStops[1], t) : t < 2.0 ? mix(uStops[1], uStops[2], t - 1.0) : mix(uStops[2], uStops[3], t - 2.0);
  float strength = smoothstep(0.24, 0.62, uInvert > 0.5 ? 1.0 - v : v);
  float floorA = max(uFloor, uExplode * 0.55);
  float edge = smoothstep(0.5, 1.5, vDepth);
  outColor = vec4(c, edge * mix(uOpacity, 0.95, uExplode) * (floorA + (1.0 - floorA) * strength));
}`;
const WATER_VERT = `
in float aDepth;
out vec3 vW; out float vDepth;
void main() {
  vDepth = aDepth;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FRAG = `
precision highp float;
uniform float uTime; uniform vec3 uSun;
in vec3 vW; in float vDepth; out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float waves(vec2 p) {
  return noise(p * 0.9 + uTime * vec2(0.09, 0.05)) + 0.5 * noise(p * 2.1 - uTime * vec2(0.07, 0.11));
}
void main() {
  if (vDepth < 0.5) discard;
  float e = 0.12, h = waves(vW.xz);
  vec3 N = normalize(vec3(h - waves(vW.xz + vec2(e, 0.0)), 1.6, h - waves(vW.xz + vec2(0.0, e))));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 base = mix(vec3(0.22, 0.56, 0.6), vec3(0.04, 0.2, 0.34), smoothstep(1.0, 28.0, vDepth));
  vec3 c = mix(base, vec3(0.72, 0.84, 0.92), fres);
  float spec = pow(max(dot(N, normalize(uSun + V)), 0.0), 90.0) * 0.35;
  float foam = smoothstep(1.6, 0.6, vDepth) * 0.5;
  c += spec * vec3(1.0, 0.95, 0.85) * 0.9 + foam * 0.3;
  float edge = smoothstep(0.5, 1.1, vDepth);
  outColor = vec4(c, edge * clamp(0.3 + fres * 0.45 + spec + foam * 0.4, 0.0, 0.9));
}`;
const SKY_FRAG = `
precision highp float;
in vec3 vDir; out vec4 outColor;
void main() {
  float y = normalize(vDir).y;
  vec3 c = y > 0.0 ? mix(vec3(0.77, 0.87, 0.93), vec3(0.3, 0.55, 0.8), pow(y, 0.55)) : mix(vec3(0.77, 0.87, 0.93), vec3(0.06, 0.13, 0.2), smoothstep(0.0, 0.25, -y));
  outColor = vec4(c, 1.0);
}`;

export function createView(container, scene, labelsEl) {
  const { nx, ny, nz, dx_m, dy_m, depth_m, land_m, z_exaggeration: ex } = scene;
  const WORLD = 1e4;  // one world unit is 10 km
  const W = (nx * dx_m) / WORLD, D = (ny * dy_m) / WORLD, uEx = ex / WORLD;
  const HORIZON = 0xc4dded;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  world.fog = new THREE.Fog(HORIZON, 40, 120);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 800);
  camera.position.set(-W * 0.2, W * 0.56, D * 1.75);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 5; controls.maxDistance = 110; controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(-W * 0.06, -0.4, 0);
  world.add(new THREE.HemisphereLight(0xdcecff, 0x6d6a55, 1.5));
  const sunDir = new THREE.Vector3(-0.45, 0.7, 0.4).normalize();
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.copy(sunDir).multiplyScalar(60);
  world.add(sun);

  world.add(new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'out vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_FRAG,
  })));

  // The solver's 3 km cells stay as they are. Only the drawing is resampled, so shorelines read as curves.
  function fineField(src, F, passes = 2) {
    const fx = (nx - 1) * F + 1, fy = (ny - 1) * F + 1;
    let out = new Float32Array(fx * fy), tmp = new Float32Array(fx * fy);
    for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
      const gx = x / F, gy = y / F, i = Math.min(Math.floor(gx), nx - 2), j = Math.min(Math.floor(gy), ny - 2), a = gx - i, b = gy - j;
      const v = (p, q) => src[p + nx * q];
      out[x + fx * y] = (v(i, j) * (1 - a) + v(i + 1, j) * a) * (1 - b) + (v(i, j + 1) * (1 - a) + v(i + 1, j + 1) * a) * b;
    }
    const r = Math.ceil(F * 0.75);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
        let t = 0, c = 0;
        for (let d = -r; d <= r; d++) { const q = x + d; if (q >= 0 && q < fx) { t += out[q + fx * y]; c++; } }
        tmp[x + fx * y] = t / c;
      }
      for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
        let t = 0, c = 0;
        for (let d = -r; d <= r; d++) { const q = y + d; if (q >= 0 && q < fy) { t += tmp[x + fx * q]; c++; } }
        out[x + fx * y] = t / c;
      }
    }
    return { data: out, fx, fy };
  }
  const plane = (F) => new THREE.PlaneGeometry(W, D, (nx - 1) * F, (ny - 1) * F).rotateX(-Math.PI / 2);
  const noise2 = (x, y) => {
    const s = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), w = g * g * (3 - 2 * g);
    return (s(i, j) * (1 - u) + s(i + 1, j) * u) * (1 - w) + (s(i, j + 1) * (1 - u) + s(i + 1, j + 1) * u) * w;
  };

  const BED_F = 4;
  const bedGeo = plane(BED_F);
  const depthFine = fineField(depth_m, BED_F), landFine = fineField(land_m, BED_F, 3);
  const pos = bedGeo.attributes.position, colors = new Float32Array(pos.count * 3);
  const deep = new THREE.Color(0x0f3350), shoal = new THREE.Color(0x5f9fb0), sand = new THREE.Color(0xd8cda2);
  const grass = new THREE.Color(0x6f8f55), forest = new THREE.Color(0x466843), far = new THREE.Color(0x5b7a4e), col = new THREE.Color();
  for (let row = 0; row < depthFine.fy; row++) for (let ix = 0; ix < depthFine.fx; ix++) {
    const v = ix + depthFine.fx * row, m = ix + depthFine.fx * (depthFine.fy - 1 - row);
    const d = depthFine.data[m], land = landFine.data[m], x = pos.getX(v), z = pos.getZ(v);
    const edge = Math.min(1, Math.min(ix, depthFine.fx - 1 - ix, row, depthFine.fy - 1 - row) / (BED_F * 12));
    const n = noise2(x * 0.9, z * 0.9) * 0.6 + noise2(x * 3.1, z * 3.1) * 0.4;
    // Height is compressed so hills read as gentle relief rather than spikes.
    const landY = Math.sqrt(Math.max(land, 0)) * 0.035 * edge * (0.75 + 0.5 * n);
    pos.setY(v, d > 0.5 ? landY * 0.2 - d * uEx : landY + 0.02);
    if (d > 0.5) col.lerpColors(shoal, deep, Math.min(1, Math.sqrt(d / 45)));
    else {
      col.lerpColors(grass, forest, Math.min(1, n * 1.3));
      col.lerp(sand, Math.min(1, Math.max(0, (d - 0.02) / 0.35)));
      col.lerp(far, 1 - edge);
    }
    col.toArray(colors, v * 3);
  }
  bedGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  bedGeo.computeVertexNormals();
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  world.add(bed);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: far, roughness: 1 }));
  ground.position.y = -0.02;
  world.add(ground);

  const texData = new Uint8Array(nx * ny * nz);
  const tex = new THREE.Data3DTexture(texData, nx, ny, nz);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;

  const shared = {
    uTex: { value: tex }, uNz: { value: nz }, uExplode: { value: 0 }, uSpacing: { value: 0.5 }, uEx: { value: uEx },
    uOpacity: { value: 0.6 }, uInvert: { value: 0 }, uFloor: { value: 0 },
    uStops: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
  };
  const SHEET_F = 3;
  const sheetGeo = plane(SHEET_F);
  const sheetDepth = fineField(depth_m, SHEET_F);
  const aDepth = new Float32Array(sheetGeo.attributes.position.count);
  for (let row = 0; row < sheetDepth.fy; row++) for (let ix = 0; ix < sheetDepth.fx; ix++) {
    aDepth[ix + sheetDepth.fx * row] = sheetDepth.data[ix + sheetDepth.fx * (sheetDepth.fy - 1 - row)];
  }
  sheetGeo.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));
  const sheets = [];
  for (let k = 0; k < nz; k++) {
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...shared, uK: { value: k } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sheetGeo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = nz - k;
    world.add(mesh);
    sheets.push(mesh);
  }

  const waterUniforms = { uTime: { value: 0 }, uSun: { value: sunDir } };
  const water = new THREE.Mesh(sheetGeo, new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    uniforms: waterUniforms, transparent: true, depthWrite: false,
  }));
  water.frustumCulled = false;
  water.renderOrder = nz + 2;
  world.add(water);

  // Currents: streaks carried by the solver's surface flow. The motion is sped up so it's visible.
  const STREAKS = 2400, wetCells = [];
  for (let q = 0; q < nx * ny; q++) if (depth_m[q] > 1.5) wetCells.push(q);
  const streakPos = new Float32Array(STREAKS * 6), streakCol = new Float32Array(STREAKS * 6);
  const particles = Array.from({ length: STREAKS }, () => ({ gx: 0, gy: 0, age: 0, life: 0 }));
  const respawn = (s) => {
    const q = wetCells[Math.floor(Math.random() * wetCells.length)];
    s.gx = (q % nx) + Math.random() - 0.5; s.gy = Math.floor(q / nx) + Math.random() - 0.5;
    s.age = 0; s.life = 60 + Math.random() * 120;
  };
  particles.forEach((s) => { respawn(s); s.age = Math.random() * s.life; });
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
  const currents = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  }));
  currents.frustumCulled = false;
  currents.renderOrder = nz + 3;
  world.add(currents);
  let flow = null;
  function stepCurrents() {
    if (!flow) return;
    let top = 1e-6;
    for (const q of wetCells) top = Math.max(top, Math.abs(flow.u[q]), Math.abs(flow.v[q]));
    particles.forEach((s, n) => {
      const q = Math.round(s.gx) + nx * Math.round(s.gy);
      s.age++;
      if (s.age > s.life || !(depth_m[q] > 0.5)) { respawn(s); return; }
      const a = 0.14 * flow.u[q] / top, b = 0.14 * flow.v[q] / top;
      s.gx += a; s.gy += b;
      const fade = Math.sin(Math.PI * s.age / s.life) * 0.75;
      const wx = (g) => (g / (nx - 1) - 0.5) * W, wz = (g) => (0.5 - g / (ny - 1)) * D;
      streakPos.set([wx(s.gx), 0.04, wz(s.gy), wx(s.gx - a * 7), 0.04, wz(s.gy - b * 7)], n * 6);
      streakCol.set([fade, fade, fade, 0, 0, 0], n * 6);
    });
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;
  }

  const pinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const pinGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), headGeo = new THREE.SphereGeometry(0.09, 16, 12);
  const pins = new THREE.Group();
  world.add(pins);
  const labels = (scene.sites || []).concat(scene.sources || []).map((s) => {
    const p = new THREE.Vector3((s.i / (nx - 1) - 0.5) * W, 0.55, (0.5 - s.j / (ny - 1)) * D);
    const stem = new THREE.Mesh(pinGeo, pinMat), head = new THREE.Mesh(headGeo, pinMat);
    stem.position.set(p.x, 0.27, p.z); head.position.copy(p);
    pins.add(stem, head);
    const el = document.createElement('div');
    el.className = 'twin-label';
    el.textContent = s.id.replace(/_intake$/, ' intake').replace(/_/g, ' ');
    labelsEl.appendChild(el);
    return { p, el };
  });

  let field = 'A', focusTarget = null, explodeNow = 0;
  function setField(name) {
    field = name;
    const st = FIELD_STYLE[name];
    st.stops.forEach((hex, m) => shared.uStops.value[m].setHex(hex, THREE.LinearSRGBColorSpace));
    shared.uInvert.value = st.invert;
    shared.uFloor.value = st.floor || 0;
  }
  function setExplode(x) {
    explodeNow = x;
    shared.uExplode.value = x;
    // The map, pins and labels stay put. Only draw order changes, because the layers now sit above the water.
    water.renderOrder = x < 0.5 ? nz + 2 : -2;
    currents.renderOrder = x < 0.5 ? nz + 3 : -1;
  }
  function setLayerRange(from, to) { sheets.forEach((s, k) => { s.visible = k >= from && k <= to; }); }
  function focus({ i, j, field: f, explode, zoom = 0.35 } = {}) {
    if (f) setField(f);
    if (explode !== undefined) setExplode(explode);
    if (i !== undefined && j !== undefined) {
      const x = (i / (nx - 1) - 0.5) * W, z = (0.5 - j / (ny - 1)) * D;
      focusTarget = { target: new THREE.Vector3(x, -0.3, z), cam: new THREE.Vector3(x - 2, W * zoom * 0.7, z + W * zoom) };
    }
  }
  function update(sim) {
    flow = sim.surfaceFlow();
    const { lo, hi } = FIELD_STYLE[field], src = sim.fields[field], k = 255 / (hi - lo);
    for (let m = 0; m < texData.length; m++) {
      const v = (src[m] - lo) * k;
      texData[m] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    tex.needsUpdate = true;
  }
  function resize() {
    const w = container.clientWidth, ht = container.clientHeight;
    renderer.setSize(w, ht);
    camera.aspect = w / Math.max(ht, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const v = new THREE.Vector3(), clock = new THREE.Clock();
  function render() {
    waterUniforms.uTime.value = clock.getElapsedTime();
    if (focusTarget) {
      controls.target.lerp(focusTarget.target, 0.06);
      camera.position.lerp(focusTarget.cam, 0.06);
      if (camera.position.distanceTo(focusTarget.cam) < 0.1) focusTarget = null;
    }
    stepCurrents();
    controls.update();
    renderer.render(world, camera);
    const w = container.clientWidth, ht = container.clientHeight;
    for (const l of labels) {
      v.copy(l.p).project(camera);
      l.el.style.transform = `translate(-50%, -130%) translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * ht}px)`;
    }
  }
  setField('A');
  return { setField, setExplode, setLayerRange, focus, update, render, get field() { return field; } };
}
