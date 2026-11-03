# Aquatic Twin

A live 3D model of Lake Erie, built as a new feature for [Aquatic Sustainability](https://github.com/gt-big-data/aquatic-sustainability) at the BDBI x SpaceXSI Grokathon. It solves transport equations for temperature, phosphorus, algae, oxygen and toxin in the browser. An AI operator tests cleanup plans on the solver to keep Toledo's tap water safe, and the result is presented as an earnings call for the lake.

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

Open http://localhost:5001/water. No API key is needed: without one, a labelled simulated operator runs real solver trials on a fixed list of plans. To use a live model, copy `aquatic-twin/.env.example` to `aquatic-twin/.env` and set `LLM_PROVIDER` to `gemini`, `anthropic` or `xai` with its key.

**Test it:** `node --test aquatic-twin/web/solver.test.js`

## What's measured and what's assumed

- **Measured or live:** lakebed (NOAA NCEI Lake Erie grid, averaged to about 3 km), Maumee River flow (USGS gauge 04193500), wind and air temperature (Open-Meteo).
- **Assumed:** most solver coefficients, action doses and costs are unfitted screening values, listed below. Splitting the 2014 cost across towns and scaling it with bloom-days are our own assumptions.
- **What this is:** a screening model. It ranks options and is not calibrated to forecast exact values.

## How we built it

Built with Cursor and Claude Code. Shanjay and Shija worked in Cursor. Kushagra used Claude Code (Opus, Sonnet and Haiku), including for the starter scaffold. The organizers allowed any LLM API in place of the Grok API, so the operator runs on a swappable provider.

## If we had Grok API access

We didn't have Grok API or Grok Bot access tonight. The `xai` provider in `aquatic-twin/twin_routes.py` is written from xAI's docs but has never been run. With access, we would have:

- **Run the operator on `grok-4.7`** with function calling, so Grok designs and compares experiments on the solver.
- **Added live field reports** with `x_search` and `web_search`, so posts and news about a bloom set the starting scenario, with citations.
- **Built a Lake Watch Bot on Grok Bot.** A scheduled routine would run `aquatic-twin/web/headless.js --live` on the Bot's cloud computer and message a person for approval only when forecast toxin at the Toledo intake crosses 1 µg/L.
- **Let anyone report a bloom on X.** Tagging `@bot` under a bloom photo would hand the post to the same routine.

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

The $65M covers western Lake Erie in both the US and Canada, and the report describes its tourism figure as indicative. The model's bounds also include Lake St. Clair, which is real water but receives no modelled inflow.
