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
