# Aquatic Twin: the plan

**Devpost closes at 9:00pm. Build stops at 8:40. Submit by 8:45.**

A 3D Lake Erie model on the Aquatic Sustainability site. It solves transport equations for temperature, phosphorus, algae, oxygen and toxin in the browser. Grok tests cleanup plans on the real solver to keep Toledo's tap water safe, and the result is shown as an earnings call for the lake.

The page already runs at `/water` with a working solver, so nobody starts from zero. Your job is to make your piece demo-ready.

## Who does what

| Person | Limit | Job | Only edit these |
| --- | --- | --- | --- |
| **Kushagra** | $100 | Solver tuning, AI operator | `twin/solver.js`, `twin/solver.test.js`, `twin/agent.js`, `twin/headless.js`, `aquatic-twin/twin_routes.py` |
| **Shanjay** | $20 | How it looks: the 3D view and page | `twin/view.js`, `twin/app.js`, `twin/water.html` |
| **Shija** | $20 | Real lakebed, economics, README, Devpost, pitch | `aquatic-twin/scripts/build_scene.py`, `twin/erie.scene.json`, `twin/econ.js`, `README.md` |

`twin/` means `aquatic-twin/web/`. `aquatic-sustainability/` is an untouched copy of the BDBI project, so never edit it. Swap Shanjay and Shija if that suits you better. Whoever is on SimpliEarn should take the economics, since the earnings call is their format.

## Which model to use

Pick the model in the Claude app's model picker, or run `claude --model <id>`.

| Person | Task | Model |
| --- | --- | --- |
| Kushagra | Solver physics, operator debugging | **Opus 5.5** (`claude-opus-5-5`) |
| Kushagra | Small edits, running tests, reading output | **Sonnet 5.5** (`claude-sonnet-5-5`) |
| Shanjay | `view.js`, shaders, page layout | **Sonnet 5.5** (`claude-sonnet-5-5`) |
| Shanjay | CSS tweaks, labels, one-line changes | **Haiku 5.5** (`claude-haiku-5-5`) |
| Shija | `build_scene.py`, `econ.js` | **Sonnet 5.5** (`claude-sonnet-5-5`) |
| Shija | README, Devpost text, demo script | **Haiku 5.5** (`claude-haiku-5-5`) |

**If you're on the $20 limit:** don't use Opus. If a bug has you stuck for 5 minutes, hand it to Kushagra rather than burning your limit on it.

**Stretching your limit (all three of you):**
- **Name the file.** The repo has 5,893 files, so never ask Claude to explore it. Say "edit `view.js`, function `focus`".
- **One task per session.** Run `/clear` between tasks.
- **No subagents or multi-agent runs.**
- **Don't paste whole logs.** Paste the error line.
- **Stop it if it wanders.** If it's reading unrelated files, interrupt it.

## Clock

| By | Kushagra | Shanjay | Shija |
| --- | --- | --- | --- |
| **8:10** | Confirm the operator runs. Keep the paid key unused until the demo. | Page running locally. | Page running locally. Ask organizers about the demo slot. |
| **8:20** | One full operator run works. | Default view readable on a projector. | Real NOAA lakebed committed. |
| **8:30** | Operator rejects algaecide from the numbers. | Separate-layers slider is the showpiece. | Earnings call reads well. Coefficient sources in README. |
| **8:40** | **Freeze.** Save `saved-run.json`. | **Freeze.** Record a backup video. | **Freeze.** README and Devpost text done. |
| **8:45** | | | **Submit to Devpost.** |
| After | Rehearse Bot moment. | Rehearse on the demo laptop. | Run the demo script twice. |

**Behind at 8:25? Cut in this order:** cutaway, habitat layer, town breakdown, Bot routine (keep one manual Bot run and a screenshot).

**Never cut:** the 3D sim, the operator tool loop.

## Setup (2 minutes)

```bash
git clone https://github.com/sjfan910/grokathon2026.git
```
```bash
cd grokathon2026
```
```bash
python3 -m venv .venv && source .venv/bin/activate
```
```bash
pip install -r aquatic-twin/requirements.txt
```
```bash
python aquatic-twin/run.py
```

Open http://localhost:5001/water. No key needed: it defaults to a labelled simulated operator. For a live model, copy `aquatic-twin/.env.example` to `aquatic-twin/.env`. Never commit that file.

**Git:** everyone works on `main`, in your own files only.

```bash
git pull --rebase && git add <your files> && git commit -m "..." && git push
```

Commit every 10 minutes. If you need a change in someone else's file, say it out loud.

## Prompts to paste

### Kushagra (Opus 5.5)

> Read CLAUDE.md. Do one at a time and stop after each. Files: `twin/agent.js`, `aquatic-twin/twin_routes.py`, `twin/solver.js`.
> 1. Click "Run experiments" on /water and fix whatever stops one complete run on `LLM_PROVIDER=mock`.
> 2. Make sure algaecide does worse than alum or upstream cuts on `peakIntakeToxin` in `test_plan`, so Grok rejects it from the numbers. Don't hard-code that outcome.
> 3. Make sure testing 3 to 5 plans doesn't freeze the page.
> 4. Save a good run to `twin/saved-run.json` for the Replay button.

