import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseBenchmarkReport, summarizeBenchmarkReport } from '../../src/services/benchmarkReport';
import { buildPlan, convertReportedUsage, defaultOptions, executeBenchmarkPlan, existingMethodAdapters,
  liveBlockers, parseArguments, SpendReservation, TrustedMethod } from './benchmark';
import { assessProposal, parseProposal, requestSnippet, sdkCases, staticTypecheck } from './staticSdk';

const require = createRequire(import.meta.url);

test('All eight inputs derive real installed-SDK diagnostics; corrections pass only static checks', () => {
  for (const entry of sdkCases) {
    const original = staticTypecheck(entry.input);
    assert.equal(original.passed, false, entry.id);
    assert.match(original.diagnostics, /case\.ts.*error TS/);
    const fixed = assessProposal(requestSnippet(entry.corrected));
    assert.equal(fixed.passed, true, `${entry.id}: ${fixed.diagnostics}`);
  }
});

test('Default plan makes no provider calls and produces importable null not-run metrics', () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Offline test: unexpected fetch'); };
  try {
    const plan = buildPlan();
    assert.equal(calls, 0);
    assert.equal(plan.cases.length, 8);
    assert.match(plan.criterion, /no runtime correctness/);
    const report = parseBenchmarkReport(JSON.stringify(plan.report));
    assert.equal(report.cases.length, 8);
    for (const entry of report.cases) for (const method of [entry.baseline, entry.patchpilot]) {
      assert.equal(method.result.status, 'not_run');
      assert.equal(method.result.executionScope, null);
      assert.ok(Object.values(method.usage).every(value => value === null));
    }
    assert.equal(summarizeBenchmarkReport(report).tokens, null);
    assert.equal(summarizeBenchmarkReport(report).cost, null);
  } finally { globalThis.fetch = original; }
});

test('CLI arguments default to no spending; require bounded explicit live budget', () => {
  assert.deepEqual(parseArguments([]), defaultOptions);
  assert.equal(parseArguments(['--live']).budgetUsd, 0);
  for (const args of [
    ['--budget-usd', '1.94'], ['--budget-usd', '-1'], ['--budget-usd', 'NaN'],
    ['--max-tokens', '15001'], ['--max-calls', '5'], ['--max-calls', '1.5'],
    ['--live', '--plan'], ['--live', '--live'], ['--model'], ['--unknown'],
    ['--model', 'secret with spaces'], ['--model', 'sk-offline-credential'],
    ['--model', 'https://not-a-model.example.test'],
  ]) assert.throws(() => parseArguments(args));
});

test('Unsafe URLs, fallback, missing pricing/auth and claimed routes refuse before any calls', () => {
  const options = { ...defaultOptions, live: true, budgetUsd: 0.1, model: 'provider/model' };
  const env = {
    BIFROST_MODEL: 'provider/model', BIFROST_BASE_URL: 'https://gateway.example.test',
    BIFROST_API_KEY: 'offline-test-double-key', TAVILY_API_KEY: 'offline-test-double-key',
    BIFROST_INPUT_USD_PER_MILLION: '1', BIFROST_OUTPUT_USD_PER_MILLION: '1',
    TAVILY_USD_PER_CREDIT: '0.01', BENCHMARK_ROUTING_VERIFIED: 'true',
  };
  assert.match(liveBlockers(options, env).join(' '), /not expose locally verifiable/);
  for (const url of ['http://localhost:8080', 'https://user:pass@example.test', 'https://example.test?token=x']) {
    assert.match(liveBlockers(options, { ...env, BIFROST_BASE_URL: url }).join(' '), /HTTPS/);
  }
  assert.match(liveBlockers(options, { ...env, BIFROST_FALLBACK_MODEL: 'other' }).join(' '), /fallback/);
  assert.match(liveBlockers(options, { ...env, TAVILY_USD_PER_CREDIT: '' }).join(' '), /rates/);
  assert.match(liveBlockers(options, { ...env, BIFROST_OUTPUT_USD_PER_MILLION: '-1' }).join(' '), /rates/);
  assert.match(liveBlockers(options, {}).join(' '), /authentication/);
  assert.match(liveBlockers({ ...options, budgetUsd: 0 }, env).join(' '), /positive/);
  assert.deepEqual(liveBlockers(defaultOptions, {}), []);
});

