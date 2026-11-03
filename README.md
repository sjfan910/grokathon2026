# Aquatic Twin

**A live 3D digital twin of Lake Erie. Pollute it anywhere, change the wind, and watch the water, the fish and the local economy respond.**

Built for the BDBI x SpaceXSI Grokathon as a new feature for [Aquatic Sustainability](https://github.com/gt-big-data/aquatic-sustainability), which had no working water quality tool. In 2014, about half a million people around Toledo were told not to drink their tap water because of a bloom in this lake. Aquatic Twin shows how a crisis like that unfolds, what it costs, and which response works.

## What it does

- **3D lake on NOAA's real lakebed.** Temperature, phosphorus, algae, oxygen, toxin and oil are solved live in the browser across 12 depth layers, which you can lift apart.
- **Live currents.** A fluid mechanics PDE turns wind and depth into currents. Live data can load the current Maumee River flow, wind and air temperature.
- **Spill it yourself.** Click anywhere on the lake to spill oil, then drag the wind compass. The currents reroute and the slick moves.
- **AI operator.** Gemini tests cleanup plans on copies of the solver, compares the results and applies the best one. Every number it quotes comes from a solver run.
- **Live economic and ecosystem analysis.** Fishing trips, fish habitat, drinking water thresholds and commercial risk update beside the simulation.
- **The lake's earnings call.** In the plain-language style of SimpliEarn, it shows what a bloom puts at risk and what a plan returns.

## How the physics works

Each substance follows the advection-diffusion-reaction equation, `∂C/∂t + u·∇C = ∇·(K∇C) + S − λC + R(C)`. Currents come from a wind-driven streamfunction solved on the real depth grid, `∇·(h⁻²∇ψ) = (1/r) ∇×(τ/ρh)`, which conserves water volume. The solver runs on a 128 × 48 × 12 grid with 1-hour steps. It takes about 1.5 seconds for 30 simulated days, which is what lets the AI test several plans in one reply. Six automated tests cover diffusion against the analytic answer, mass conservation, wind direction, bloom growth and oil.

## Repo layout

| Folder | What it is |
| --- | --- |
| `aquatic-twin/` | **Everything we built.** Solver, 3D view, AI operator, economics, data script and server. |
| `aquatic-sustainability/` | An unmodified copy of the BDBI project. `aquatic-twin/run.py` mounts our feature onto it at `/water` without editing it. |

## Run it

```bash
pip install -r aquatic-twin/requirements.txt
```
```bash
python aquatic-twin/run.py
```

Open http://localhost:5001/water. It runs without a key, using a labelled simulated operator. For the live AI, copy `aquatic-twin/.env.example` to `aquatic-twin/.env`, then set `LLM_PROVIDER=gemini`, `ANALYST_PROVIDER=gemini` and your `GEMINI_API_KEY`.

**Test it:** `node --test aquatic-twin/web/solver.test.js`

## What's measured and what's assumed

- **Measured or live:** the lakebed (NOAA NCEI grid, averaged to about 3 km), Maumee River flow (USGS gauge 04193500), wind and air temperature (Open-Meteo).
- **Assumed:** most solver coefficients, action doses and costs are unfitted screening values, listed below. Splitting costs across towns and scaling them with bloom-days are our own assumptions.
- **Tuned for the demo:** the toxin rates `yX` and `lysisX` and the default scenario are set so a day-15 bloom crosses the 1 µg/L limit. They aren't fitted to data.
- **What this is:** a screening model. It ranks options and doesn't forecast exact values.

## How we built it

Built with Cursor and Claude Code. Shanjay worked in Cursor. Kushagra and Shija used Claude Code (Opus, Sonnet and Haiku), including for the starter scaffold. The organizers allowed any LLM API in place of the Grok API, so the operator uses Gemini through a swappable provider layer.

## The Grok version: what we'd build with access

Grok API and Grok Bot access weren't available tonight, so none of this is running. A Grok provider is written in `aquatic-twin/twin_routes.py` from xAI's docs, but it has never been run. Our plan uses capabilities specific to the Grok stack:

- **Three-agent lake team.** `grok-4.20-multi-agent` runs a hydrologist, an ecologist and an economist that argue over one plan, each calling the solver as a tool.
- **X as a field sensor.** `x_search` watches posts from anglers, charter captains and beach-goers. Reports of green water or fish kills become timestamped evidence, compared against the model's plume, with citations.
- **Self-calibration.** Grok's code execution tool fits solver coefficients against Water Quality Portal data, then reruns the tests before accepting a change.
- **Regulation-aware plans.** Collections Search over Ohio drinking water rules, the US-Canada phosphorus targets and fishery disaster criteria, so every plan says which rule it triggers.
- **The solver as a remote tool.** A Remote MCP server exposes `test_plan`, so any Grok agent can run lake experiments.
- **Lake Watch on Grok Bot.** A persistent Bot runs `headless.js --live` on its cloud computer every two hours and stops for human approval when forecast toxin crosses 1 µg/L. A webhook could wake it the moment the river gauge spikes.
- **Report a bloom on X.** Tag `@bot` under a photo of green water. The Bot receives the post and photos, runs the forecast and sends the result to a person, with a voice memo for operators in the field.

## Coefficient sources

| Value | Used as | Status | Source |
| --- | --- | --- | --- |
| Lakebed depth | `aquatic-twin/web/erie.scene.json`, max 61.5 m after averaging | Sourced | [NOAA NCEI Lake Erie bathymetry](https://www.ngdc.noaa.gov/mgg/greatlakes/erie.html) |
| 2014 bloom cost | $65M: $18M property, $20M tourism, $23M recreation, $4M water treatment | Sourced | [Bingham, Sinha & Lupi (2015), for the International Joint Commission](https://www.ectinc.com/wp-content/uploads/2019/05/Economic-Benefits-Due-to-Reduction-in-HABs-an-ECT-Report.pdf), p.3 |
| 2014 bloom severity | Toledo 10.25, Port Clinton 4.75 and Sandusky 2.75 severity-weeks | Sourced, then summed by us | Same report, Tables 3-6 to 3-9 (Lucas, Ottawa mainland and Erie mainland) |
| Toxin limit | Microcystin 1 µg/L | Sourced | [WHO guideline, as reported by the Toledo Blade](https://www.toledoblade.com/local/2014/08/04/Mayor-Collins-Our-water-is-safe.print) |
| Hypoxic threshold | Oxygen below 2 mg/L | Sourced | [NOAA GLERL](https://www.glerl.noaa.gov/res/HABs_and_Hypoxia/hypoxiaWarningSystem.html) |
| Upstream cut limit | Up to 40% of inflow phosphorus | Sourced | [US EPA, 2016 binational targets](https://www.epa.gov/archive/epa/newsreleases/governments-canada-and-united-states-announce-phosphorus-reduction-targets-40-percent.html) |
| Town split and bloom-day scaling | Damage in `econ.js`, capped at 2 events (treatment at 3) | **Our assumption** | Built from the sourced figures above, not published |
| Algae, light and nutrient rates | `muMax`, `death`, `Topt`, `Tw`, `Kp`, `ke0`, `keA`, `KI`, `riseMperDay`, `Yp`, `recycle` | **Placeholder** | None yet |
| Oxygen and sediment | `Yo`, `respFrac`, `SOD`, `relP` | **Placeholder** | None yet |
| Toxin rates | `yX`, `lamX`, `lysisX` | **Placeholder** | None yet |
| Maumee phosphorus concentration | `inflowP` 300 µg/L | **Placeholder** | None yet |
| Bloom threshold | `bloomChl` 20 µg/L | **Placeholder** | None yet |
| Mixing and flow | `Kh`, `r`, `driftFrac`, `Cd`, `KzMin`, `heatExchange` | **Placeholder** | None yet |
| Action costs and doses | `ACTIONS` in `solver.js` | **Placeholder** | None yet |
| Ohio toxin thresholds | Microcystin 0.3 µg/L (children, sensitive groups) and 1.6 µg/L (everyone) | **Cited, not verified** | Ohio OAC 3745-90-02 |
| Fishery disaster trigger | Fishing revenue loss of 35% or more | **Cited, not verified** | NOAA, Magnuson-Stevens Act Sec. 312(a) |
| Ohio boat trips | 251,700 walleye and yellow perch trips, 2024 | **Cited, not verified** | ODNR creel data, from team notes |
| Angler spending and response | $88 per trip, 1.23 trip elasticity, losses capped at 30% | **Cited, not verified** | Wu, Sohngen & Ludsin (2023); the cap also draws on MUCC figures |
| Sport fishing ceiling | $69.1M per year | **Cited, not verified** | Wolf, Chen et al. (2019) |
| Ontario commercial fishery | More than $200M CAD per year | **Cited, not verified** | Industry figure, July 2026 |
| Harbor shares, oil closures, western basin area, commercial loss line | Fish market section of `econ.js` | **Our assumption** | Not published |
| Oil harm to fish habitat | Government trigger | **Placeholder** | Screening proxy from zebrafish PAH data |

"Cited, not verified" means the figure comes from team notes and nobody has checked it against the original source yet. The $65M covers western Lake Erie in both the US and Canada, and the report describes its tourism figure as indicative. The model's bounds also include Lake St. Clair, which is real water but receives no modelled inflow.
