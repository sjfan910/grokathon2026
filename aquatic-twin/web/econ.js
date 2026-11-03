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
const NEAR_LIMIT_FRACTION = 0.95;  // Within 5% of the guideline reads as "right at" it, not safely under.

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

// The solver's toxin is raw lake water at the intake, before treatment, so this never claims the tap is safe or unsafe.
function toxinVerdict(peak) {
  if (peak >= ANCHORS.referenceToxin) return 'over';
  return peak >= ANCHORS.referenceToxin * NEAR_LIMIT_FRACTION ? 'right at' : 'under';
}

function toxinLine(call) {
  const limit = `the WHO drinking-water guideline of ${ANCHORS.referenceToxin} µg/L`;
  const intro = "<b>Water at Toledo's intake, before treatment:</b> toxin peaks at";
  if (call.spend <= 0) return `${intro} ${call.before.peakToxin.toFixed(2)} µg/L, ${toxinVerdict(call.before.peakToxin)} ${limit}.`;
  const peak = call.after.peakToxin;
  return `${intro} ${peak.toFixed(2)} µg/L with this plan, ${toxinVerdict(peak)} ${limit}. Doing nothing peaks at ${call.before.peakToxin.toFixed(2)} µg/L.`;
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

// ---- Fish market and government triggers. Kept OUT of the totals above: the 2014 $65M already
// counts some recreation, so adding these to it would double count. Shown as its own section.
export const FISHING = {
  ohioBoatTrips: 251700,   // 2024 Ohio Lake Erie walleye + yellow perch boat trips (ODNR creel, via notes)
  usdPerTrip: 88,          // angler spending per trip, 2014 survey (Wu, Sohngen & Ludsin 2023)
  elasticity: 1.23,        // % fewer angling boats per % more near-harbor cyanobacteria, western basin weekend (Wu et al. 2023)
  maxTripLoss: 0.30,       // cap; observed bad-year losses were ~25% (Wu et al.) and 12-29% (MUCC)
  ceilingUsd: 69.1e6,      // annual welfare loss if the whole western basin closed (Wolf, Chen et al. 2019)
  commercialUsd: 200e6,    // Ontario Lake Erie commercial fishery, ">$200M CAD/yr" (industry figure, Jul 2026). Shown in CAD.
  westernBasinKm2: 3300,   // ASSUMPTION for oil closures: approximate western basin area
};
// ASSUMPTION, shown on screen: harbor shares of Ohio trips.
const HARBOR_SHARE = { toledo_intake: 0.25, port_clinton: 0.45, sandusky: 0.30 };

export function fishMarket(m) {
  const days = Math.max(m.simDays, 1);
  const towns = Object.entries(HARBOR_SHARE).map(([id, share]) => {
    const bloomFrac = Math.min(1, (m.siteBloomDays[id] ?? 0) / days);  // ASSUMPTION: bloom-day share stands in for % change in cyanobacteria
    const tripLoss = Math.min(FISHING.maxTripLoss, FISHING.elasticity * bloomFrac);
    return { id, tripLoss, usd: FISHING.ohioBoatTrips * share * FISHING.usdPerTrip * tripLoss };
  });
  const oilClosure = Math.min(1, (m.oiledHabitatKm2 ?? 0) / FISHING.westernBasinKm2);  // ASSUMPTION: oiled area closes fishing pro rata
  const oilUsd = FISHING.ohioBoatTrips * FISHING.usdPerTrip * oilClosure;
  const sport = Math.min(FISHING.ceilingUsd, towns.reduce((t, x) => t + x.usd, 0) + oilUsd);
  // ASSUMPTION (beta = 1): commercial revenue falls in proportion to lost habitat. Arend et al. find perch habitat
  // drops only ~8.5% in a hypoxic year, so treat this as an upper bound, not a forecast.
  const commercialCad = FISHING.commercialUsd * Math.max(0, 1 - (m.habitatIndex ?? 1));
  const tripLossShare = towns.reduce((t, x) => t + x.tripLoss * HARBOR_SHARE[x.id], 0) + oilClosure;
  return { towns, oilUsd, sport, commercialCad, tripLossShare };
}

// Thresholds from law or published rules. The model's toxin is raw water at the intake, not finished
// tap water, so these read as "treatment must work hard", not as a do-not-drink order.
export function triggers(m, fish = fishMarket(m)) {
  const tox = m.peakIntakeToxin;
  return [
    { id: 'drink_sensitive', label: 'Microcystin above 0.3 µg/L (children, sensitive groups)', on: tox > 0.3, source: 'Ohio OAC 3745-90-02' },
    { id: 'drink_all', label: 'Microcystin above 1.6 µg/L (everyone)', on: tox > 1.6, source: 'Ohio OAC 3745-90-02' },
    { id: 'fishery_disaster', label: 'Fishing revenue loss of 35% or more (federal disaster review)', on: fish.tripLossShare >= 0.35, source: 'NOAA, Magnuson-Stevens Sec. 312(a)' },
    { id: 'oil_response', label: 'Oil harming fish habitat', on: (m.oiledHabitatKm2 ?? 0) > 0, source: 'Screening proxy (zebrafish PAH data)' },
  ];
}

export function renderFishMarket(el, baseline, plan) {
  const a = fishMarket(baseline), b = fishMarket(plan);
  const rows = a.towns.map((t, n) => `<tr><td>${t.id.replace(/_/g, ' ')}</td><td>${usd(t.usd)} (${Math.round(t.tripLoss * 100)}% trips)</td><td>${usd(b.towns[n].usd)} (${Math.round(b.towns[n].tripLoss * 100)}% trips)</td></tr>`).join('');
  const trig = triggers(plan, b).map((t) => `<li>${t.on ? '🔴' : '🟢'} ${t.label} <span class="twin-note">(${t.source})</span></li>`).join('');
  el.innerHTML = `
    <table class="twin-table"><tr><th>Fish market</th><th>Do nothing</th><th>This plan</th></tr>${rows}
      <tr><td>Oil closures</td><td>${usd(a.oilUsd)}</td><td>${usd(b.oilUsd)}</td></tr>
      <tr><td><b>Sport fishing at risk</b></td><td><b>${usd(a.sport)}</b></td><td><b>${usd(b.sport)}</b></td></tr>
      <tr><td>Commercial, upper bound (CAD)</td><td>${usd(a.commercialCad)}</td><td>${usd(b.commercialCad)}</td></tr></table>
    <p><b>Should government act?</b></p><ul>${trig}</ul>
    <p class="twin-note">Sport fishing: $88 per trip and a 1.23 trip elasticity (Wu, Sohngen &amp; Ludsin 2023), capped at $69.1M (Wolf et al. 2019). Harbor shares, oil closures and the commercial line are our assumptions. Not added to the totals above, to avoid double counting.</p>`;
}