test('Reservations fail closed, round upward and never refund failed requests', () => {
  const reservation = new SpendReservation(0.1);
  reservation.reserve(0.03);
  reservation.reserve(0.04);
  assert.equal(reservation.reservedUsd, 0.07);
  assert.throws(() => reservation.reserve(0.031), /remaining budget/);
  assert.equal(reservation.reservedUsd, 0.07);
  for (const value of [-1, Infinity, NaN]) assert.throws(() => reservation.reserve(value));
  assert.throws(() => new SpendReservation(1.94));
  const tiny = new SpendReservation(0.01);
  tiny.reserve(Number.MIN_VALUE);
  assert.equal(tiny.reservedUsd, 1e-9);
});

test('Adapter factory cannot bypass live refusal or load providers in default mode', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Offline double: unexpected provider call'); };
  try {
    await assert.rejects(existingMethodAdapters(defaultOptions, {}), /refused/);
    await assert.rejects(existingMethodAdapters({ ...defaultOptions, live: true, budgetUsd: 0.1 }, {}), /refused/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('Proposal boundary excludes all executable syntax, directives, imports and no-op removals', () => {
  for (const code of [
    "import fs from 'node:fs'; fs.readFileSync('/private');",
    '/// <reference path="/private" />\n' + requestSnippet(sdkCases[0].corrected),
    requestSnippet(sdkCases[0].corrected).replace('{"model"', '(()=>({"model"'),
    requestSnippet(sdkCases[0].corrected).replace(';\n', ' as any;\n'),
    'export {};',
  ]) {
    assert.throws(() => parseProposal(code));
    assert.equal(assessProposal(code).passed, false);
  }
  assert.equal(assessProposal(requestSnippet({})).passed, false);
  assert.equal(assessProposal(requestSnippet({ model: 'other', contents: 'x' })).passed, false);
});

test('Real CLI stdout remains importable and live refusal redacts env secrets', () => {
  for (const live of [false, true]) {
    const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'tests/benchmarks/cli.ts',
      ...(live ? ['--live', '--budget-usd', '0.1', '--model', 'provider/model'] : [])], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 128000,
      env: { PATH: process.env.PATH ?? '', BIFROST_API_KEY: 'offline-secret-sentinel',
        TAVILY_API_KEY: 'offline-secret-sentinel' },
    });
    assert.equal(result.status, live ? 2 : 0, result.stderr);
    const report = parseBenchmarkReport(result.stdout);
    assert.equal(report.cases.length, 8);
    const summary = JSON.parse(result.stderr);
    assert.equal(summary.mode, live ? 'live-refused' : 'plan');
    assert.equal(summary.providerRequestsDispatched, 0);
    assert.equal(summary.reservedUsd, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /offline-secret-sentinel/);
  }
});

// Labelled offline doubles only: these never stand in for production measurements.
const offlineUsage = () => ({
  model: 'offline-double-model', inputTokens: 8, outputTokens: 2, totalTokens: 10,
  isMeasured: true, usageReported: true, estimatedCost: 0.001, currency: 'USD',
  costBasis: 'configured_rates',
});
const offlineOptions = { ...defaultOptions, live: true, budgetUsd: 0.2, model: 'offline-double-model' };
function offlinePlan() {
  const cases = buildPlan().cases.slice(0, 2);
  const unrun = () => ({
    model: null, budget: { maxTokens: 15000, maxCalls: 4 },
    result: { status: 'not_run' as const, executionScope: null, passed: 0, failed: 0, notRun: 1 },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, modelCalls: null, costUsd: null, costBasis: null },
  });
  return { cases, report: { version: 1 as const, cases: cases.map(entry => ({
    id: entry.id, label: 'Offline plan double', baseline: unrun(), patchpilot: unrun(),
  })) } };
}

