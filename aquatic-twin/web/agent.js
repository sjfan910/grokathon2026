// AI operator: the browser runs each tool call on the real solver, so the view moves as it works.
// Tool schemas, the system prompt and the providers live in aquatic-twin/twin_routes.py.

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

export function makeExecutor({ getSim, view, onPlanApplied }) {
  return async function exec(name, args) {
    const sim = getSim();
    if (name === 'get_lake_info') {
      return { metrics: sim.metrics(), scenario: sim.scenario, sites: sim.sites.map((s) => s.id), source: 'maumee', lakebed: sim.scene.lakebed };
    }
    if (name === 'set_scenario') { sim.setScenario(args); return { scenario: sim.scenario }; }
    if (name === 'test_plan') {
      const days = Math.min(args.days || 30, 60), trial = sim.clone();
      for (const a of args.actions || []) trial.addAction(a);
      if (args.actions?.[0]?.site) {
        const s = sim.sites.find((x) => x.id === args.actions[0].site);
        if (s) view.focus({ i: s.i, j: s.j });
      }
      await nextFrame();
      for (let d = 0; d < days; d++) { trial.step(24); if (d % 5 === 0) { view.update(trial); await nextFrame(); } }
      return trial.metrics();
    }
    if (name === 'apply_plan') {
      for (const a of args.actions || []) sim.addAction(a);
      onPlanApplied?.(args.actions || []);
      return { applied: (args.actions || []).length, metrics: sim.metrics() };
    }
    if (name === 'focus_view') {
      const s = args.site ? sim.sites.find((x) => x.id === args.site) : null;
      view.focus({ field: args.field, explode: args.explode, i: s?.i, j: s?.j });
      return { ok: true };
    }
    throw new Error(`Unknown tool ${name}`);
  };
}

export async function runOperator(goal, exec, log) {
  const run = [];
  let body = { goal };
  for (let turn = 0; turn < 16; turn++) {
    const res = await fetch('/api/twin/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Operator request failed (${res.status})`);
    if (data.text) { log('grok', data.text); run.push({ say: data.text }); }
    const results = [];
    for (const call of data.calls || []) {
      log('call', `${call.name}(${JSON.stringify(call.args)})`);
      let result;
      try { result = await exec(call.name, call.args); } catch (e) { result = { error: e.message }; }
      log('result', JSON.stringify(result));
      run.push({ name: call.name, args: call.args });
      results.push({ id: call.id, name: call.name, output: JSON.stringify(result) });
    }
    if (!results.length) break;
    body = { state: data.state, results };
  }
  try { localStorage.setItem('twinLastRun', JSON.stringify(run)); } catch { /* replay is optional */ }
  return run;
}

// Offline fallback for bad Wi-Fi. Runs a saved run's tool calls on the solver, labelled as a replay.
export async function replay(run, exec, log) {
  log('call', 'Replaying a saved operator run');
  for (const step of run) {
    if (step.say) { log('grok', step.say); continue; }
    log('call', `${step.name}(${JSON.stringify(step.args)})`);
    log('result', JSON.stringify(await exec(step.name, step.args)));
  }
}
