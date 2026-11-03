// Live analysis: turns the solver's current metrics into economic and biodiversity issues.
// Local rules, no network. Every dollar figure comes from fishMarket() in econ.js, with its assumptions.
import { fishMarket, triggers } from './econ.js';

const usd = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}K`);
const RANK = { high: 0, medium: 1, low: 2 };

export function analyze(m) {
  const fish = fishMarket(m), issues = [];
  const add = (severity, title, detail) => issues.push({ severity, title, detail });
  const habitatLoss = Math.max(0, 1 - m.habitatIndex);
  const hitHarbors = fish.towns.filter((t) => t.tripLoss > 0.01);

  if (m.intakeToxin >= 1.6) add('high', 'Toxin at the Toledo intake is above Ohio’s level for everyone', `Raw water reads ${m.intakeToxin} µg/L. Treatment costs rise and a do-not-drink decision comes into play.`);
  else if (m.intakeToxin >= 1) add('high', 'Toxin at the Toledo intake is above the 1 µg/L guideline', `Raw water reads ${m.intakeToxin} µg/L, so the treatment plant has to work much harder.`);
  else if (m.intakeToxin >= 0.3) add('medium', 'Toxin passed Ohio’s level for children and sensitive groups', `Raw water reads ${m.intakeToxin} µg/L. Expect more monitoring and treatment spending.`);

  for (const t of hitHarbors) {
    const name = t.id === 'toledo_intake' ? 'Toledo' : t.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    add(t.tripLoss >= 0.2 ? 'high' : 'medium', `${name} fishing trips are down about ${Math.round(t.tripLoss * 100)}%`, `The bloom near the harbor puts about ${usd(t.usd)} of angler spending at risk.`);
  }
  if (m.hypoxicKm2 >= 500) add(m.hypoxicKm2 >= 5000 ? 'high' : 'medium', `Low-oxygen lake bed covers ${m.hypoxicKm2.toLocaleString()} km²`, 'Bottom-dwelling fish and invertebrates lose habitat and crowd into shallower water.');
  if (habitatLoss >= 0.05) add(habitatLoss >= 0.25 ? 'high' : 'medium', `Fish habitat is down ${Math.round(habitatLoss * 100)}%`, `If commercial catch fell in step, up to ${usd(fish.commercialCad)} CAD a year would be at risk. Treat that as an upper bound.`);
  if (m.bloomKm2 >= 1000) add('low', `Bloom covers ${m.bloomKm2.toLocaleString()} km²`, 'Shading and later decay put more pressure on oxygen and on the food web.');
  if (m.oilKm2 > 0) add('high', `Oil slick covers ${m.oilKm2.toLocaleString()} km²`, `Fishing closures would put about ${usd(fish.oilUsd)} of angler spending at risk.`);
  if (triggers(m, fish).find((t) => t.id === 'fishery_disaster')?.on) add('high', 'Fishing losses reach federal disaster review territory', 'Trip losses are at 35% or more of fishing revenue.');

  issues.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const worst = issues[0]?.severity;
  return {
    status: worst === 'high' ? 'Act now' : worst === 'medium' ? 'Watch closely' : 'Stable',
    tone: worst || 'ok',
    sport: fish.sport, commercial: fish.commercialCad, habitat: m.habitatIndex, toxin: m.intakeToxin,
    issues: issues.slice(0, 5),
  };
}

const arrow = (now, before, badWhenUp) => {
  if (before == null || Math.abs(now - before) < 1e-3 * Math.max(Math.abs(before), 1e-6)) return '';
  const up = now > before;
  return `<span class="${up === badWhenUp ? 'twin-worse' : 'twin-better'}">${up ? '▲' : '▼'}</span>`;
};

let last = null;
export function renderAnalysis(el, a) {
  el.innerHTML = `
    <div class="twin-status twin-tone-${a.tone}">${a.status}</div>
    <div class="twin-tiles">
      <div><span>Sport fishing at risk</span><b>${usd(a.sport)} ${arrow(a.sport, last?.sport, true)}</b></div>
      <div><span>Commercial, upper bound</span><b>${usd(a.commercial)} CAD ${arrow(a.commercial, last?.commercial, true)}</b></div>
      <div><span>Fish habitat</span><b>${Math.round(a.habitat * 100)}% ${arrow(a.habitat, last?.habitat, false)}</b></div>
      <div><span>Toxin at intake</span><b>${a.toxin} µg/L ${arrow(a.toxin, last?.toxin, true)}</b></div>
    </div>
    <ul class="twin-issues">${a.issues.map((i) => `<li class="twin-tone-${i.severity}"><b>${i.title}</b><br>${i.detail}</li>`).join('') || '<li class="twin-tone-ok"><b>No major issues yet</b><br>The lake is still within its starting range.</li>'}</ul>`;
  last = a;
}
