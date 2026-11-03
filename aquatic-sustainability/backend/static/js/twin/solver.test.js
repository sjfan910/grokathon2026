// Run from repo root: node --test aquatic-sustainability/backend/static/js/twin/solver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from './solver.js';

function box(nx, ny, nz, depthAt = () => 20) {
  const depth_m = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    depth_m.push(i === 0 || j === 0 || i === nx - 1 || j === ny - 1 ? 0 : depthAt(i, j));
  }
  return { nx, ny, nz, dx_m: 3000, dy_m: 3000, depth_m, sources: [], sites: [] };
}
const erie = () => JSON.parse(readFileSync(new URL('./erie.scene.json', import.meta.url)));

test('horizontal spread of a Gaussian matches 2Kt', () => {
  const K = 500, scene = box(81, 81, 2);
  const sim = createSim(scene, { reactions: false, coeffs: { Kh: K } });
  sim.setScenario({ windSpeed: 0 });
  const P = sim.fields.P, s0 = 12000;
  const variance = () => {
    let m = 0, v = 0;
    for (let j = 0; j < 81; j++) for (let i = 0; i < 81; i++) {
      const c = P[i + 81 * j]; m += c; v += c * ((i - 40) * 3000) ** 2;
    }
    return v / m;
  };
  P.fill(0);
  for (const q of sim.wetCols) for (let k = 0; k < 2; k++) {
    const i = q % 81, j = (q - i) / 81, r2 = ((i - 40) * 3000) ** 2 + ((j - 40) * 3000) ** 2;
    P[q + 81 * 81 * k] = Math.exp(-r2 / (2 * s0 * s0));
  }
  const v0 = variance();
  sim.step(240);
  const expected = 2 * K * 240 * 3600, got = variance() - v0;
  assert.ok(Math.abs(got - expected) / expected < 0.05, `got ${got}, expected ${expected}`);
});

test('wind drives shallow water downwind and deep water back', () => {
  const scene = box(40, 30, 4, (i, j) => (j > 15 ? 5 : 30));
  const sim = createSim(scene, { reactions: false });
  sim.setScenario({ windSpeed: 8, windDir: 270 });
  assert.ok(sim.columnFlowX(20, 22) > 0, 'shallow north side should flow east with a west wind');
  assert.ok(sim.columnFlowX(20, 8) < 0, 'deep south side should return west');
});

test('a uniform field stays uniform and mass is conserved under flow on the lake', () => {
  const sim = createSim(erie(), { reactions: false });
  sim.setScenario({ windSpeed: 10, windDir: 240 });
  sim.fields.P.forEach((_, m) => { sim.fields.P[m] = 0; });
  const nCols = sim.scene.nx * sim.scene.ny, nz = sim.scene.nz;
  for (const q of sim.wetCols) for (let k = 0; k < nz; k++) sim.fields.P[q + nCols * k] = 10;
  const before = sim.totalMass('P');
  sim.step(240);
  const after = sim.totalMass('P');
  assert.ok(Math.abs(after - before) / before < 1e-3, `mass drift ${(after - before) / before}`);
  let lo = Infinity, hi = -Infinity;
  for (const q of sim.wetCols) for (let k = 0; k < nz; k++) { const v = sim.fields.P[q + nCols * k]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi - lo < 0.2, `uniform field spread ${hi - lo}`);
});

test('summer scenario grows a western bloom and a central dead zone, with sane values', () => {
  const sim = createSim(erie());
  sim.setScenario({ windSpeed: 4, windDir: 225, inflowCfs: 8000, airTempC: 27 });
  sim.step(24 * 30);
  const m = sim.metrics();
  assert.ok(m.bloomKm2 > 100, `bloom ${m.bloomKm2}`);
  assert.ok(m.hypoxicKm2 > 100, `hypoxic ${m.hypoxicKm2}`);
  for (const name of ['T', 'P', 'A', 'O', 'X', 'H']) {
    for (const v of sim.fields[name]) assert.ok(Number.isFinite(v) && v >= -1e-3, `${name}=${v}`);
  }
});

test('clone is independent, and algaecide spikes toxin at the intake while alum lowers bloom', () => {
  const base = createSim(erie());
  base.setScenario({ windSpeed: 4, inflowCfs: 8000, airTempC: 27 });
  base.step(24 * 15);
  const massBefore = base.totalMass('P');

  const none = base.clone().step(24 * 10).metrics();
  const algae = base.clone();
  algae.addAction({ type: 'algaecide', site: 'toledo_intake', radius: 6, amount: 400 });
  const algaeM = algae.step(24 * 10).metrics();
  const alum = base.clone();
  alum.addAction({ type: 'alum', site: 'toledo_intake', radius: 8, amount: 8000 });
  const alumM = alum.step(24 * 10).metrics();

  assert.equal(base.totalMass('P'), massBefore, 'clones must not touch the original');
  assert.ok(algaeM.peakIntakeToxin > none.peakIntakeToxin, `algaecide ${algaeM.peakIntakeToxin} vs ${none.peakIntakeToxin}`);
  assert.ok(alumM.bloomKm2 <= none.bloomKm2, `alum ${alumM.bloomKm2} vs ${none.bloomKm2}`);
  assert.ok(alumM.planCostUsd > 0);
});
