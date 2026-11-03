// Grok operator: the browser runs each tool call on the real solver, so the view moves as Grok works.
// Tool schemas and the system prompt live in backend/app/twin_routes.py.

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

export async function runGrok(goal, exec, log) {
  const run = [];
  let body = { input: [{ role: 'user', content: goal }] };
  for (let turn = 0; turn < 14; turn++) {
    const res = await fetch('/api/twin/grok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Grok request failed (${res.status})`);
    const outputs = [];
    for (const item of data.output || []) {
      if (item.type === 'message') {
        for (const part of item.content || []) if (part.text) { log('grok', part.text); run.push({ say: part.text }); }
      } else if (item.type === 'function_call') {
        const args = JSON.parse(item.arguments || '{}');
        log('call', `${item.name}(${JSON.stringify(args)})`);
        let result;
        try { result = await exec(item.name, args); } catch (e) { result = { error: e.message }; }
        log('result', JSON.stringify(result));
        run.push({ name: item.name, args });
        outputs.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
      } else if (/search/.test(item.type || '')) {
        log('call', `Grok used ${item.type}`);
      }
    }
    if (!outputs.length) break;
    body = { input: outputs, previous_response_id: data.id };
  }
  try { localStorage.setItem('twinLastRun', JSON.stringify(run)); } catch { /* replay is optional */ }
  return run;
}

// Offline fallback for bad Wi-Fi. Runs a saved run's tool calls on the solver, labelled as a replay.
export async function replay(run, exec, log) {
  log('call', 'Replaying a saved Grok run');
  for (const step of run) {
    if (step.say) { log('grok', step.say); continue; }
    log('call', `${step.name}(${JSON.stringify(step.args)})`);
    log('result', JSON.stringify(await exec(step.name, step.args)));
  }
}
