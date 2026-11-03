# Aquatic Twin

A 3D model of Lake Erie added to [Aquatic Sustainability](https://github.com/gt-big-data/aquatic-sustainability) for the BDBI x SpaceXSI Grokathon. It solves transport equations for temperature, phosphorus, algae, oxygen and toxin in the browser. Grok tests cleanup plans on the solver, and the result is presented as an earnings call for the lake.

**Run it:** see the setup in [PLAN.md](PLAN.md), then open http://localhost:5001/water.

**Test it:** `node --test aquatic-sustainability/backend/static/js/twin/solver.test.js`

## Where the code is

Everything new is in `aquatic-sustainability/backend`: `static/js/twin/` (solver, view, Grok loop, economics, headless runner), `static/pages/water.html`, `app/twin_routes.py` and `scripts/build_scene.py`.

## What's measured and what's assumed

- **Measured or live:** Maumee River flow (USGS gauge 04193500), wind and air temperature (Open-Meteo).
- **Assumed:** solver coefficients, action doses and costs are screening values until sourced below. Damage scaling is our own assumption, anchored to the 2014 Toledo event.
- **What this is:** a screening model. It ranks options and is not calibrated to forecast exact values.

## How we built it

Built with Claude Code (Opus, Sonnet and Haiku), including the starter scaffold. TODO: describe truthfully how the team used the Grok API and Grok Bot, with screenshots.

## Coefficient sources

TODO (Shija).