test('Tampered code, diagnostics or execution scope are rejected before callbacks', async () => {
  let calls = 0;
  const method: TrustedMethod = { verifiedWorstCaseUsd: 0.01,
    run: async () => { calls++; return { assessment: { passed: false } }; } };
  for (const field of ['code', 'diagnostics', 'executionScope'] as const) {
    const plan = offlinePlan();
    plan.cases[0][field] = 'tampered';
    await assert.rejects(executeBenchmarkPlan(plan, offlineOptions, {
      baseline: method, patchpilot: method,
    }), /Invalid controlled case plan/);
  }
  assert.equal(calls, 0);
});

test('Orchestrator reserves before serial calls with identical immutable inputs/model/budget options', async () => {
  const calls: { method: string; entry: unknown; options: unknown; reserved: number }[] = [];
  let active = false;
  const method = (name: string): TrustedMethod => ({ verifiedWorstCaseUsd: 0.01,
    run: async (entry, options, reservation) => {
      assert.equal(active, false);
      active = true;
      await Promise.resolve();
      assert.ok(Object.isFrozen(entry));
      assert.ok(Object.isFrozen(options));
      calls.push({ method: name, entry, options, reserved: reservation.reservedUsd });
      active = false;
      return { assessment: { passed: true, diagnostics: 'offline-secret-sentinel' }, usage: offlineUsage() };
    } });
  const result = await executeBenchmarkPlan(offlinePlan(), offlineOptions, {
    baseline: method('baseline'), patchpilot: method('patchpilot'),
  });
  assert.deepEqual(calls.map(call => call.method), ['baseline', 'patchpilot', 'baseline', 'patchpilot']);
  assert.deepEqual(calls.map(call => call.reserved), [0.01, 0.02, 0.03, 0.04]);
  assert.equal(calls[0].entry, calls[1].entry);
  assert.equal(calls[0].options, calls[1].options);
  assert.deepEqual(calls[0].options, offlineOptions);
  assert.equal(result.reservedUsd, 0.04);
  assert.equal(parseBenchmarkReport(JSON.stringify(result.report)).cases[0].baseline.result.status, 'passed');
  assert.doesNotMatch(JSON.stringify(result), /offline-secret-sentinel|import type|proposed_code/);
});

test('Exhaustion leaves unmatched trial and remainder not run, without refunding failed attempts', async () => {
  let calls = 0;
  const method: TrustedMethod = { verifiedWorstCaseUsd: 0.03, run: async () => {
    calls++;
    throw Object.assign(new Error('offline-secret-sentinel'), {
      usage: { model: offlineUsage(), modelCalls: 1, incompleteModelUsage: false,
        actualCostUsd: null, estimatedCostUsd: 0.001, costBasis: 'configured_rates' },
    });
  } };
  const result = await executeBenchmarkPlan(offlinePlan(), { ...offlineOptions, budgetUsd: 0.05 },
    { baseline: method, patchpilot: method });
  assert.equal(calls, 1);
  assert.equal(result.reservedUsd, 0.03);
  assert.equal(result.report.cases[0].baseline.result.status, 'failed');
  assert.equal(result.report.cases[0].baseline.usage.modelCalls, 1);
  assert.equal(result.report.cases[0].baseline.usage.totalTokens, 10);
  assert.equal(result.report.cases[0].patchpilot.result.status, 'not_run');
  assert.equal(result.report.cases[1].baseline.result.status, 'not_run');
  assert.equal(summarizeBenchmarkReport(result.report).cost, null);
  assert.doesNotMatch(JSON.stringify(result), /offline-secret-sentinel/);
});

