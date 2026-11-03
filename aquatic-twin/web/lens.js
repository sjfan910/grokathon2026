// Molecular lens: tap the lake to zoom into a live molecular sketch of that spot.
// Illustrative particle dynamics, not a quantum or atomistic simulation. The local solver values set what appears.

const CPK = { O: '#ff4d4d', H: '#f4f7fb', C: '#8a93a0', P: '#ffa64d', N: '#5b8cff', tox: '#e8418f' };
const rand = (a, b) => a + Math.random() * (b - a);

function buildSystem(r, W, H, surf) {
  const beads = [], bonds = [];
  const add = (type, x, y, opts = {}) => { beads.push({ type, x, y, vx: 0, vy: 0, r: 5, ...opts }); return beads.length - 1; };

  const oilN = r.oil > 0.5 ? Math.min(7, 1 + Math.round(Math.log10(1 + r.oil) * 1.6)) : 0;
  for (let n = 0; n < oilN; n++) {
    if (n % 3 === 2) {  // a PAH: an aromatic ring that sticks with the slick and is what makes oil toxic to fish
      const cx = rand(60, W - 60), cy = surf + rand(14, 50), first = beads.length;
      for (let a = 0; a < 6; a++) add('ring', cx + Math.cos(a * Math.PI / 3) * 15, cy + Math.sin(a * Math.PI / 3) * 15, { r: 6 });
      for (let a = 0; a < 6; a++) {
        bonds.push([first + a, first + (a + 1) % 6, 15]);
        bonds.push([first + a, first + (a + 3) % 6, 30]);
      }
    } else {  // an alkane chain, like hexadecane
      const x0 = rand(50, W - 190), y0 = surf + rand(10, 50);
      let prev = -1;
      for (let c = 0; c < 16; c++) {
        const b = add('oil', x0 + c * 9, y0 + (c % 2) * 6, { r: 6 });
        if (prev >= 0) bonds.push([prev, b, 10]);
        prev = b;
      }
    }
  }
  const water = Math.max(45, 90 - oilN * 6);
  for (let n = 0; n < water; n++) add('water', rand(12, W - 12), rand(surf + 10, H - 12), { r: 8, angle: rand(0, 6.28), spin: rand(-0.05, 0.05) });
  for (let n = 0; n < Math.min(7, Math.round(r.oxygen)); n++) add('o2', rand(12, W - 12), rand(surf + 10, H - 12), { r: 7, angle: rand(0, 6.28), spin: rand(-0.06, 0.06) });
  for (let n = 0; n < Math.min(5, Math.round(r.phosphorus / 12)); n++) add('po4', rand(12, W - 12), rand(surf + 10, H - 12), { r: 10, angle: rand(0, 6.28), spin: rand(-0.04, 0.04) });
  if (r.toxin > 0.05) {  // microcystin's ring of seven amino acids, drawn as beads
    const cx = rand(90, W - 90), cy = rand(surf + 80, H - 70), first = beads.length;
    for (let a = 0; a < 7; a++) add('tox', cx + Math.cos(a * 6.283 / 7) * 22, cy + Math.sin(a * 6.283 / 7) * 22, { r: 7 });
    for (let a = 0; a < 7; a++) bonds.push([first + a, first + (a + 1) % 7, 19]);
  }
  return { beads, bonds };
}

