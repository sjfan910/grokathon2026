// Runs the solver with no browser. This is what the scheduled watcher calls.
//   node headless.js --days 14 --live --actions '[{"type":"alum","site":"toledo_intake","amount":8000}]'
// Prints JSON. Set "alert": true when a person should be asked to decide.
import { readFileSync } from 'node:fs';
import { createSim } from './solver.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => { const n = argv.indexOf(`--${name}`); return n >= 0 ? argv[n + 1] : fallback; };

// WHO's provisional drinking-water guideline for microcystin-LR is 1 µg/L. Tune this before the demo.
export function shouldAlert(m, limit = 1) {
  return m.peakIntakeToxin >= limit;
}

async function liveScenario() {
  const out = {};
  try {
    const u = await (await fetch('https://waterservices.usgs.gov/nwis/iv/?sites=04193500&parameterCd=00060&format=json')).json();
    out.inflowCfs = +u.value.timeSeries[0].values[0].value.at(-1).value;
  } catch (e) { console.error(`USGS failed: ${e.message}`); }
  try {
    const w = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.7&longitude=-83&current=wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=ms')).json();
    Object.assign(out, { windSpeed: w.current.wind_speed_10m, windDir: w.current.wind_direction_10m, airTempC: w.current.temperature_2m });
  } catch (e) { console.error(`Open-Meteo failed: ${e.message}`); }
  return out;
}

const scene = JSON.parse(readFileSync(new URL('./erie.scene.json', import.meta.url)));
const sim = createSim(scene);
const live = flag('live') ? await liveScenario() : {};
sim.setScenario({ ...JSON.parse(opt('scenario', '{}')), ...live });
for (const a of JSON.parse(opt('actions', '[]'))) sim.addAction(a);
const days = +opt('days', 30);
const started = Date.now();
sim.step(24 * days);
const metrics = sim.metrics();
console.log(JSON.stringify({
  days, scenario: sim.scenario, live, metrics, alert: shouldAlert(metrics),
  placeholderLakebed: !!scene.placeholder, runtimeMs: Date.now() - started,
}, null, 2));
