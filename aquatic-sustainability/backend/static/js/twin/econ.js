// The lake's earnings call: turns two sim.metrics() results into line items. Owner: Shija.
// Anchors are published figures for the 2014 Toledo event. Do not add them to each other.
// ASSUMPTION, shown on screen: damage scales linearly with bloom-days at each town.
export const ANCHORS = {
  event2014Usd: 65e6,      // lost tourism, recreation and housing value (IJC study, via Grist and Circle of Blue)
  event2014TreatmentUsd: 4e6,
  referenceBloomDays: 60,  // TODO(Shija): calibrate. Bloom-days across all towns that equal one 2014-size event.
  referenceToxin: 2.5,     // TODO(Shija): source this. Intake toxin level treated as a 2014-size treatment event.
};
const TOWN_SHARE = { toledo_intake: 0.4, port_clinton: 0.25, sandusky: 0.25, cleveland: 0.1 };  // TODO(Shija): source or simplify

function exposure(m) {
  const towns = Object.entries(m.siteBloomDays).map(([id, days]) => ({
    id, usd: ANCHORS.event2014Usd * (TOWN_SHARE[id] ?? 0.1) * Math.min(days / (ANCHORS.referenceBloomDays / 4), 2),
  }));
  const treatment = ANCHORS.event2014TreatmentUsd * Math.min(m.peakIntakeToxin / ANCHORS.referenceToxin, 3);
  return { towns, treatment, total: towns.reduce((t, x) => t + x.usd, 0) + treatment };
}

export function earningsCall(baseline, plan) {
  const a = exposure(baseline), b = exposure(plan);
  const saved = a.total - b.total, spend = plan.planCostUsd;
  return { before: a, after: b, saved, spend, returnPerDollar: spend > 0 ? saved / spend : null };
}

const usd = (x) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}K`);

export function renderEarnings(el, call, plan) {
  const rows = call.before.towns.map((t, n) => `<tr><td>${t.id.replace(/_/g, ' ')}</td><td>${usd(t.usd)}</td><td>${usd(call.after.towns[n].usd)}</td></tr>`).join('');
  const materials = plan.materials.map((m) => `<li>${m.amount} ${m.unit} (${m.type}): ${usd(m.costUsd)}</li>`).join('') || '<li>No plan applied</li>';
  el.innerHTML = `
    <table class="twin-table"><tr><th>Revenue at risk</th><th>Do nothing</th><th>This plan</th></tr>${rows}
      <tr><td>Water treatment</td><td>${usd(call.before.treatment)}</td><td>${usd(call.after.treatment)}</td></tr>
      <tr><td><b>Total</b></td><td><b>${usd(call.before.total)}</b></td><td><b>${usd(call.after.total)}</b></td></tr></table>
    <p><b>Capital spend:</b> ${usd(call.spend)}. <b>Guidance:</b> ${call.returnPerDollar === null ? 'no plan yet' : `$${call.returnPerDollar.toFixed(2)} saved per $1 spent`}.</p>
    <ul>${materials}</ul>
    <p class="twin-note">Costs and doses are placeholders. Damage scaling is our assumption, anchored to the 2014 event ($65M, plus $4M treatment).</p>`;
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