**At 8:40:** set `LLM_PROVIDER=gemini` in `aquatic-twin/.env`, restart, and run once. Use it for the demo only. If it fails, go back to `mock` or use Replay.

### Shanjay (Sonnet 5.5)

> Read CLAUDE.md. Only edit `twin/view.js`, `twin/app.js`, `twin/water.html`. One item at a time, small diffs, stop after each so I can check http://localhost:5001/water.
> 1. Make the default view read well on a projector: camera angle, layer opacity, colors, labels.
> 2. Make "Separate layers" the showpiece: smooth spacing and a depth label beside each layer.
> 3. Add a marker at each active action in `sim.actions`.
> 4. When `focus_view` fires, make the camera move obvious and show the field name large for two seconds.
> 5. Only if it's before 8:30: add a north-south cutaway.

### Shija (Sonnet 5.5, then Haiku 5.5 for writing)

> Read CLAUDE.md. Only edit `aquatic-twin/scripts/build_scene.py`, `twin/erie.scene.json`, `twin/econ.js`, `README.md`. One item at a time.
> 1. Run `pip install numpy scipy`, then `python aquatic-twin/scripts/build_scene.py --real` (downloads NOAA's `erie_lld.grd.gz`, 22.6 MB). This reader has never run against the real file, so read the printed stats and fix it if variable names or the sign differ. Max depth should be near 64 m. Commit `erie.scene.json` only, never the grid. Tell Kushagra to re-run the tests.
> 2. Replace the TODOs in `econ.js`. Keep the published anchors separate and never add them together. Keep the assumption text on screen.
> 3. Make the earnings call read in plain language for a novice, like SimpliEarn.
> 4. Add a sourced coefficient table to README.md. Anything unsourced stays labelled as a placeholder.

**With Haiku:** write the Devpost text and fill in "How we built it" in the README, truthfully. Then time the demo script below.

## The demo (3 minutes)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | `/water`, lake at rest | "In 2014, about half a million people around Toledo were told not to drink their tap water because of a bloom in this lake." |
| 0:20 | Play. Load today's river and wind. Separate the layers. | "Real lakebed, live river gauge, live wind, and transport equations solved on a 3D grid in this tab." |
| 0:50 | Click Run experiments. It sets up a bloom-season scenario at day 15 by itself, so no manual timing. It tests plans while the camera follows. Algaecide spikes toxin and gets dropped. | "The operator runs the experiments itself. Every number it quotes comes from a solver run." |
| 1:40 | Habitat field. Earnings call panel. | "We treated the lake like a company. Here's what's at risk for Toledo, what this plan does for the tap water, and when government would have to act." |
| 2:15 | **Hand the judge the mouse.** They click the lake to spill oil, then drag the wind compass. | "Pollute it anywhere, then change the wind. The slick, the currents and the economics all come from the solver, live." |
| 2:30 | Switch to Molecular view and tap the slick. | "Oil never bonds to water. Water's hydrogen-bond network pushes it out, and that's why it floats and blocks oxygen." |
| 2:45 | Navbar link, repo. | "This is the water quality piece Aquatic Sustainability was missing. It's a screening model, and the README says what's measured and what's assumed." |

**"Is this accurate?"** "It's a screening model. Real geometry and live inputs, a solver that passes analytic tests, and placeholder coefficients we've labelled. It ranks options and doesn't forecast exact values."

## Judging criteria

1. **Creative use of tools:** organizers allowed any LLM API in place of Grok. The AI runs real experiments on the solver. The README says what we'd do with Grok API and Grok Bot access.
2. **Understanding of the social good use case:** Toledo 2014, drinking water, local economic cost.
3. **Working demo and technical execution:** a live 3D solver with tests.
4. **Usefulness and integration with the project:** a native page in Aquatic Sustainability that fills its missing water quality tool.

## Devpost checklist

- [ ] GitHub repo link: https://github.com/sjfan910/grokathon2026
- [ ] All three names, each registered on Devpost
- [ ] Sent by 8:45
- [ ] In-person demo booked before the closing ceremony

## How the solver works

`dC/dt + u·grad(C) = div(K grad(C)) + S - lambda*C + R(C)`, for T, P, A, O and X. H (habitat) is derived.

1. **Flow:** a wind-driven streamfunction on the depth grid, so downwind in the shallows and return flow over the deep parts. Plus a surface drift that reverses at depth.
2. **Horizontal:** explicit upwind and diffusion. It adds substeps automatically when flow is fast.
3. **Vertical:** implicit solve per column, because western layers are under a metre thick.
4. **Reactions:** algae, oxygen, toxin, and the interventions (alum, oxygen, wetland, upstream, algaecide).

**Scale:** 128 × 48 × 12 grid, 1-hour step, about 1.5 s for 30 simulated days in Node.

**Tests:**

```bash
node --test aquatic-twin/web/solver.test.js
```

## Known state

- **Coefficients and costs are screening placeholders.** Tuned so the demo shows a bloom and dead zone, not fitted to data.
- **Live LLM providers have never run against a real key.** The simulated operator is tested. Request formats come from provider docs.