test('Missing and partial usage stays unknown; actual invoices never become configured estimates', () => {
  const missing = convertReportedUsage(undefined);
  assert.equal(missing.model, null);
  assert.ok(Object.values(missing.usage).every(value => value === null));
  const legacy = convertReportedUsage(offlineUsage()).usage;
  assert.equal(legacy.totalTokens, 10);
  assert.equal(legacy.modelCalls, null);
  assert.equal(legacy.costUsd, 0.001);
  assert.equal(legacy.costBasis, 'estimated');
  const partial = convertReportedUsage({ model: offlineUsage(), modelCalls: 2, incompleteModelUsage: true,
    actualCostUsd: null, estimatedCostUsd: 0.001, costBasis: 'configured_rates' }).usage;
  assert.equal(partial.totalTokens, null);
  assert.equal(partial.inputTokens, null);
  assert.equal(partial.costUsd, null);
  assert.equal(partial.modelCalls, 2);
  const actual = convertReportedUsage({ model: null, modelCalls: 1, incompleteModelUsage: true,
    actualCostUsd: 0, estimatedCostUsd: 0.5, costBasis: 'configured_rates' }).usage;
  assert.equal(actual.costUsd, 0);
  assert.equal(actual.costBasis, 'actual');
  assert.equal(actual.totalTokens, null);
  for (const patch of [{ isMeasured: false }, { costBasis: 'generic_estimate' },
    { currency: 'EUR' }, { fallbackUsed: true }])
    assert.equal(convertReportedUsage({ ...offlineUsage(), ...patch }).usage.costUsd, null);
  assert.equal(convertReportedUsage({ ...offlineUsage(), totalTokens: 999 }).usage.totalTokens, null);
  assert.equal(convertReportedUsage({ ...offlineUsage(), totalTokens: 999 }).usage.costUsd, null);
});

test('Orchestrator retains missing usage and distinct actual/estimated costs without comparable savings', async () => {
  const result = await executeBenchmarkPlan(offlinePlan(), offlineOptions, {
    baseline: { verifiedWorstCaseUsd: 0.01, run: async () => ({ assessment: { passed: true },
      usage: { model: offlineUsage(), modelCalls: 1, incompleteModelUsage: false,
        actualCostUsd: 0.002, estimatedCostUsd: 0.001, costBasis: 'configured_rates' } }) },
    patchpilot: { verifiedWorstCaseUsd: 0.01, run: async entry => entry.id === sdkCases[0].id
      ? { assessment: { passed: true }, usage: offlineUsage() } : { assessment: { passed: false } } },
  });
  assert.equal(result.report.cases[0].baseline.usage.costBasis, 'actual');
  assert.equal(result.report.cases[0].patchpilot.usage.costBasis, 'estimated');
  assert.equal(result.report.cases[1].patchpilot.result.status, 'failed');
  assert.ok(Object.values(result.report.cases[1].patchpilot.usage).every(value => value === null));
  assert.equal(summarizeBenchmarkReport(result.report).cases[0].cost, null);
  assert.equal(summarizeBenchmarkReport(result.report).cost, null);
});

test('No default/zero-budget orchestration calls; invalid costs fail before dispatch; overrun stops remainder', async () => {
  let calls = 0;
  const method: TrustedMethod = { verifiedWorstCaseUsd: 0.01, run: async () => {
    calls++;
    return { assessment: { passed: true }, usage: { ...offlineUsage(), actualCostUsd: 0.02 } };
  } };
  for (const options of [defaultOptions, { ...offlineOptions, budgetUsd: 0 }]) {
    const result = await executeBenchmarkPlan(offlinePlan(), options, { baseline: method, patchpilot: method });
    assert.equal(result.reservedUsd, 0);
  }
  assert.equal(calls, 0);
  await assert.rejects(executeBenchmarkPlan(offlinePlan(), offlineOptions, {
    baseline: { ...method, verifiedWorstCaseUsd: NaN }, patchpilot: method,
  }), /verified worst-case/);
  assert.equal(calls, 0);
  const result = await executeBenchmarkPlan(offlinePlan(), offlineOptions, { baseline: method, patchpilot: method });
  assert.equal(calls, 1);
  assert.equal(result.report.cases[0].baseline.result.status, 'failed');
  assert.equal(result.report.cases[0].baseline.usage.costUsd, 0.02);
  assert.equal(result.report.cases[0].patchpilot.result.status, 'not_run');
  assert.match(result.diagnostics[0].message, /exceeded verified bounds/);
});
