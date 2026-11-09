import { advance, createRun, observe, scenarios, staticBaseline } from './engine.js';

const $ = id => document.getElementById(id);
const key = scenarioId => `signal-room-demo:v1:${scenarioId}`;
let scenarioId = 'supply';
let run;

function loadRun(id) {
  try {
    const stored = JSON.parse(localStorage.getItem(key(id)));
    if (stored?.schemaVersion === 1 && stored.scenarioId === id && Array.isArray(stored.trace) && Array.isArray(stored.plan?.steps)) return stored;
  } catch { /* malformed local demo state starts fresh */ }
  return advance(createRun(id));
}

function persist() {
  localStorage.setItem(key(scenarioId), JSON.stringify(run));
  $('save-state').textContent = 'Saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function planList(target, plan) {
  target.replaceChildren(...plan.steps.map((step, index) => {
    const item = document.createElement('li'); item.className = step.status || 'pending';
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('strong'); title.textContent = step.label;
    const state = document.createElement('em'); state.textContent = step.status === 'simulated' ? 'SIMULATED' : step.status === 'waiting-review' ? 'HUMAN REVIEW' : step.needsReview ? 'REVIEW REQUIRED' : 'PENDING';
    item.append(number, title, state); return item;
  }));
}

function render() {
  const spec = scenarios[scenarioId];
  $('mission-title').textContent = spec.label;
  $('mission-subtitle').textContent = spec.mission;
  $('run-status').textContent = run.status.replace('-', ' ').toUpperCase();
  $('run-status').className = `run-status ${run.status}`;
  $('plan-version').textContent = `VERSION ${run.plan.version}`;
  $('plan-name').textContent = run.plan.name;
  $('assumptions').textContent = Object.entries(run.plan.assumptions).map(([fact, value]) => `${fact} = ${value}`).join(' · ') || 'No safe assumption available';
  planList($('plan-steps'), run.plan);
  const before = run.previousPlans.at(-1) || run.initialPlan;
  $('previous-version').textContent = run.previousPlans.length ? `VERSION ${before.version}` : 'ORIGINAL PLAN';
  $('previous-name').textContent = before.name;
  planList($('previous-steps'), before);
  const baseline = staticBaseline(run);
  $('baseline').className = `baseline ${baseline.status === 'WOULD FAIL' ? 'bad' : 'good'}`;
  $('baseline').replaceChildren();
  const label = document.createElement('strong'); label.textContent = `STATIC BASELINE · ${baseline.status}`;
  const detail = document.createElement('span'); detail.textContent = baseline.message;
  $('baseline').append(label, detail);
  const revision = [...run.trace].reverse().find(item => item.kind === 'revision' || item.kind === 'quarantine' || item.kind === 'guard');
  if (revision) {
    $('revision-title').textContent = revision.kind === 'revision' ? `${revision.from} → ${revision.to}` : revision.kind === 'quarantine' ? 'False signal contained.' : 'Run paused safely.';
    $('revision-reason').textContent = revision.message;
    $('revision').classList.toggle('changed', revision.kind === 'revision');
  } else {
    $('revision-title').textContent = 'Waiting for a changed-world signal.';
    $('revision-reason').textContent = 'The first simulated step is complete. Inject a verified change to compare the adaptive route with the original plan.';
    $('revision').classList.remove('changed');
  }
  $('trace').replaceChildren(...[...run.trace].reverse().map(entry => {
    const item = document.createElement('li'); item.className = entry.kind;
    const number = document.createElement('span'); number.textContent = String(entry.seq).padStart(2, '0');
    const type = document.createElement('b'); type.textContent = entry.kind.toUpperCase();
    const message = document.createElement('p'); message.textContent = entry.message;
    item.append(number, type, message); return item;
  }));
  $('step').disabled = run.status !== 'active';
  $('secondary-change').hidden = scenarioId !== 'supply' || run.plan.version === 0 || run.observations.some(item => item.id === 'alternate-stockout');
  document.querySelectorAll('[data-scenario]').forEach(button => button.classList.toggle('selected', button.dataset.scenario === scenarioId));
}

function update(next) { run = next; persist(); render(); }

function switchScenario(id) {
  scenarioId = id; run = loadRun(id); persist(); render();
}

document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => switchScenario(button.dataset.scenario)));
$('step').addEventListener('click', () => update(advance(run)));
$('change').addEventListener('click', () => update(observe(run, scenarios[scenarioId].change)));
$('older').addEventListener('click', () => {
  const change = scenarios[scenarioId].change;
  update(observe(run, { ...change, id: 'late-'+change.id, version: 1, value: !change.value }));
});
$('rumor').addEventListener('click', () => update(observe(run, scenarios[scenarioId].rumor)));
$('secondary-change').addEventListener('click', () => update(observe(run, { id: 'alternate-stockout', fact: 'alternateStock', value: false, source: 'verified alternate inventory', verified: true })));
$('reset').addEventListener('click', () => { localStorage.removeItem(key(scenarioId)); switchScenario(scenarioId); });
switchScenario(scenarioId);
