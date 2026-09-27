import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, createRun, observe, scenarios, staticBaseline } from '../engine.js';

test('multi-step run advances and stops before human-reviewed action', () => {
  let run = createRun('supply');
  run = advance(run); run = advance(run); run = advance(run);
  assert.deepEqual(run.plan.steps.map(step => step.status), ['simulated', 'simulated', 'waiting-review']);
  assert.equal(run.status, 'waiting-review');
});
test('verified supplier stockout triggers a reasoned alternate plan', () => {
  let run = advance(createRun('supply'));
  run = observe(run, scenarios.supply.change);
  assert.equal(run.plan.version, 1);
  assert.equal(run.plan.name, 'Alternate supplier with review');
  assert.match(run.trace.at(-1).message, /Changed my mind: primaryStock is now false/);
  assert.equal(staticBaseline(run).status, 'WOULD FAIL');
  assert.match(staticBaseline(run).message, /Reserve primary supplier stock/);
});
test('verified error spike prevents release promotion', () => {
  let run = advance(createRun('release'));
  run = observe(run, scenarios.release.change);
  assert.equal(run.plan.name, 'Pause and review rollback');
  assert.equal(staticBaseline(run).status, 'WOULD FAIL');
  assert.match(staticBaseline(run).message, /Promote full release/);
  run = advance(run); run = advance(run);
  assert.equal(run.status, 'waiting-review');
});
test('unverified rumor is quarantined instead of causing false adaptation', () => {
  const run = observe(createRun('supply'), scenarios.supply.rumor);
  assert.equal(run.plan.version, 0);
  assert.equal(run.world.primaryStock, true);
  assert.equal(run.trace.at(-1).kind, 'quarantine');
});
test('duplicate events cannot cause repeated revisions', () => {
  let run = observe(createRun('supply'), scenarios.supply.change);
  run = observe(run, scenarios.supply.change);
  assert.equal(run.revisionCount, 1);
  assert.equal(run.trace.at(-1).kind, 'duplicate');
});
test('loss of alternate supplier leaves the run paused, not blindly shipping', () => {
  let run = observe(createRun('supply'), scenarios.supply.change);
  run = observe(run, { id: 'alternate-stockout', fact: 'alternateStock', value: false, source: 'verified alternate inventory', verified: true });
  assert.equal(run.plan.name, 'Hold for human review');
  assert.equal(run.status, 'paused');
  assert.equal(advance(run).trace.length, run.trace.length);
});
test('state survives serialization with revision trace intact', () => {
  const run = observe(advance(createRun('release')), scenarios.release.change);
  const restored = JSON.parse(JSON.stringify(run));
  assert.deepEqual(restored, run);
  assert.equal(advance(restored).plan.steps[0].status, 'simulated');
});