function step(sys, W, H, surf, heat) {
  const { beads, bonds } = sys, n = beads.length;
  for (let a = 0; a < n; a++) {
    const p = beads[a];
    for (let b = a + 1; b < n; b++) {
      const q = beads[b], dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 > 3600 || d2 < 0.01) continue;
      const d = Math.sqrt(d2), hydroP = p.type === 'oil' || p.type === 'ring', hydroQ = q.type === 'oil' || q.type === 'ring';
      const contact = (p.r + q.r) * 1.25;
      let f = 0;
      if (d < contact) f = -(contact - d) * 0.14;  // molecules can't overlap
      else if (hydroP && hydroQ) f = 0.018;  // oil clusters: weak London dispersion plus the water pushing it together
      else if (hydroP !== hydroQ && d < contact * 1.5) f = -0.05;  // water holds onto its own network and leaves a gap around oil
      else if (p.type === 'water' && q.type === 'water' && d < 36) f = 0.012;  // hydrogen bonds
      p.vx += f * dx / d; p.vy += f * dy / d; q.vx -= f * dx / d; q.vy -= f * dy / d;
    }
  }
  for (const [a, b, len] of bonds) {
    const p = beads[a], q = beads[b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, f = (d - len) * 0.09;
    p.vx += f * dx / d; p.vy += f * dy / d; q.vx -= f * dx / d; q.vy -= f * dy / d;
  }
  for (const p of beads) {
    p.vx += rand(-heat, heat); p.vy += rand(-heat, heat);
    if (p.type === 'oil' || p.type === 'ring') p.vy -= 0.035;  // oil is less dense than water
    p.vx *= 0.9; p.vy *= 0.9;
    p.x += p.vx; p.y += p.vy;
    if (p.angle !== undefined) p.angle += p.spin + rand(-heat, heat) * 0.05;
    const top = p.type === 'water' || p.type === 'po4' || p.type === 'tox' ? surf + 10 : surf - 4;
    if (p.x < 8) { p.x = 8; p.vx = Math.abs(p.vx); } if (p.x > W - 8) { p.x = W - 8; p.vx = -Math.abs(p.vx); }
    if (p.y < top) { p.y = top; p.vy = Math.abs(p.vy); } if (p.y > H - 8) { p.y = H - 8; p.vy = -Math.abs(p.vy); }
  }
}

function atom(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.28, color); g.addColorStop(1, '#10151c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
}

function draw(ctx, sys, W, H, surf) {
  const { beads, bonds } = sys;
  const sky = ctx.createLinearGradient(0, 0, 0, surf);
  sky.addColorStop(0, '#0a1520'); sky.addColorStop(1, '#1b3a4d');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, surf);
  const sea = ctx.createLinearGradient(0, surf, 0, H);
  sea.addColorStop(0, '#0f5470'); sea.addColorStop(1, '#04202f');
  ctx.fillStyle = sea; ctx.fillRect(0, surf, W, H - surf);
  ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, surf); ctx.lineTo(W, surf); ctx.stroke();

  // Hydrogen bonds between neighboring waters, redrawn each frame because they keep breaking and re-forming.
  const water = beads.filter((b) => b.type === 'water');
  ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(120,210,255,.55)'; ctx.lineWidth = 1;
  for (let a = 0; a < water.length; a++) for (let b = a + 1; b < water.length; b++) {
    const dx = water[a].x - water[b].x, dy = water[a].y - water[b].y;
    if (dx * dx + dy * dy < 900) { ctx.beginPath(); ctx.moveTo(water[a].x, water[a].y); ctx.lineTo(water[b].x, water[b].y); ctx.stroke(); }
  }
  ctx.setLineDash([]);

  ctx.lineWidth = 3;
  for (const [a, b, len] of bonds) {
    if (len === 30) continue;
    const t = beads[a].type;
    ctx.strokeStyle = t === 'tox' ? '#ff9ad5' : t === 'ring' ? '#ffd27a' : '#b9c2cc';
    ctx.beginPath(); ctx.moveTo(beads[a].x, beads[a].y); ctx.lineTo(beads[b].x, beads[b].y); ctx.stroke();
  }
  for (const p of beads) {
    if (p.type === 'water') {
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      for (const off of [0.91, -0.91]) {  // water's bent shape, about 104.5 degrees
        const hx = p.x + (c * Math.cos(off) - s * Math.sin(off)) * 9, hy = p.y + (s * Math.cos(off) + c * Math.sin(off)) * 9;
        atom(ctx, hx, hy, 3.2, CPK.H);
      }
      atom(ctx, p.x, p.y, 6, CPK.O);
    } else if (p.type === 'o2') {
      atom(ctx, p.x - Math.cos(p.angle) * 5, p.y - Math.sin(p.angle) * 5, 5, '#ffb3b3');
      atom(ctx, p.x + Math.cos(p.angle) * 5, p.y + Math.sin(p.angle) * 5, 5, '#ffb3b3');
    } else if (p.type === 'po4') {
      for (let a = 0; a < 4; a++) atom(ctx, p.x + Math.cos(p.angle + a * 1.571) * 10, p.y + Math.sin(p.angle + a * 1.571) * 10, 4, CPK.O);
      atom(ctx, p.x, p.y, 6, CPK.P);
    } else if (p.type === 'tox') atom(ctx, p.x, p.y, 7, CPK.tox);
    else if (p.type === 'ring') atom(ctx, p.x, p.y, 5.5, '#ffb347');
    else atom(ctx, p.x, p.y, 5.5, CPK.C);
  }
}

