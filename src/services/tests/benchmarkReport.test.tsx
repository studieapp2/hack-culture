import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Benchmarks, BenchmarkReportView } from '../../pages/Benchmarks';
import { BenchmarkMethod, BenchmarkReport, MAX_BENCHMARK_REPORT_BYTES,
  parseBenchmarkReport, readBenchmarkReport, summarizeBenchmarkReport } from '../benchmarkReport';

function method(): BenchmarkMethod {
  return {
    model: 'test-model',
    budget: { maxTokens: 1000, maxCalls: 4 },
    result: { status: 'passed', executionScope: 'input-suite-environment', passed: 2, failed: 0, notRun: 0 },
    usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, modelCalls: 1, costUsd: 0.01, costBasis: 'actual' },
  };
}
function fixture(): BenchmarkReport {
  const patchpilot = method();
  patchpilot.usage = { ...patchpilot.usage, inputTokens: 30, totalTokens: 50, costUsd: 0.005 };
  return { version: 1, cases: [{ id: 'case-1', label: 'Local test case', baseline: method(), patchpilot }] };
}
const parse = (value: unknown) => parseBenchmarkReport(JSON.stringify(value));

test('Strict v1 report preserves measured values, null unknowns and zero', () => {
  const report = fixture();
  report.cases[0].baseline.usage = { inputTokens: null, outputTokens: null, totalTokens: null, modelCalls: 0, costUsd: 0, costBasis: 'actual' };
  assert.deepEqual(parse(report), report);
  assert.equal(summarizeBenchmarkReport(parse(report)).tokens, null);
  assert.equal(summarizeBenchmarkReport(parse(report)).cost?.percent, null);
});

test('Malformed JSON, unsupported version, extra keys and omitted fields fail clearly', () => {
  assert.throws(() => parseBenchmarkReport('{'), /Invalid JSON/);
  assert.throws(() => parse({ ...fixture(), version: 2 }), /version/);
  assert.throws(() => parse({ ...fixture(), script: 'ignored' }), /Unrecognized key/);
  const report = fixture();
  delete (report.cases[0].baseline.usage as Partial<BenchmarkMethod['usage']>).costUsd;
  assert.throws(() => parse(report), /costUsd/);
  assert.throws(() => parse({ version: 1, cases: [] }), /cases/);
});

test('Reject negative, fractional, unsafe, nonnumeric and inconsistent accounting', () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100']) {
    const report = fixture();
    Object.assign(report.cases[0].baseline.usage, { inputTokens: value });
    assert.throws(() => parse(report), /inputTokens/);
  }
  for (const update of [
    { totalTokens: 99 }, { costUsd: -1 }, { costBasis: null }, { modelCalls: 5 },
    { inputTokens: null, outputTokens: null, totalTokens: 1001 },
  ]) {
    const report = fixture();
    Object.assign(report.cases[0].baseline.usage, update);
    assert.throws(() => parse(report), /Invalid benchmark report/);
  }
});

test('Reject duplicate identity and inconsistent results', () => {
  const duplicate = fixture();
  duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => parse(duplicate), /unique/);
  for (const update of [
    { failed: 1 }, { passed: 0 }, { status: 'failed' }, { status: 'not_run' },
    { passed: -1 }, { notRun: 0.5 }, { executionScope: null },
    { passed: Number.MAX_SAFE_INTEGER, failed: 1 },
  ]) {
    const report = fixture();
    Object.assign(report.cases[0].baseline.result, update);
    assert.throws(() => parse(report), /Invalid benchmark report/);
  }
});

test('Size is checked before reading and UTF-8 content is bounded', async () => {
  let read = false;
  await assert.rejects(readBenchmarkReport({ size: MAX_BENCHMARK_REPORT_BYTES + 1,
    text: async () => { read = true; return '{}'; } }), /limit/);
  assert.equal(read, false);
  assert.throws(() => parseBenchmarkReport('é'.repeat(MAX_BENCHMARK_REPORT_BYTES / 2 + 1)), /limit/);
  assert.deepEqual(await readBenchmarkReport({ size: 1, text: async () => JSON.stringify(fixture()) }), fixture());
  await assert.rejects(readBenchmarkReport({ size: 1, text: async () => { throw new Error('Read failed'); } }), /Read failed/);
});

