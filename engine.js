export const scenarios = {
  supply: {
    label: 'Medical kit shipment',
    mission: 'Ship a synthetic training kit to a clinic',
    initialWorld: { primaryStock: true, alternateStock: true },
    initialPlan: {
      name: 'Primary supplier route',
      assumptions: { primaryStock: true },
      steps: [
        { id: 'check', label: 'Check approved order and delivery window' },
        { id: 'reserve', label: 'Reserve primary supplier stock' },
        { id: 'ship', label: 'Release shipment', needsReview: true }
      ]
    },
    change: { id: 'supplier-stockout', fact: 'primaryStock', value: false, source: 'supplier inventory event', verified: true, version: 2 },
    rumor: { id: 'supplier-rumor', fact: 'primaryStock', value: false, source: 'unverified chat rumor', verified: false }
  },
  release: {
    label: 'Canary release',
    mission: 'Promote a synthetic software release',
    initialWorld: { errorRateNormal: true, rollbackReady: true },
    initialPlan: {
      name: 'Promote healthy canary',
      assumptions: { errorRateNormal: true },
      steps: [
        { id: 'canary', label: 'Start canary rollout' },
        { id: 'measure', label: 'Review canary telemetry' },
        { id: 'promote', label: 'Promote full release', needsReview: true }
      ]
    },
    change: { id: 'error-spike', fact: 'errorRateNormal', value: false, source: 'verified telemetry event', verified: true, version: 2 },
    rumor: { id: 'error-rumor', fact: 'errorRateNormal', value: false, source: 'unverified chat rumor', verified: false }
  }
};

function planWithStatus(plan, version) {
  return { name: plan.name, version, assumptions: { ...plan.assumptions }, steps: plan.steps.map(step => ({ ...step, status: 'pending' })) };
}

function append(run, kind, message, extra = {}) {
  run.trace.push({ seq: run.trace.length + 1, kind, message, ...extra });
}

export function createRun(scenarioId) {
  const spec = scenarios[scenarioId];
  if (!spec) throw new Error('Unknown scenario');
  const run = {
    schemaVersion: 1, scenarioId, world: { ...spec.initialWorld },
    plan: planWithStatus(spec.initialPlan, 0), initialPlan: planWithStatus(spec.initialPlan, 0),
    previousPlans: [], observations: [], trace: [], status: 'active', revisionCount: 0
  };
  append(run, 'plan', `Plan v0 created: ${run.plan.name}.`, { assumptions: { ...run.plan.assumptions } });
  return run;
}

export function advance(input) {
  const run = structuredClone(input);
  if (run.status !== 'active') return run;
  const failed = Object.entries(run.plan.assumptions).find(([fact, expected]) => run.world[fact] !== expected);
  if (failed) {
    run.status = 'paused';
    append(run, 'guard', `Step blocked: ${failed[0]} no longer equals ${failed[1]}.`);
    return run;
  }
  const step = run.plan.steps.find(item => item.status === 'pending');
  if (!step) { run.status = 'complete'; return run; }
  if (step.needsReview) {
    step.status = 'waiting-review'; run.status = 'waiting-review';
    append(run, 'review', `${step.label} requires named human approval. No action was executed.`);
    return run;
  }
  step.status = 'simulated';
  append(run, 'step', `Simulated: ${step.label}.`);
  if (run.plan.steps.every(item => item.status !== 'pending')) run.status = 'complete';
  return run;
}

function nextPlan(run) {
  if (run.scenarioId === 'supply') {
    if (run.world.primaryStock && run.plan.name !== 'Primary supplier route') return scenarios.supply.initialPlan;
    if (run.world.alternateStock) return {
      name: 'Alternate supplier with review', assumptions: { alternateStock: true },
      steps: [
        { id: 'alternate', label: 'Check alternate supplier availability' },
        { id: 'quote', label: 'Request quote and delivery review', needsReview: true },
        { id: 'ship-alt', label: 'Release alternate shipment', needsReview: true }
      ]
    };
    return null;
  }
  if (run.world.rollbackReady) return {
    name: 'Pause and review rollback', assumptions: { rollbackReady: true },
    steps: [
      { id: 'pause', label: 'Pause full promotion' },
      { id: 'review-rollback', label: 'Approve canary rollback', needsReview: true }
    ]
  };
  return null;
}

export function observe(input, observation) {
  const run = structuredClone(input);
  if (!observation || typeof observation.id !== 'string' || !Object.hasOwn(run.world, observation.fact) || typeof observation.value !== 'boolean') throw new Error('Invalid observation');
  if (run.observations.some(item => item.id === observation.id)) {
    append(run, 'duplicate', `${observation.id} already processed; no revision.`);
    return run;
  }
  run.observations.push({ ...observation });
  if (!observation.verified) {
    append(run, 'quarantine', `${observation.source} reported ${observation.fact}=${observation.value}, but the source is unverified. Plan unchanged.`);
    return run;
  }
  const version = observation.version ?? 1;
  const latest = run.evidenceVersions?.[observation.fact] ?? 0;
  if (!Number.isSafeInteger(version) || version <= latest) {
    append(run, 'stale', `Ignored ${observation.id}: evidence version ${version} does not supersede ${latest}.`);
    return run;
  }
  (run.evidenceVersions ??= {})[observation.fact] = version;
  const before = run.world[observation.fact];
  run.world[observation.fact] = observation.value;
  append(run, 'observation', `${observation.source}: ${observation.fact} changed ${before} → ${observation.value}.`);
  const conflict = Object.entries(run.plan.assumptions).find(([fact, expected]) => run.world[fact] !== expected);
  if (!conflict) return run;
  const reason = `${conflict[0]} is now ${run.world[conflict[0]]}; plan v${run.plan.version} assumed ${conflict[1]}.`;
  if (run.revisionCount >= 2) {
    run.status = 'paused'; append(run, 'guard', `Revision budget reached. ${reason} Human review required.`);
    return run;
  }
  const replacement = nextPlan(run);
  run.previousPlans.push(structuredClone(run.plan));
  run.revisionCount++;
  if (!replacement) {
    run.plan = planWithStatus({ name: 'Hold for human review', assumptions: {}, steps: [] }, run.revisionCount);
    run.status = 'paused';
    append(run, 'revision', `Changed my mind: ${reason} No verified safe route remains; pause and escalate.`, { from: run.previousPlans.at(-1).name, to: run.plan.name });
    return run;
  }
  run.plan = planWithStatus(replacement, run.revisionCount);
  run.status = 'active';
  append(run, 'revision', `Changed my mind: ${reason} Replaced ${run.previousPlans.at(-1).name} with ${run.plan.name}.`, { from: run.previousPlans.at(-1).name, to: run.plan.name });
  return run;
}

export function staticBaseline(run) {
  const conflict = Object.entries(run.initialPlan.assumptions).find(([fact, expected]) => run.world[fact] !== expected);
  if (!conflict) return { status: 'VALID', message: 'The original plan still matches the observed world.' };
  const unsafeStep = run.scenarioId === 'release' ? 'Promote full release' : 'Reserve primary supplier stock';
  return { status: 'WOULD FAIL', message: `A non-adaptive agent would eventually attempt “${unsafeStep}” while ${conflict[0]}=${run.world[conflict[0]]}.` };
}
