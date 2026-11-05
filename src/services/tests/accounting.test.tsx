import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeUsage, formatCost, formatTokens } from '../usage';
import { apiClient } from '../apiClient';
import { UsageSummary, BudgetIndicator } from '../../components/shared/UsageSummary';
import { RunStatusBadge } from '../../components/shared/StatusBadge';
import { RunTimeline } from '../../components/runs/RunTimeline';
import { pendingRequestSteps } from '../workflowPresentation';

const measured = { inputTokens: 100, outputTokens: 20, totalTokens: 120,
  estimatedCost: 0.003, currency: 'USD', isMeasured: true, model: 'fixture' };
const run = { id: 'client-test', title: 'Client test fixture', type: 'code_fix',
  status: 'COMPLETED', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
  steps: [], claims: [], tests: [], usage: measured };

async function normalizeThroughApi(value: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([value]), {
    headers: { 'Content-Type': 'application/json' },
  });
  try { return (await apiClient.listRuns())[0]; }
  finally { globalThis.fetch = original; }
}

test('Absent accounting stays unknown instead of becoming zero or free', () => {
  const usage = normalizeUsage(undefined);
  assert.equal(usage.inputTokens, null);
  assert.equal(usage.outputTokens, null);
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.estimatedCost, null);
  assert.equal(usage.actualCost, null);
  assert.equal(usage.isMeasured, false);
  assert.equal(formatCost(usage.estimatedCost), 'Not reported');
  assert.equal(formatTokens(usage.totalTokens), 'Not reported');
});

test('Unmeasured positive numbers are not presented as reported tokens', () => {
  const usage = normalizeUsage({ ...measured, isMeasured: false });
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.estimatedCost, null);
});

test('A measured zero is distinguished from missing data', () => {
  const usage = normalizeUsage({ ...measured, inputTokens: 0, outputTokens: 0,
    totalTokens: 0, estimatedCost: 0 });
  assert.equal(usage.isMeasured, true);
  assert.equal(formatTokens(usage.totalTokens), '0');
  assert.equal(formatCost(usage.estimatedCost), '$0.0000');
});

test('Valid legacy measurements and estimate basis survive normalization', () => {
  const usage = normalizeUsage({ ...measured, costBasis: 'configured_rates' });
  assert.equal(usage.totalTokens, 120);
  assert.equal(usage.estimatedCost, 0.003);
  assert.equal(usage.actualCost, null);
  assert.equal(usage.costBasis, 'configured_rates');
});

test('Malformed token/cost values cannot produce confident numeric accounting', () => {
  for (const value of [
    { ...measured, inputTokens: NaN },
    { ...measured, outputTokens: -1 },
    { ...measured, inputTokens: 1.5 },
    { ...measured, totalTokens: 999 },
  ]) assert.equal(normalizeUsage(value).totalTokens, null);
  assert.equal(normalizeUsage({ ...measured, estimatedCost: Infinity }).estimatedCost, null);
});

test('Canonical v1 usage preserves unknown invoices and actual request counts', () => {
  const usage = normalizeUsage({ model: null, modelCalls: 1, actualCostUsd: null,
    estimatedCostUsd: null, costBasis: 'not_reported', incompleteModelUsage: true });
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.modelCalls, 1);
  assert.equal(usage.actualCost, null);
  assert.equal(usage.incompleteModelUsage, true);
});

test('Partial reported model usage is retained and explicitly labeled partial', () => {
  const usage = normalizeUsage({ model: measured, modelCalls: 2, incompleteModelUsage: true,
    actualCostUsd: null, estimatedCostUsd: null });
  assert.equal(usage.totalTokens, 120);
  const html = renderToStaticMarkup(<UsageSummary usage={usage} />);
  assert.match(html, /Partial reported usage/);
  assert.match(html, /Not reported/);
});

test('Unknown run states are not silently classified as completed', async () => {
  for (const status of ['UNRECOGNIZED', null, undefined]) {
    assert.equal((await normalizeThroughApi({ ...run, status })).status, 'unknown');
  }
  const html = renderToStaticMarkup(<RunStatusBadge status="unknown" />);
  assert.match(html, /Unknown status/);
  assert.doesNotMatch(html, /Completed/);
});

test('Known backend run states retain their intended client states', async () => {
  for (const [status, expected] of [
    ['QUEUED', 'in_progress'], ['ANALYZING', 'in_progress'], ['VERIFYING', 'in_progress'],
    ['AWAITING_APPROVAL', 'awaiting_approval'], ['PATCH_READY', 'awaiting_approval'],
    ['APPROVED', 'approved'], ['REJECTED', 'rejected'], ['FAILED', 'failed'], ['COMPLETED', 'completed'],
  ]) assert.equal((await normalizeThroughApi({ ...run, status })).status, expected);
});

test('Test not_run status and its reason survive the API boundary', async () => {
  const result = await normalizeThroughApi({ ...run, tests: [
    { id: 't', name: 'Submitted code', status: 'not_run', output: '', reason: 'Not authorized' },
    { id: 's', name: 'Skipped test', status: 'skipped', output: 'Not applicable' },
  ] });
  assert.equal(result.tests[0].status, 'not_run');
  assert.equal(result.tests[0].reason, 'Not authorized');
  assert.equal(result.tests[1].status, 'skipped');
});

test('Malformed required run metadata produces a meaningful error', async () => {
  await assert.rejects(normalizeThroughApi({ ...run, id: null }), /invalid run record/);
  await assert.rejects(normalizeThroughApi({ ...run, diagnosis: { invented: 'shape' } }), /invalid run record/);
});

test('Usage and budget views never format missing accounting as zero consumption', () => {
  const html = renderToStaticMarkup(<UsageSummary usage={normalizeUsage(null)} />);
  assert.match(html, /Not reported/);
  assert.doesNotMatch(html, /\$0\.0000/);
  const budget = renderToStaticMarkup(<BudgetIndicator currentTokens={null} maxTokens={15000} />);
  assert.match(budget, /Consumption not reported/);
  assert.doesNotMatch(budget, />0%/);
});

test('Pending HTTP status does not invent backend pipeline activity', () => {
  const steps = pendingRequestSteps();
  assert.deepEqual(steps.map(step => step.status), ['active', 'pending']);
  const html = renderToStaticMarkup(<RunTimeline steps={steps}
    title="Request status" context="Transport only" isProcessing />);
  assert.match(html, /Transport only/);
  assert.match(html, /not yet confirmed/);
  assert.doesNotMatch(html, /Server Orchestration|Extracting mismatch|Querying Tavily/);
});
