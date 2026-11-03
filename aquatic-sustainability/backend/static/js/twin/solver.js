// Aquatic Twin solver. No DOM: runs in the browser, in Node and on the Grok Bot computer.
// Grid: terrain-following. Every wet column has nz layers of thickness depth/nz. k=0 is the surface.
// Field index: i + nx*(j + ny*k). i grows east, j grows north.
//
// Each step: horizontal advection-diffusion (explicit, flux form), vertical advection-diffusion
// (implicit tridiagonal per column), then reactions and actions. The flow comes from a wind-driven
// streamfunction, so it is divergence-free and mass is conserved to round-off.

// Screening values. Shija replaces these with sourced numbers.
export const DEFAULT_COEFFS = {
  dt: 3600, Kh: 20, r: 1e-3, driftFrac: 0.005, rhoAir: 1.2, Cd: 1.3e-3,
  KzMin: 1e-5, heatExchange: 7e-6,
  muMax: 1.0, death: 0.1, Topt: 25, Tw: 8, Kp: 5, ke0: 0.5, keA: 0.03, KI: 0.3,
  riseMperDay: 2, Yp: 1.0, recycle: 0.5, Yo: 0.13, respFrac: 0.8,
  yX: 0.05, lamX: 0.1, lysisX: 0.05,
  SOD: 2.5, relP: 10, inflowP: 300,
  bloomChl: 20, hypoxicO: 2,
  // Fish habitat oxygen limit, Arend et al. 2011 (Lake Erie): DOcrit = a + 0.168*T, a = 0.358 for yellow perch.
  doCritA: 0.358, doCritSlope: 0.168,
  // Oil (field L, ug/L total oil). SCREENING VALUES, shown as such on screen:
  // oilDecay 0.05/day biodegradation (assumption); oilO2 3.5 g O2 per g oil (stoichiometry, CH2 + 1.5 O2);
  // habitat penalty uses PAH fraction 0.02 of oil and EC50 50 ug/L PAH (zebrafish embryo proxy, Incardona 2005, not a walleye LC50);
  // oilCover: surface oil at which air-water O2 exchange is cut by 90% (assumption).
  oilDecay: 0.05, oilO2: 3.5, oilPahFrac: 0.02, oilEC50: 50, oilCover: 2000, oilVisible: 10,
};

// unitCostUsd values are placeholders, shown as such on screen.
export const ACTIONS = {
  alum:      { unit: 't alum',     unitCostUsd: 600,   kgPperT: 9, days: 3 },
  oxygen:    { unit: 't O2/day',   unitCostUsd: 150 },
  wetland:   { unit: 'ha',         unitCostUsd: 25000, haForHalf: 8000 },
  upstream:  { unit: 'fraction',   unitCostUsd: 2e8 },  // amount 0..0.4, cost per unit fraction per year
  algaecide: { unit: 't algaecide', unitCostUsd: 1500, tScale: 200 },
  // Oil. oilSpill is an event, not a purchase. Response costs are placeholders scaled from Etkin 2004
  // (DRAFT, 2002 dollars: ~$150 per gallon of crude with mechanical recovery; 1 t crude ~ 300 gal).
  oilSpill:   { unit: 't oil spilled', unitCostUsd: 0 },
  skimmer:    { unit: 't oil recovered', unitCostUsd: 45000, hours: 48 },
  dispersant: { unit: 't dispersant', unitCostUsd: 8000, oilPerT: 20 },  // trap: cheap, but drives oil into the water column
};

const STATE_FIELDS = ['T', 'P', 'A', 'O', 'X', 'H', 'L'];

