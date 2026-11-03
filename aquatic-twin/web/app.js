// Wires the page together. Owner: Shanjay. window.twin = { sim, view } is there for console debugging.
import { createSim } from '/twin/solver.js';
import { createView, FIELD_STYLE } from '/twin/view.js';
import { makeExecutor, runOperator, replay } from '/twin/agent.js';
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
function setPlaying(on) { playing = on; $('play').textContent = on ? 'Pause' : 'Play'; }

for (const [name, st] of Object.entries(FIELD_STYLE)) $('field').add(new Option(st.label, name));
$('field').value = 'A';
const legend = () => { const st = FIELD_STYLE[view.field]; $('legend').textContent = `${st.label}: ${st.lo} to ${st.hi} ${st.unit}`; };
$('field').onchange = (e) => { view.setField(e.target.value); legend(); };
legend();
$('explode').oninput = (e) => view.setExplode(+e.target.value);
$('layerTo').max = scene.nz - 1; $('layerTo').value = scene.nz - 1;
$('layerTo').oninput = (e) => { view.setLayerRange(0, +e.target.value); $('layerToLabel').textContent = `Surface to layer ${+e.target.value + 1}`; };
$('play').onclick = () => { const stop = sim.actions.length ? MAX_DAY : DECISION_DAY; if (playing || sim.simDays < stop) setPlaying(!playing); };
$('speed').oninput = (e) => { stepsPerFrame = +e.target.value; };
$('reset').onclick = () => { sim.reset(); $('earnings').textContent = ''; $('dayNote').textContent = ''; setPlaying(true); };

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
  $('wind').value = BLOOM_SEASON.windSpeed; $('windDir').value = BLOOM_SEASON.windDir;
  $('inflow').value = BLOOM_SEASON.inflowCfs; $('air').value = BLOOM_SEASON.airTempC;
  sim.reset();
  readScenario();
  sim.step(24 * DECISION_DAY);
  view.update(sim);
  $('dayNote').textContent = '';
  log('call', `Set up a bloom-season scenario at day ${DECISION_DAY}: ${BLOOM_SEASON.inflowCfs} ft³/s river flow, ${BLOOM_SEASON.airTempC} °C air.`);
}

$('grokForm').onsubmit = async (e) => {
  e.preventDefault();
  if (trialRunning) return;
  trialRunning = true;
  prepareDecisionPoint();
  try { await runOperator($('goal').value, exec, log); showEarnings(); } catch (err) { log('error', err.message); }
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

let frame = 0;
function loop() {
  if (playing && !trialRunning) {
    sim.step(stepsPerFrame);
    // Without a plan the season stops at the decision point. With one, Play shows its effect for 30 more days.
    const stopDay = sim.actions.length ? MAX_DAY : DECISION_DAY;
    if (sim.simDays >= stopDay) {
      setPlaying(false);
      $('dayNote').textContent = sim.actions.length ? `Plan shown through day ${MAX_DAY}. Press Restart to run again.` : `Day ${DECISION_DAY}: the bloom is building. Run experiments to find a plan.`;
    }
  }
  if (!trialRunning) view.update(sim);
  if (frame++ % 15 === 0) {
    const m = sim.metrics();
    $('metrics').innerHTML = [['Day', m.simDays.toFixed(0)], ['Bloom', `${m.bloomKm2} km²`], ['Low-oxygen bed', `${m.hypoxicKm2} km²`],
      ['Toxin at intake', `${m.intakeToxin} µg/L`], ['Fish habitat', m.habitatIndex]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
  view.render();
  requestAnimationFrame(loop);
}
loop();
