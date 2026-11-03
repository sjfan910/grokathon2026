// Wires the page together. Owner: Shanjay. window.twin = { sim, view } is there for console debugging.
import { createSim } from '/twin/solver.js';
import { createView, FIELD_STYLE } from '/twin/view.js';
import { makeExecutor, runOperator, replay } from '/twin/agent.js';
import { analyze, renderAnalysis } from '/twin/analyst.js';
import { earningsCall, renderEarnings, renderFishMarket } from '/twin/econ.js';

const $ = (id) => document.getElementById(id);
const scene = await (await fetch('/twin/erie.scene.json')).json();
const sim = createSim(scene);
const view = createView($('twinCanvas'), scene, $('twinLabels'));
window.twin = { sim, view };

if (scene.placeholder) $('twinBadge').hidden = false;
fetch('/api/twin/provider').then((r) => r.json()).then((p) => { $('operatorTitle').textContent = `AI operator: ${p.label}`; }).catch(() => {});
let playing = true, stepsPerFrame = 1;
// The decision point: a fresh bloom hasn't peaked before about day 15, and past about day 25 no plan under budget works.
const BLOOM_SEASON = { windSpeed: 4, windDir: 225, inflowCfs: 8000, airTempC: 27 }, DECISION_DAY = 15, MAX_DAY = 45;
let spillUntil = 0;
const stopAt = () => Math.max(spillUntil, sim.actions.length ? MAX_DAY : DECISION_DAY);
function setPlaying(on) { playing = on; $('play').textContent = on ? 'Pause' : 'Play'; }

for (const [name, st] of Object.entries(FIELD_STYLE)) $('field').add(new Option(st.label, name));
$('field').value = 'A';
const legend = () => { const st = FIELD_STYLE[view.field]; $('legend').textContent = `${st.label}: ${st.lo} to ${st.hi} ${st.unit}`; };
$('field').onchange = (e) => { view.setField(e.target.value); legend(); };
legend();
$('explode').oninput = (e) => view.setExplode(+e.target.value);
$('layerTo').max = scene.nz - 1; $('layerTo').value = scene.nz - 1;
$('layerTo').oninput = (e) => { view.setLayerRange(0, +e.target.value); $('layerToLabel').textContent = `Surface to layer ${+e.target.value + 1}`; };
$('play').onclick = () => { if (playing || sim.simDays < stopAt()) setPlaying(!playing); };
$('speed').oninput = (e) => { stepsPerFrame = +e.target.value; };
$('reset').onclick = () => { spillUntil = 0; sim.reset(); $('earnings').textContent = ''; $('dayNote').textContent = ''; setPlaying(true); };

function readScenario() {
  sim.setScenario({ windSpeed: +$('wind').value, windDir: +$('windDir').value, inflowCfs: +$('inflow').value, airTempC: +$('air').value });
}
for (const id of ['wind', 'windDir', 'inflow', 'air']) $(id).onchange = readScenario;
readScenario();

$('live').onclick = async () => {
  const note = $('liveNote');
  note.textContent = 'Loading today’s river and wind…';
  try {
    const r = await (await fetch('/api/twin/live')).json();
    if (r.inflowCfs != null) $('inflow').value = r.inflowCfs;
    if (r.windSpeed != null) { $('wind').value = r.windSpeed; $('windDir').value = r.windDir; $('air').value = r.airTempC; }
    readScenario();
    note.textContent = `Live: Maumee ${r.inflowCfs ?? '?'} ft³/s, wind ${r.windSpeed ?? '?'} m/s from ${r.windDir ?? '?'}°, air ${r.airTempC ?? '?'} °C`;
  } catch (e) { note.textContent = `Live data failed: ${e.message}. Using the values below.`; }
};

// Holds Grok's view of the world still while it runs what-if trials on clones.
let trialRunning = false;
const log = (kind, text) => {
  const line = document.createElement('div');
  line.className = `twin-log-${kind}`;
  line.textContent = text;
  $('grokLog').appendChild(line);
  $('grokLog').scrollTop = 1e6;
};
const exec = makeExecutor({ getSim: () => sim, view, onPlanApplied: () => showEarnings() });

// Experiments always start from the same honest setup, whatever the page was doing before.
function prepareDecisionPoint() {
  setPlaying(false);
  spillUntil = 0;
  $('wind').value = BLOOM_SEASON.windSpeed; $('windDir').value = BLOOM_SEASON.windDir;
  $('inflow').value = BLOOM_SEASON.inflowCfs; $('air').value = BLOOM_SEASON.airTempC;
  sim.reset();
  readScenario();
  sim.step(24 * DECISION_DAY);
  drawCompass();
  view.update(sim);
  $('dayNote').textContent = '';
  log('call', `Set up a bloom-season scenario at day ${DECISION_DAY}: ${BLOOM_SEASON.inflowCfs} ft³/s river flow, ${BLOOM_SEASON.airTempC} °C air.`);
}

