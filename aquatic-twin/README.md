# aquatic-twin

Everything we built for the Grokathon. `../aquatic-sustainability/` is an unmodified copy of the BDBI project, and `run.py` mounts this feature onto it at `/water` without editing it.

| Path | What it does |
| --- | --- |
| `run.py` | Starts the site with the twin mounted |
| `twin_routes.py` | Live river and wind data, and the AI operator (mock, Gemini, Claude or Grok) |
| `web/solver.js` | The 3D solver. No browser dependencies |
| `web/solver.test.js` | Solver tests |
| `web/headless.js` | Runs the solver from Node |
| `web/view.js`, `web/app.js`, `web/water.html` | The 3D page |
| `web/agent.js` | The operator's tool loop |
| `web/econ.js` | The lake's earnings call |
| `scripts/build_scene.py` | Builds `web/erie.scene.json` from NOAA's grid |
