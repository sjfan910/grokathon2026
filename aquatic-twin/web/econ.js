// The lake's earnings call: turns two sim.metrics() results into line items. Owner: Shija.
// Source for all dollar anchors: Bingham, Sinha & Lupi (2015), Economic Benefits of Reducing Harmful
// Algal Blooms in Lake Erie, report to the International Joint Commission, p.3. Its 2014 total of $65M is
// $18M property + $20M tourism + $23M recreation + $4M water treatment, so treatment is already inside it.
// ASSUMPTION, shown on screen: damage scales linearly with bloom-days at each town, and the report's
// basin-wide total is split across our three towns by their 2014 bloom severity.
export const ANCHORS = {
  event2014Usd: 65e6,
  event2014TreatmentUsd: 4e6,
  referenceToxin: 1,  // ug/L. WHO guideline for microcystin-LR, the level behind Toledo's 2014 do-not-drink advisory.
};
const DAYS_PER_WEEK = 7;
const MAX_EVENTS = 2;  // Caps damage at twice a 2014-size event. Our assumption.
const MAX_TREATMENT_EVENTS = 3;  // Same cap for treatment. Our assumption.

// Sum of weekly severity ratings, July to October 2014, from the same report's Tables 3-6 to 3-9.
// Toledo = Lucas County, Port Clinton = Ottawa mainland, Sandusky = Erie mainland.
const SEVERITY_WEEKS_2014 = { toledo_intake: 10.25, port_clinton: 4.75, sandusky: 2.75 };
const TOWN_NAMES = { toledo_intake: 'Toledo', port_clinton: 'Port Clinton', sandusky: 'Sandusky' };
const TOTAL_SEVERITY_WEEKS = Object.values(SEVERITY_WEEKS_2014).reduce((sum, weeks) => sum + weeks, 0);

function townDamage(id, days) {
  const weeks = SEVERITY_WEEKS_2014[id];
  const localLossesUsd = ANCHORS.event2014Usd - ANCHORS.event2014TreatmentUsd;
  return localLossesUsd * (weeks / TOTAL_SEVERITY_WEEKS) * Math.min(days / (weeks * DAYS_PER_WEEK), MAX_EVENTS);
}

function exposure(m) {
  // Cleveland is a solver site but sits outside the report's western-basin study area, so it carries no dollars.
  const towns = Object.entries(m.siteBloomDays)
    .filter(([id]) => id in SEVERITY_WEEKS_2014)
    .map(([id, days]) => ({ id, days, usd: townDamage(id, days) }));
  const treatment = ANCHORS.event2014TreatmentUsd * Math.min(m.peakIntakeToxin / ANCHORS.referenceToxin, MAX_TREATMENT_EVENTS);
  return { towns, treatment, peakToxin: m.peakIntakeToxin, total: towns.reduce((t, x) => t + x.usd, 0) + treatment };
}

export function earningsCall(baseline, plan) {
  const a = exposure(baseline), b = exposure(plan);
  const saved = a.total - b.total, spend = plan.planCostUsd;
  return { before: a, after: b, saved, spend, returnPerDollar: spend > 0 ? saved / spend : null };
}

const usd = (x) => {
  if (Math.abs(x) >= 1e6) return `${x < 0 ? '-' : ''}$${(Math.abs(x) / 1e6).toFixed(1)}M`;
  return Math.abs(x) < 500 ? '$0' : `${x < 0 ? '-' : ''}$${Math.round(Math.abs(x) / 1e3)}K`;
};

function headline(call) {
  if (call.spend <= 0) return `If nothing changes, this bloom puts about <b>${usd(call.before.total)}</b> at risk over this run. No plan is applied yet.`;
  const verdict = call.saved >= 0
    ? `protects about <b>${usd(call.saved)}</b>, or <b>$${call.returnPerDollar.toFixed(2)} back for every $1 spent</b>`
    : `makes things worse by about <b>${usd(-call.saved)}</b>, so the money is lost and the damage grows`;
  return `Doing nothing puts about <b>${usd(call.before.total)}</b> at risk over this run. This plan costs <b>${usd(call.spend)}</b> and ${verdict}.`;
}

function toxinLine(call) {
  if (call.spend <= 0) return `<b>Toledo's tap water:</b> toxin at the intake peaks at ${call.before.peakToxin.toFixed(2)} µg/L. The drinking-water limit is ${ANCHORS.referenceToxin} µg/L.`;
  const peak = call.after.peakToxin;
  const verdict = peak >= ANCHORS.referenceToxin ? 'over the limit, so the tap water is not safe to drink' : 'under the limit';
  return `<b>Toledo's tap water:</b> toxin at the intake peaks at ${peak.toFixed(2)} µg/L with this plan, ${verdict} of ${ANCHORS.referenceToxin} µg/L. Doing nothing peaks at ${call.before.peakToxin.toFixed(2)} µg/L.`;
}

export function renderEarnings(el, call, plan) {
  const rows = call.before.towns.map((t, n) => `<tr><td>${TOWN_NAMES[t.id]}</td><td>${usd(t.usd)}</td><td>${usd(call.after.towns[n].usd)}</td></tr>`).join('');
  const materials = plan.materials.map((m) => `<li>${m.amount} ${m.unit} (${m.type}): ${usd(m.costUsd)}</li>`).join('') || '<li>No plan applied</li>';
  el.innerHTML = `
    <p>${headline(call)}</p>
    <p>${toxinLine(call)}</p>
    <table class="twin-table"><tr><th>Revenue at risk (tourism, recreation, homes)</th><th>Do nothing</th><th>This plan</th></tr>${rows}
      <tr><td>Operating cost: water treatment</td><td>${usd(call.before.treatment)}</td><td>${usd(call.after.treatment)}</td></tr>
      <tr><td><b>Total at risk</b></td><td><b>${usd(call.before.total)}</b></td><td><b>${usd(call.after.total)}</b></td></tr></table>
    <p><b>Capital spend, what the plan buys:</b> ${usd(call.spend)}. <b>Guidance:</b> ${call.returnPerDollar === null ? 'no plan yet' : `$${call.returnPerDollar.toFixed(2)} saved per $1 spent`}.</p>
    <ul>${materials}</ul>
    <p class="twin-note">Plan costs and doses are placeholders. A published study puts the 2014 bloom at $65M across western Lake Erie, including $4M for water treatment (Bingham et al., 2015, for the International Joint Commission). Splitting that across these towns by 2014 bloom severity, and scaling it with simulated bloom-days, are our assumptions. Use this to rank plans, not as a forecast.</p>`;
}