$('grokForm').onsubmit = async (e) => {
  e.preventDefault();
  if (trialRunning) return;
  trialRunning = true;
  prepareDecisionPoint();
  try {
    await runOperator($('goal').value, exec, log);
  } catch (err) {
    log('error', `${err.message} Showing a saved run instead.`);
    prepareDecisionPoint();
    const saved = await (await fetch('/twin/saved-run.json')).json();
    await replay(saved, exec, log);
  }
  showEarnings();
  trialRunning = false;
};
$('replay').onclick = async () => {
  let run = null;
  try { run = JSON.parse(localStorage.getItem('twinLastRun')); } catch { /* fall through to the file */ }
  if (!run) { const r = await fetch('/twin/saved-run.json'); run = r.ok ? await r.json() : null; }
  if (!run) { log('error', 'No saved run yet. Finish one operator run first.'); return; }
  if (trialRunning) return;
  trialRunning = true;
  prepareDecisionPoint();
  try { await replay(run, exec, log); showEarnings(); } catch (err) { log('error', err.message); }
  trialRunning = false;
};

function showEarnings(days = 30) {
  const plan = sim.clone(), base = sim.clone();
  const st = base.exportState();
  st.actions = st.actions.filter((a) => a.type === 'oilSpill');  // the spill is the incident, not part of the plan
  base.importState(st);
  const mBase = base.step(24 * days).metrics(), mPlan = plan.step(24 * days).metrics();
  renderEarnings($('earnings'), earningsCall(mBase, mPlan), mPlan);
  if ($('fishMarket')) renderFishMarket($('fishMarket'), mBase, mPlan);
}
$('earningsBtn').onclick = () => showEarnings();

// Hands-on mode: click the lake to spill oil, drag the compass to change the wind. Both feed the real solver.
const SPILL_TONNES = 5000;
function spillAt(i, j) {
  if (trialRunning) return;
  sim.addAction({ type: 'oilSpill', i, j, radius: 2, amount: SPILL_TONNES });
  spillUntil = sim.simDays + 30;
  view.pulse(i, j);
  view.setField('L'); $('field').value = 'L'; legend();
  $('dayNote').textContent = `${SPILL_TONNES.toLocaleString()} t of oil spilled. Drag the wind compass to push it around.`;
  setPlaying(true);
}
view.onLakeClick(spillAt);
window.twin.spillAt = spillAt;

function setWindFrom(deg) {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  $('windDir').value = d;
  readScenario();
  drawCompass();
}
function drawCompass() {
  $('compassArrow').style.transform = `rotate(${+$('windDir').value + 180}deg)`;
  $('compassLabel').textContent = `Wind from ${$('windDir').value}° · ${$('wind').value} m/s`;
}
const dial = $('compass');
const dragWind = (e) => {
  const b = dial.getBoundingClientRect();
  // The arrow points where the wind blows, so the wind comes from the opposite side.
  setWindFrom(Math.atan2(e.clientX - (b.left + b.width / 2), -(e.clientY - (b.top + b.height / 2))) * 180 / Math.PI + 180);
};
dial.addEventListener('pointerdown', (e) => { dial.setPointerCapture(e.pointerId); dragWind(e); });
dial.addEventListener('pointermove', (e) => { if (dial.hasPointerCapture(e.pointerId)) dragWind(e); });
$('stormWind').oninput = (e) => { $('wind').value = e.target.value; readScenario(); drawCompass(); };
for (const id of ['wind', 'windDir']) $(id).addEventListener('change', drawCompass);
drawCompass();
window.twin.setWindFrom = setWindFrom;

let frame = 0, latestAnalysis = null, latestMetrics = null;

// Optional written commentary from a live model. Off unless ANALYST_PROVIDER is set in aquatic-twin/.env.
fetch('/api/twin/provider').then((r) => r.json()).then((p) => {
  if (!p.analyst || p.analyst === 'local') return;
  $('analystNote').textContent = `Engine: local rules, with commentary from ${p.analystLabel}. Dollar figures rest on published anchors and labelled assumptions.`;
  let askedDay = -1;
  const ask = async () => {
    // Only spend a call when the lake has actually changed.
    if (!latestMetrics || latestMetrics.simDays === askedDay) return;
    askedDay = latestMetrics.simDays;
    try {
      const r = await fetch('/api/twin/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metrics: latestMetrics, issues: latestAnalysis.issues }) });
      const d = await r.json();
      if (r.ok && d.narrative) { $('narrative').textContent = d.narrative; $('narrative').hidden = false; }
    } catch { /* the local panel keeps working */ }
  };
  ask();
  setInterval(ask, 30000);
}).catch(() => {});
function loop() {
  if (playing && !trialRunning) {
    sim.step(stepsPerFrame);
    // Without a plan the season stops at the decision point. With one, Play shows its effect for 30 more days.
    const stopDay = stopAt();
    if (sim.simDays >= stopDay) {
      setPlaying(false);
      $('dayNote').textContent = sim.actions.length ? `Shown through day ${Math.round(stopDay)}. Press Restart to run again.` : `Day ${DECISION_DAY}: the bloom is building. Run experiments, or click the lake to spill oil.`;
    }
  }
  if (!trialRunning) view.update(sim);
  if (frame++ % 15 === 0) {
    const m = sim.metrics();
    latestAnalysis = analyze(m);
    renderAnalysis($('analysis'), latestAnalysis);
    latestMetrics = m;
    $('metrics').innerHTML = [['Day', m.simDays.toFixed(0)], ['Bloom', `${m.bloomKm2} km²`], ['Low-oxygen bed', `${m.hypoxicKm2} km²`],
      ['Toxin at intake', `${m.intakeToxin} µg/L`], ['Fish habitat', m.habitatIndex]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
  view.render();
  requestAnimationFrame(loop);
}
loop();