export function createSim(scene, opts = {}) {
  const c = { ...DEFAULT_COEFFS, ...(opts.coeffs || {}) };
  const reactions = opts.reactions !== false;
  const { nx, ny, nz, dx_m: dx, dy_m: dy } = scene;
  const nCols = nx * ny, n = nCols * nz, dt = c.dt, area = dx * dy;
  const h = Float64Array.from(scene.depth_m);
  const wetCols = [];
  for (let q = 0; q < nCols; q++) if (h[q] > 0) wetCols.push(q);
  const invV = new Float64Array(nCols);
  for (const q of wetCols) invV[q] = nz / (area * h[q]);

  const fields = {};
  for (const name of STATE_FIELDS) fields[name] = new Float32Array(n);

  // Open faces between wet cells. Positive flux runs from L to R (west to east, south to north).
  const faceL = [], faceR = [], faceWidth = [], faceH = [], faceIsX = [], faceI = [], faceJ = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + nx * j;
    if (h[q] <= 0) continue;
    if (i + 1 < nx && h[q + 1] > 0) { faceL.push(q); faceR.push(q + 1); faceWidth.push(dy); faceH.push((h[q] + h[q + 1]) / 2); faceIsX.push(1); faceI.push(i + 1); faceJ.push(j); }
    if (j + 1 < ny && h[q + nx] > 0) { faceL.push(q); faceR.push(q + nx); faceWidth.push(dx); faceH.push((h[q] + h[q + nx]) / 2); faceIsX.push(0); faceI.push(i); faceJ.push(j + 1); }
  }
  const nF = faceL.length;
  const flux = new Float64Array(nF * nz);
  const faceD = new Float64Array(nF);
  for (let f = 0; f < nF; f++) {
    const dist = faceIsX[f] ? dx : dy;
    faceD[f] = c.Kh * (faceH[f] / nz) * faceWidth[f] / dist;
  }
  const wf = new Float64Array(nCols * (nz + 1));  // upward flux through the top of layer k
  const gShear = new Float64Array(nz);
  { let mean = 0;
    for (let k = 0; k < nz; k++) { const s = (k + 0.5) / nz; gShear[k] = 1 - 4 * s + 3 * s * s; mean += gShear[k] / nz; }
    for (let k = 0; k < nz; k++) gShear[k] -= mean; }

  // Streamfunction lives on cell corners; a corner touching land or the grid edge stays at zero.
  const nI = nx + 1, nJ = ny + 1;
  const psi = new Float64Array(nI * nJ), hc = new Float64Array(nI * nJ), interior = new Uint8Array(nI * nJ);
  for (let J = 0; J < nJ; J++) for (let I = 0; I < nI; I++) {
    let sum = 0, wet = 0, all = true;
    for (const [a, b] of [[I - 1, J - 1], [I, J - 1], [I - 1, J], [I, J]]) {
      if (a < 0 || b < 0 || a >= nx || b >= ny || h[a + nx * b] <= 0) { all = false; continue; }
      sum += h[a + nx * b]; wet++;
    }
    hc[I + nI * J] = wet ? sum / wet : 1;
    interior[I + nI * J] = all ? 1 : 0;
  }

  let scenario = { windSpeed: 6, windDir: 225, inflowCfs: 8000, airTempC: 26 };
  let subH = 1, ustar = 0, simDays = 0;
  let actions = [];
  let peakIntakeToxin = 0;
  const sites = (scene.sites || []).map((s) => ({ ...s, ...nearestWet(s.i, s.j), bloomDays: 0 }));
  const sources = (scene.sources || []).map((s) => ({ ...s, ...nearestWet(s.i, s.j) }));
  const intake = sites.find((s) => s.id.includes('intake')) || sites[0];

  function nearestWet(i, j) {
    let best = null, bestD = Infinity;
    for (const q of wetCols) {
      const a = q % nx, b = (q - a) / nx, d = (a - i) ** 2 + (b - j) ** 2;
      if (d < bestD) { bestD = d; best = { i: a, j: b }; }
    }
    return best || { i, j };
  }

  function reset() {
    fields.T.fill(0); fields.P.fill(0); fields.A.fill(0); fields.O.fill(0); fields.X.fill(0); fields.H.fill(0); fields.L.fill(0);
    for (const q of wetCols) for (let k = 0; k < nz; k++) {
      const m = q + nCols * k;
      fields.T[m] = 20; fields.P[m] = 8; fields.A[m] = 2; fields.O[m] = 9; fields.X[m] = 0; fields.H[m] = 1;
    }
    simDays = 0; peakIntakeToxin = 0; actions = [];
    for (const s of sites) s.bloomDays = 0;
  }

  function solveFlow() {
    const W = scenario.windSpeed, th = scenario.windDir * Math.PI / 180;
    const wx = -Math.sin(th), wy = -Math.cos(th);   // windDir is the direction the wind comes from
    const tauRho = c.rhoAir * c.Cd * W * W / 1000;
    ustar = Math.sqrt(tauRho);
    psi.fill(0);
    if (W > 0) {
      const cx = 1 / (dx * dx), cy = 1 / (dy * dy);
      const rhs = new Float64Array(nI * nJ);
      for (let J = 1; J < nJ - 1; J++) for (let I = 1; I < nI - 1; I++) {
        const m = I + nI * J;
        if (!interior[m]) continue;
        const dInvDx = (1 / hc[m + 1] - 1 / hc[m - 1]) / (2 * dx);
        const dInvDy = (1 / hc[m + nI] - 1 / hc[m - nI]) / (2 * dy);
        rhs[m] = (tauRho / c.r) * (wy * dInvDx - wx * dInvDy);
      }
      const coef = (a, b) => { const d = (hc[a] + hc[b]) / 2; return 1 / (d * d); };
      for (let it = 0; it < 400; it++) for (let J = 1; J < nJ - 1; J++) for (let I = 1; I < nI - 1; I++) {
        const m = I + nI * J;
        if (!interior[m]) continue;
        const e = coef(m, m + 1) * cx, w = coef(m, m - 1) * cx, no = coef(m, m + nI) * cy, so = coef(m, m - nI) * cy;
        const next = (e * psi[m + 1] + w * psi[m - 1] + no * psi[m + nI] + so * psi[m - nI] - rhs[m]) / (e + w + no + so);
        psi[m] += 1.7 * (next - psi[m]);
      }
    }
    const drift = c.driftFrac * W;
    for (let f = 0; f < nF; f++) {
      const I = faceI[f], J = faceJ[f];
      const bt = faceIsX[f] ? -(psi[I + nI * (J + 1)] - psi[I + nI * J]) : psi[I + 1 + nI * J] - psi[I + nI * J];
      const s = drift * (faceIsX[f] ? wx : wy);
      for (let k = 0; k < nz; k++) flux[f + nF * k] = bt / nz + s * gShear[k] * (faceH[f] / nz) * faceWidth[f];
    }
    // Continuity sets the flux through each layer's top, integrating up from a closed bed.
    const net = new Float64Array(nCols * nz);
    let maxCfl = 0;
    const out = new Float64Array(nCols * nz);
    for (let k = 0; k < nz; k++) for (let f = 0; f < nF; f++) {
      const F = flux[f + nF * k], L = faceL[f] + nCols * k, R = faceR[f] + nCols * k;
      net[L] += F; net[R] -= F;
      if (F > 0) out[L] += F; else out[R] -= F;
    }
    wf.fill(0);
    for (const q of wetCols) {
      for (let k = nz - 1; k >= 0; k--) {
        wf[q + (nz + 1) * 0 + nCols * k] = wf[q + nCols * (k + 1)] - net[q + nCols * k];
        maxCfl = Math.max(maxCfl, out[q + nCols * k] * invV[q] * dt);
      }
    }
    subH = Math.min(24, Math.max(1, Math.ceil(maxCfl / 0.7)));
  }

  const tmp = new Float32Array(n);
  function horizontal(C) {
    const dts = dt / subH;
    tmp.set(C);
    for (let k = 0; k < nz; k++) {
      const off = nCols * k, fo = nF * k;
      for (let f = 0; f < nF; f++) {
        const F = flux[f + fo], L = faceL[f], R = faceR[f], cL = C[L + off], cR = C[R + off];
        const q = (F > 0 ? F * cL : F * cR) + faceD[f] * (cL - cR);
        tmp[L + off] -= q * dts * invV[L];
        tmp[R + off] += q * dts * invV[R];
      }
    }
    C.set(tmp);
  }

  const a = new Float64Array(nz), b = new Float64Array(nz), cc = new Float64Array(nz), cp = new Float64Array(nz), rhsV = new Float64Array(nz), Dz = new Float64Array(nz + 1);
  function solveColumn(C, q) {
    rhsV[0] = C[q] / b[0];
    for (let k = 1; k < nz; k++) rhsV[k] = (C[q + nCols * k] - a[k] * rhsV[k - 1]) / (b[k] - a[k] * cp[k - 1]);
    C[q + nCols * (nz - 1)] = rhsV[nz - 1];
    for (let k = nz - 2; k >= 0; k--) { rhsV[k] -= cp[k] * rhsV[k + 1]; C[q + nCols * k] = rhsV[k]; }
  }
  function factor(q, beta, extra) {
    for (let k = 0; k < nz; k++) {
      const wT = k === 0 ? 0 : wf[q + nCols * k] + extra;
      const wB = k === nz - 1 ? 0 : wf[q + nCols * (k + 1)] + extra;
      a[k] = beta * (Math.min(wT, 0) - Dz[k]);
      cc[k] = beta * (-Math.max(wB, 0) - Dz[k + 1]);
      b[k] = 1 + beta * (Math.max(wT, 0) - Math.min(wB, 0) + Dz[k] + Dz[k + 1]);
    }
    cp[0] = cc[0] / b[0];
    for (let k = 1; k < nz; k++) cp[k] = cc[k] / (b[k] - a[k] * cp[k - 1]);
  }
  function vertical() {
    const rise = reactions ? (c.riseMperDay / 86400) * area : 0;
    const T = fields.T;
    for (const q of wetCols) {
      const dz = h[q] / nz, beta = (dt / subH) / (area * dz), S = ustar / (0.2 * h[q] + 0.1);
      const Kz0 = 0.4 * ustar * h[q] / 6;
      Dz[0] = 0; Dz[nz] = 0;
      for (let k = 1; k < nz; k++) {
        const up = T[q + nCols * (k - 1)], lo = T[q + nCols * k], dT = up - lo;
        let Kz;
        if (dT < -0.01) Kz = 0.05;
        else {
          const alpha = 6.8e-6 * Math.abs((up + lo) / 2 - 4) + 1e-6;
          const Ri = S > 0 ? 9.81 * alpha * Math.max(dT, 0) / dz / (S * S) : 100;
          Kz = c.KzMin + Kz0 / ((1 + 5 * Ri) * (1 + 5 * Ri));
        }
        Dz[k] = Kz * area / dz;
      }
      factor(q, beta, 0);
      solveColumn(fields.T, q); solveColumn(fields.P, q); solveColumn(fields.O, q); solveColumn(fields.X, q);
      if (rise) factor(q, beta, rise);
      solveColumn(fields.A, q); solveColumn(fields.L, q);  // oil floats, like algae (same rise speed: assumption)
    }
  }

  function inflowFactor() {
    let keep = 1;
    for (const act of actions) {
      if (act.type === 'wetland') keep *= 1 - 0.5 * Math.min(1, act.amount / ACTIONS.wetland.haForHalf);
      if (act.type === 'upstream') keep *= 1 - Math.min(0.4, act.amount);
    }
    return keep;
  }

  function applySources() {
    const Q = scenario.inflowCfs * 0.0283168;
    for (const s of sources) {
      const cols = patch(s.i, s.j, 1);
      if (!cols.length) continue;
      let vol = 0;
      for (const q of cols) vol += area * h[q];
      const dC = Q * c.inflowP * inflowFactor() * dt / vol;  // mg/m3 equals ug/L
      for (const q of cols) for (let k = 0; k < nz; k++) fields.P[q + nCols * k] += dC;
    }
  }

  function patch(i, j, radius) {
    const cols = [];
    for (let b2 = j - radius; b2 <= j + radius; b2++) for (let a2 = i - radius; a2 <= i + radius; a2++) {
      if (a2 < 0 || b2 < 0 || a2 >= nx || b2 >= ny) continue;
      if ((a2 - i) ** 2 + (b2 - j) ** 2 > radius * radius) continue;
      const q = a2 + nx * b2;
      if (h[q] > 0) cols.push(q);
    }
    return cols;
  }

  function applyActions() {
    for (const act of actions) {
      act.ageH += dt / 3600;
      if (act.type === 'alum' && act.ageH <= ACTIONS.alum.days * 24) {
        const kg = act.amount * ACTIONS.alum.kgPperT / (ACTIONS.alum.days * 24) * (dt / 3600);
        let mass = 0;
        for (const q of act.cols) for (let k = 0; k < nz; k++) mass += fields.P[q + nCols * k] * area * h[q] / nz / 1e6;
        const keep = 1 - Math.min(0.9, mass > 0 ? kg / mass : 0);
        for (const q of act.cols) for (let k = 0; k < nz; k++) fields.P[q + nCols * k] *= keep;
      }
      if (act.type === 'oxygen') {
        let vol = 0;
        for (const q of act.cols) vol += area * h[q] / nz;
        const d = vol > 0 ? act.amount * 1e6 / 24 * (dt / 3600) / vol : 0;
        for (const q of act.cols) { const m = q + nCols * (nz - 1); fields.O[m] = Math.min(fields.O[m] + d, 14); }
      }
      if (act.type === 'algaecide' && act.ageH <= 24) {
        const total = 1 - Math.exp(-act.amount / ACTIONS.algaecide.tScale);
        const f = 1 - Math.pow(1 - total, (dt / 3600) / 24);
        for (const q of act.cols) for (let k = 0; k < nz; k++) {
          const m = q + nCols * k, killed = fields.A[m] * f;
          fields.A[m] -= killed;
          fields.X[m] += c.lysisX * killed;
        }
      }
      if (act.type === 'oilSpill' && !act.done) {  // release into the surface layer of the patch
        act.done = true;
        let vol = 0;
        for (const q of act.cols) vol += area * h[q] / nz;
        const d = vol > 0 ? act.amount * 1e9 / vol : 0;  // tonnes -> mg, per m3 = ug/L
        for (const q of act.cols) fields.L[q] += d;
      }
      if (act.type === 'skimmer' && act.ageH <= ACTIONS.skimmer.hours) {  // remove surface oil, up to its capacity
        let mass = 0;
        for (const q of act.cols) mass += fields.L[q] * area * h[q] / nz / 1e9;
        const t = act.amount / ACTIONS.skimmer.hours * (dt / 3600);
        const keep = 1 - Math.min(0.5, mass > 0 ? t / mass : 0);
        for (const q of act.cols) fields.L[q] *= keep;
      }
      if (act.type === 'dispersant' && act.ageH <= 1) {  // spread surface oil through the whole column
        let mass = 0;
        for (const q of act.cols) mass += fields.L[q] * area * h[q] / nz / 1e9;
        const f = Math.min(0.8, mass > 0 ? act.amount * ACTIONS.dispersant.oilPerT / mass : 0);
        for (const q of act.cols) {
          const moved = fields.L[q] * f;
          fields.L[q] -= moved;
          for (let k = 0; k < nz; k++) fields.L[q + nCols * k] += moved / nz;  // same mass, now in every layer
        }
      }
    }
  }

  function react() {
    const dtd = dt / 86400, { T, P, A, O, X, H, L } = fields;
    const Ta = scenario.airTempC, ka = (0.5 + 0.03 * scenario.windSpeed ** 2) / 86400;
    for (const q of wetCols) {
      const dz = h[q] / nz;
      for (let k = 0; k < nz; k++) {
        const m = q + nCols * k;
        let t = T[m], p = Math.max(P[m], 0), al = Math.max(A[m], 0), o = Math.max(O[m], 0), x = Math.max(X[m], 0), oil = Math.max(L[m], 0);
        const I = Math.exp(-(c.ke0 + c.keA * al) * (k + 0.5) * dz);
        const fT = Math.exp(-(((t - c.Topt) / c.Tw) ** 2));
        const mu = c.muMax * fT * (I / (I + c.KI)) * (p / (p + c.Kp));
        const grow = Math.min(mu * al * dtd, p / c.Yp), die = c.death * al * dtd;
        al += grow - die;
        p += c.Yp * (c.recycle * die - grow);
        o += c.Yo * (grow - c.respFrac * die);
        x += c.yX * mu * A[m] * dtd - c.lamX * x * dtd;
        if (oil > 0) { const deg = c.oilDecay * oil * dtd; oil -= deg; o -= c.oilO2 * deg * 1e-3; }
        if (k === 0) {
          t += Math.min(1, c.heatExchange * dt / dz) * (Ta - t);
          const sat = 14.6 - 0.39 * t + 0.007 * t * t;
          o += Math.min(1, ka * dt / dz) * (1 - 0.9 * Math.min(1, oil / c.oilCover)) * (sat - o);
        }
        if (k === nz - 1) {
          o -= Math.min(o, c.SOD * fT * (o / (o + 1)) / dz * dtd);
          p += c.relP * Math.max(0, (c.hypoxicO - o) / c.hypoxicO) / dz * dtd;
        }
        T[m] = t; P[m] = Math.max(p, 0); A[m] = Math.max(al, 0); O[m] = Math.max(o, 0); X[m] = Math.max(x, 0); L[m] = Math.max(oil, 0);
        // Oxygen limit from Arend et al. 2011 (yellow perch); temperature curve is walleye-like (optimum 20-22 C).
        const fO = Math.min(1, Math.max(0, o / (c.doCritA + c.doCritSlope * t)));
        const pah = oil * c.oilPahFrac, fOil = 1 / (1 + (pah / c.oilEC50) ** 2);
        H[m] = fO * Math.exp(-(((t - 20) / 6) ** 2)) * fOil;
      }
    }
  }

  function track() {
    if (intake) peakIntakeToxin = Math.max(peakIntakeToxin, fields.X[intake.i + nx * intake.j + nCols * Math.floor(nz / 2)]);
    for (const s of sites) {
      const cols = patch(s.i, s.j, 2);
      let bloom = false;
      for (const q of cols) if (fields.A[q] > c.bloomChl) { bloom = true; break; }
      if (bloom) s.bloomDays += dt / 86400;
    }
  }

  function step(steps = 1) {
    for (let s = 0; s < steps; s++) {
      if (reactions) applySources();
      // Horizontal and vertical stay paired in each substep: that is what keeps a uniform field uniform.
      for (let sub = 0; sub < subH; sub++) {
        for (const name of ['T', 'P', 'A', 'O', 'X', 'L']) horizontal(fields[name]);
        vertical();
      }
      if (reactions) { react(); applyActions(); }
      simDays += dt / 86400;
      track();
    }
    return sim;
  }

  function metrics() {
    const km2 = area / 1e6;
    let hypoxic = 0, bloom = 0, habSum = 0, volSum = 0, oilKm2 = 0, oilT = 0, oiledHabitatKm2 = 0;
    for (const q of wetCols) {
      if (fields.L[q] > c.oilVisible) oilKm2 += km2;
      let oilMax = 0;
      for (let k = 0; k < nz; k++) { const v = fields.L[q + nCols * k]; oilT += v * area * h[q] / nz / 1e9; oilMax = Math.max(oilMax, v); }
      if (oilMax * c.oilPahFrac > 0.3 * c.oilEC50) oiledHabitatKm2 += km2;  // habitat cut by roughly 8% or more
      if (fields.O[q + nCols * (nz - 1)] < c.hypoxicO) hypoxic += km2;
      if (fields.A[q] > c.bloomChl) bloom += km2;
      for (let k = 0; k < nz; k++) { habSum += fields.H[q + nCols * k] * h[q]; volSum += h[q]; }
    }
    const materials = actions.map((act) => {
      const meta = ACTIONS[act.type], days = act.type === 'oxygen' ? Math.max(act.ageH / 24, 1) : 1;
      return { type: act.type, amount: act.amount, unit: meta.unit, costUsd: act.amount * meta.unitCostUsd * days };
    });
    return {
      simDays: +simDays.toFixed(2),
      hypoxicKm2: Math.round(hypoxic), bloomKm2: Math.round(bloom),
      intakeToxin: intake ? +fields.X[intake.i + nx * intake.j + nCols * Math.floor(nz / 2)].toFixed(3) : 0,
      peakIntakeToxin: +peakIntakeToxin.toFixed(3),
      oilKm2: Math.round(oilKm2), oilTonnes: +oilT.toFixed(1), oiledHabitatKm2: Math.round(oiledHabitatKm2),
      intakeOil: intake ? +fields.L[intake.i + nx * intake.j + nCols * Math.floor(nz / 2)].toFixed(2) : 0,
      habitatIndex: +(volSum ? habSum / volSum : 0).toFixed(3),
      siteBloomDays: Object.fromEntries(sites.map((s) => [s.id, +s.bloomDays.toFixed(1)])),
      materials,
      planCostUsd: Math.round(materials.reduce((t, m) => t + m.costUsd, 0)),
    };
  }

  function addAction({ type, site, i, j, radius = 4, amount }) {
    if (!ACTIONS[type]) throw new Error(`Unknown action type: ${type}`);
    if (!(amount > 0)) throw new Error('Action amount must be positive');
    const found = site ? sites.find((s) => s.id === site) || sources.find((s) => s.id === site) : null;
    if (site && !found) throw new Error(`Unknown site: ${site}`);
    const at = found || nearestWet(i ?? 0, j ?? 0);
    actions.push({ type, i: at.i, j: at.j, radius, amount, ageH: 0, cols: patch(at.i, at.j, radius) });
  }

  function setScenario(next) {
    const windChanged = next.windSpeed !== undefined && next.windSpeed !== scenario.windSpeed
      || next.windDir !== undefined && next.windDir !== scenario.windDir;
    scenario = { ...scenario, ...next };
    if (windChanged) solveFlow();
  }

  function clone() {
    const copy = createSim(scene, opts);
    copy.importState(exportState());
    return copy;
  }
  function exportState() {
    return { scenario: { ...scenario }, simDays, peakIntakeToxin, fields,
      actions: actions.map((x) => ({ ...x })), siteDays: sites.map((s) => s.bloomDays) };
  }
  function importState(st) {
    scenario = { ...st.scenario }; solveFlow();
    for (const name of STATE_FIELDS) fields[name].set(st.fields[name]);
    simDays = st.simDays; peakIntakeToxin = st.peakIntakeToxin;
    actions = st.actions.map((x) => ({ ...x }));
    sites.forEach((s, m) => { s.bloomDays = st.siteDays[m]; });
  }

  const sim = {
    scene, fields, step, metrics, addAction, setScenario, clone, reset, exportState, importState,
    get scenario() { return { ...scenario }; },
    get simDays() { return simDays; },
    get sites() { return sites; },
    get wetCols() { return wetCols; },
    get actions() { return actions; },
    columnFlowX(i, j) {
      for (let f = 0; f < nF; f++) if (faceIsX[f] && faceI[f] === i && faceJ[f] === j) {
        let t = 0; for (let k = 0; k < nz; k++) t += flux[f + nF * k];
        return t;
      }
      return 0;
    },
    totalMass(name) {
      let t = 0;
      for (const q of wetCols) for (let k = 0; k < nz; k++) t += fields[name][q + nCols * k] * h[q];
      return t;
    },
  };
  reset();
  solveFlow();
  return sim;
}
