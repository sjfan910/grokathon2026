# Aquatic Twin

Hackathon build. Devpost closes at 9:00pm, and build stops at 8:40. PLAN.md has owners, models and the clock. All our code is in `aquatic-twin/`. `aquatic-sustainability/` is an untouched copy of the BDBI project: never edit it.

## Rules

- This repo has about 5,900 files, mostly a classifier dataset. Never explore it. Only open files the prompt names, or files in `aquatic-twin/`.
- Only edit files your person owns (see PLAN.md). Ask before touching anyone else's.
- `solver.js` must stay free of DOM and three.js, because it also runs in Node and on Grok Bot.
- After changing `solver.js`, run `node --test aquatic-twin/web/solver.test.js`.
- No Navier-Stokes, bundler, framework or new Python packages for the app. Small diffs only.
- API keys stay in `aquatic-twin/.env` and `twin_routes.py`, never in browser code.
- Never present an invented coefficient or cost as real. Cite a source or label it a placeholder.

## Contract (tell the team before changing it)

- Field index: `i + nx*(j + ny*k)`. `k=0` is the surface. Every column has `nz` layers of `depth/nz`.
- `createSim(scene, opts?)` returns a sim with `fields {T,P,A,O,X,H}`, `step(n)`, `setScenario({windSpeed,windDir,inflowCfs,airTempC})`, `addAction({type,site|i,j,radius,amount})`, `metrics()`, `clone()`, `reset()`. `clone()` resets peak and bloom-day tracking, so what-ifs measure from now.
- `metrics()` returns `simDays, hypoxicKm2, bloomKm2, intakeToxin, peakIntakeToxin, habitatIndex, siteBloomDays, materials, planCostUsd`.