export function openLens(host, reading, origin) {
  host.querySelector('.twin-lens')?.remove();
  const box = host.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'twin-lens';
  el.style.transformOrigin = `${origin.x - box.left}px ${origin.y - box.top}px`;
  const line = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const hasOil = reading.oil > 0.5;
  el.innerHTML = `
    <canvas></canvas>
    <button class="twin-lens-close" type="button">Close</button>
    <div class="twin-lens-card">
      <h3>Molecular view</h3>
      <div class="twin-lens-read">
        ${line('Oil', `${Math.round(reading.oil).toLocaleString()} µg/L`)}${line('Oxygen', `${reading.oxygen.toFixed(1)} mg/L`)}
        ${line('Phosphorus', `${reading.phosphorus.toFixed(1)} µg/L`)}${line('Toxin', `${reading.toxin.toFixed(2)} µg/L`)}
        ${line('Temperature', `${reading.temp.toFixed(1)} °C`)}${line('Depth here', `${reading.depth.toFixed(1)} m`)}
      </div>
      <ul class="twin-lens-key">
        <li><i style="background:${CPK.O}"></i>Water (H₂O), with hydrogen bonds dashed</li>
        ${hasOil ? `<li><i style="background:${CPK.C}"></i>Alkane chains, like hexadecane (C₁₆H₃₄)</li><li><i style="background:#ffb347"></i>Aromatic rings (PAHs), the toxic fraction</li>` : ''}
        <li><i style="background:#ffb3b3"></i>Dissolved oxygen (O₂)</li>
        <li><i style="background:${CPK.P}"></i>Phosphate (PO₄³⁻), which feeds algae</li>
        ${reading.toxin > 0.05 ? `<li><i style="background:${CPK.tox}"></i>Microcystin's ring of seven amino acids</li>` : ''}
      </ul>
      <p>${hasOil ? '<b>Oil never bonds to water.</b> Water’s hydrogen-bond network shuts nonpolar chains out, so they clump and float, held by weak London dispersion forces. That slick slows oxygen getting into the lake.' : '<b>Clean water here.</b> Hydrogen bonds keep breaking and re-forming. Spill oil, then look again to see water push it out.'}</p>
      <p class="twin-note">Illustrative sketch, not to scale or an atomistic simulation. Local values from the solver set which molecules appear and how fast they move.</p>
    </div>`;
  host.appendChild(el);
  const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  const W = el.clientWidth, H = el.clientHeight, surf = Math.round(H * 0.16);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const sys = buildSystem(reading, W, H, surf);
  const heat = 0.18 + Math.max(reading.temp, 0) * 0.012;
  let alive = true;
  const close = () => { alive = false; el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.twin-lens-close').onclick = close;
  for (let n = 0; n < 60; n++) step(sys, W, H, surf, heat);
  const tick = () => {
    if (!alive) return;
    step(sys, W, H, surf, heat);
    draw(ctx, sys, W, H, surf);
    requestAnimationFrame(tick);
  };
  tick();
  return close;
}