test('Matched measurements yield signed savings without a zero-baseline percentage', () => {
  const summary = summarizeBenchmarkReport(parse(fixture()));
  assert.equal(summary.comparableCases, 1);
  assert.deepEqual(summary.tokens, { baseline: 100, patchpilot: 50, saved: 50, percent: 50 });
  assert.equal(summary.cost?.percent, 50);
  const report = fixture();
  report.cases[0].baseline.usage = { ...method().usage, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  assert.equal(summarizeBenchmarkReport(parse(report)).tokens?.saved, -50);
  assert.equal(summarizeBenchmarkReport(parse(report)).tokens?.percent, null);
});

test('Missing models/budgets, different models/budgets or unmatched execution never yield savings', () => {
  for (const mutate of [
    (m: BenchmarkMethod) => { m.model = null; },
    (m: BenchmarkMethod) => { m.model = 'other'; },
    (m: BenchmarkMethod) => { m.budget.maxTokens = null; },
    (m: BenchmarkMethod) => { m.budget.maxTokens = 2000; },
    (m: BenchmarkMethod) => { m.budget.maxCalls = 2; },
    (m: BenchmarkMethod) => { m.result.executionScope = 'different'; },
    (m: BenchmarkMethod) => { m.result.passed = 3; },
  ]) {
    const report = fixture();
    mutate(report.cases[0].patchpilot);
    const summary = summarizeBenchmarkReport(parse(report));
    assert.equal(summary.tokens, null);
    assert.equal(summary.cost, null);
    assert.ok(summary.cases[0].reasons.length > 0);
  }
});

test('Missing measurements and cost-basis mismatch suppress only affected comparisons', () => {
  const report = fixture();
  report.cases[0].patchpilot.usage.totalTokens = null;
  report.cases[0].patchpilot.usage.costBasis = 'estimated';
  const summary = summarizeBenchmarkReport(parse(report));
  assert.equal(summary.comparableCases, 1);
  assert.equal(summary.tokens, null);
  assert.equal(summary.cost, null);
  report.cases[0].patchpilot.usage.costUsd = null;
  report.cases[0].patchpilot.usage.costBasis = null;
  assert.equal(summarizeBenchmarkReport(parse(report)).cost, null);
});

test('Mixed model/budget cohorts and incomplete cohorts cannot produce whole-report savings', () => {
  for (const mix of ['model', 'budget', 'costBasis', 'missing'] as const) {
    const report = fixture();
    const next = fixture().cases[0];
    next.id = 'case-2';
    for (const m of [next.baseline, next.patchpilot]) {
      if (mix === 'model') m.model = 'other-model';
      if (mix === 'budget') m.budget.maxTokens = 2000;
      if (mix === 'costBasis') m.usage.costBasis = 'estimated';
      if (mix === 'missing') m.usage.totalTokens = null;
    }
    report.cases.push(next);
    const summary = summarizeBenchmarkReport(parse(report));
    if (mix !== 'costBasis') assert.equal(summary.tokens, null);
    if (mix !== 'missing') assert.equal(summary.cost, null);
    else assert.equal(summary.cost?.percent, 50);
  }
});

test('Failed and not-run cases remain in denominators, retain usage honestly and suppress savings', () => {
  const report = fixture();
  report.cases[0].baseline.result = { ...method().result, status: 'failed', passed: 1, failed: 1 };
  report.cases[0].patchpilot.result = { status: 'not_run', executionScope: null, passed: 0, failed: 0, notRun: 2 };
  report.cases[0].patchpilot.usage = { inputTokens: null, outputTokens: null, totalTokens: null, modelCalls: null, costUsd: null, costBasis: null };
  const parsed = parse(report);
  const summary = summarizeBenchmarkReport(parsed);
  assert.equal(summary.baseline.failed, 1);
  assert.equal(summary.patchpilot.notRun, 1);
  assert.equal(summary.tokens, null);
  assert.equal(summary.cost, null);
  const html = renderToStaticMarkup(<BenchmarkReportView report={parsed} />);
  assert.match(html, /Failed/);
  assert.match(html, /Not run/);
  assert.match(html, /Not reported/);
  assert.match(html, /0 of 1/);
  report.cases[0].patchpilot.usage.modelCalls = 0;
  assert.throws(() => parse(report), /Not-run/);
});

test('SSR starts empty, accessible and explicit about local-only unverified reports', () => {
  const html = renderToStaticMarkup(<Benchmarks />);
  assert.match(html, /No report imported/);
  assert.match(html, /type="file"/);
  assert.match(html, /for="benchmark-report"/);
  assert.match(html, /no automatic uploads/);
  assert.doesNotMatch(html, /Whole-report token savings:/);
  const report = fixture();
  report.cases[0].label = '<script>alert(1)</script>';
  const imported = renderToStaticMarkup(<BenchmarkReportView report={parse(report)} />);
  assert.match(imported, /not independently reverified/);
  assert.match(imported, /scope="col"/);
  assert.match(imported, /overflow-x-auto/);
  assert.match(imported, /&lt;script&gt;/);
  assert.doesNotMatch(imported, /<script>/);
});

test('Extreme numeric accounting never yields infinite savings or rounded-to-zero costs', () => {
  const report = fixture();
  report.cases[0].baseline.usage.costUsd = Number.MIN_VALUE;
  report.cases[0].patchpilot.usage.costUsd = Number.MAX_VALUE;
  const summary = summarizeBenchmarkReport(parse(report));
  assert.equal(summary.cost?.percent, null);
  assert.ok(Number.isFinite(summary.cost?.saved));
  const html = renderToStaticMarkup(<BenchmarkReportView report={parse(report)} />);
  assert.doesNotMatch(html, /Infinity|NaN/);
  const next = fixture().cases[0];
  next.id = 'case-2';
  next.baseline.usage.costUsd = Number.MAX_VALUE;
  report.cases[0].baseline.usage.costUsd = Number.MAX_VALUE;
  report.cases.push(next);
  assert.equal(summarizeBenchmarkReport(parse(report)).cost, null);
  const unsafe = fixture();
  Object.assign(unsafe.cases[0].baseline.usage, {
    inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: null,
  });
  assert.throws(() => parse(unsafe), /safe integer/);
});
