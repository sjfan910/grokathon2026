// 3D view: lakebed mesh plus one terrain-following sheet per layer, all sampling a Data3DTexture.
import * as THREE from 'three';
import { OrbitControls } from '/twin/vendor/three/OrbitControls.js';

export const FIELD_STYLE = {
  T: { label: 'Temperature', unit: '°C', lo: 5, hi: 30, invert: 0, stops: [0x2b4c9b, 0x35b0ab, 0xf2c14e, 0xd1382c] },
  P: { label: 'Phosphorus', unit: 'µg/L', lo: 0, hi: 100, invert: 0, stops: [0x12343f, 0x2a7f8e, 0xc8b43c, 0xf4e04d] },
  A: { label: 'Algae', unit: 'µg/L chl', lo: 0, hi: 60, invert: 0, stops: [0x0d3b46, 0x2e8b57, 0x8fce3a, 0xe6f55a] },
  O: { label: 'Oxygen', unit: 'mg/L', lo: 0, hi: 12, invert: 1, stops: [0xd1382c, 0xe58a2e, 0x57b6c4, 0x1f4e8c] },
  X: { label: 'Toxin', unit: 'µg/L', lo: 0, hi: 5, invert: 0, stops: [0x1a2a3a, 0x7b3fa0, 0xd13c8f, 0xff9ad5] },
  H: { label: 'Fish habitat', unit: '0–1', lo: 0, hi: 1, invert: 1, stops: [0x8b2d2d, 0xc98a2e, 0x7fbf5a, 0x1f9e78] },
};

const VERT = `
uniform float uK, uNz, uExplode, uSpacing, uEx;
in float aDepth;
out vec2 vUv; out float vDepth;
void main() {
  vUv = uv; vDepth = aDepth;
  float follow = -((uK + 0.5) / uNz) * aDepth * uEx;
  float stacked = -0.2 - uK * uSpacing;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, mix(follow, stacked, uExplode), position.z, 1.0);
}`;
const FRAG = `
precision highp float; precision highp sampler3D;
uniform sampler3D uTex; uniform float uK, uNz, uOpacity, uInvert; uniform vec3 uStops[4];
in vec2 vUv; in float vDepth; out vec4 outColor;
void main() {
  if (vDepth < 0.3) discard;
  float v = texture(uTex, vec3(vUv, (uK + 0.5) / uNz)).r;
  float t = v * 3.0;
  vec3 c = t < 1.0 ? mix(uStops[0], uStops[1], t) : t < 2.0 ? mix(uStops[1], uStops[2], t - 1.0) : mix(uStops[2], uStops[3], t - 2.0);
  float strength = uInvert > 0.5 ? 1.0 - v : v;
  outColor = vec4(c, uOpacity * (0.3 + 0.7 * strength));
}`;

export function createView(container, scene, labelsEl) {
  const { nx, ny, nz, dx_m, dy_m, depth_m, land_m, z_exaggeration: ex } = scene;
  const WORLD = 1e4;  // one world unit is 10 km
  const W = (nx * dx_m) / WORLD, D = (ny * dy_m) / WORLD, uEx = ex / WORLD;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  camera.position.set(-W * 0.2, W * 0.42, D * 1.35);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, -1.5, 0);
  world.add(new THREE.HemisphereLight(0xdfefff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-10, 30, 10);
  world.add(sun);

  const plane = () => new THREE.PlaneGeometry(W, D, nx - 1, ny - 1).rotateX(-Math.PI / 2);
  const depthAt = (ix, row) => depth_m[ix + nx * (ny - 1 - row)];  // plane rows run north to south

  const bedGeo = plane();
  const pos = bedGeo.attributes.position, colors = new Float32Array(pos.count * 3);
  const deep = new THREE.Color(0x3a3f35), shoal = new THREE.Color(0xa59c78), land = new THREE.Color(0x5d7052), col = new THREE.Color();
  for (let row = 0; row < ny; row++) for (let ix = 0; ix < nx; ix++) {
    const v = ix + nx * row, d = depthAt(ix, row);
    pos.setY(v, d > 0 ? -d * uEx : 0.12 + (land_m[ix + nx * (ny - 1 - row)] || 0) * uEx * 0.2);
    if (d > 0) col.lerpColors(shoal, deep, Math.min(1, d / 60)); else col.copy(land);
    col.toArray(colors, v * 3);
  }
  bedGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  bedGeo.computeVertexNormals();
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  world.add(bed);

  const texData = new Uint8Array(nx * ny * nz);
  const tex = new THREE.Data3DTexture(texData, nx, ny, nz);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;

  const shared = {
    uTex: { value: tex }, uNz: { value: nz }, uExplode: { value: 0 }, uSpacing: { value: 0.75 }, uEx: { value: uEx },
    uOpacity: { value: 0.42 }, uInvert: { value: 0 },
    uStops: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
  };
  const sheetGeo = plane();
  const aDepth = new Float32Array(sheetGeo.attributes.position.count);
  for (let row = 0; row < ny; row++) for (let ix = 0; ix < nx; ix++) aDepth[ix + nx * row] = depthAt(ix, row);
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

  const labels = (scene.sites || []).concat(scene.sources || []).map((s) => {
    const p = new THREE.Vector3((s.i / (nx - 1) - 0.5) * W, 0.15, (0.5 - s.j / (ny - 1)) * D);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.position.copy(p);
    world.add(dot);
    const el = document.createElement('div');
    el.className = 'twin-label';
    el.textContent = s.id.replace(/_/g, ' ');
    labelsEl.appendChild(el);
    return { p, el };
  });

  let field = 'A', focusTarget = null;
  function setField(name) {
    field = name;
    const st = FIELD_STYLE[name];
    st.stops.forEach((hex, m) => shared.uStops.value[m].setHex(hex, THREE.LinearSRGBColorSpace));
    shared.uInvert.value = st.invert;
  }
  function setExplode(x) { shared.uExplode.value = x; bed.visible = x < 0.5; }
  function setLayerRange(from, to) { sheets.forEach((s, k) => { s.visible = k >= from && k <= to; }); }
  function focus({ i, j, field: f, explode, zoom = 0.35 } = {}) {
    if (f) setField(f);
    if (explode !== undefined) setExplode(explode);
    if (i !== undefined && j !== undefined) {
      const x = (i / (nx - 1) - 0.5) * W, z = (0.5 - j / (ny - 1)) * D;
      focusTarget = { target: new THREE.Vector3(x, -0.5, z), cam: new THREE.Vector3(x - 2, W * zoom * 0.6, z + W * zoom) };
    }
  }
  function update(sim) {
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

  const v = new THREE.Vector3();
  function render() {
    if (focusTarget) {
      controls.target.lerp(focusTarget.target, 0.06);
      camera.position.lerp(focusTarget.cam, 0.06);
      if (camera.position.distanceTo(focusTarget.cam) < 0.1) focusTarget = null;
    }
    controls.update();
    renderer.render(world, camera);
    const w = container.clientWidth, ht = container.clientHeight;
    for (const l of labels) {
      v.copy(l.p).project(camera);
      l.el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * ht}px)`;
    }
  }
  setField('A');
  return { setField, setExplode, setLayerRange, focus, update, render, get field() { return field; } };
}
