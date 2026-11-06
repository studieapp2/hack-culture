import { z } from 'zod';

export const MAX_BENCHMARK_REPORT_BYTES = 1024 * 1024;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(200);
const budgetSchema = z.strictObject({
  maxTokens: count.positive().nullable(),
  maxCalls: count.positive().nullable(),
});

/**
 * Local JSON format v1. All keys are required; unknown measurements use null.
 * executionScope identifies the same input, test suite and environment, not a
 * unique run ID. Result counts describe that suite. not_run means the method
 * did not execute; passed requires at least one passing test and no omissions.
 * Usage is complete reported accounting, not inferred from model/budget.
 * costBasis distinguishes invoiced ("actual") from rate-based ("estimated") USD.
 * No content in a report is executed, fetched, uploaded or independently verified.
 */
export const benchmarkMethodSchema = z.strictObject({
  model: text.nullable(),
  budget: budgetSchema,
  result: z.strictObject({
    status: z.enum(['passed', 'failed', 'not_run']),
    executionScope: text.nullable(),
    passed: count,
    failed: count,
    notRun: count,
  }),
  usage: z.strictObject({
    inputTokens: count.nullable(),
    outputTokens: count.nullable(),
    totalTokens: count.nullable(),
    modelCalls: count.nullable(),
    costUsd: z.number().finite().nonnegative().nullable(),
    costBasis: z.enum(['actual', 'estimated']).nullable(),
  }),
}).superRefine((method, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });
  const { result, usage, budget } = method;
  const totalTests = result.passed + result.failed + result.notRun;
  if (!Number.isSafeInteger(totalTests) || totalTests === 0)
    issue(['result'], 'Test counts must have a positive safe-integer total.');
  if (result.status === 'passed' && (result.passed === 0 || result.failed !== 0 || result.notRun !== 0))
    issue(['result'], 'Passed requires passing tests, no failures and no not-run tests.');
  if (result.status === 'failed' && result.failed === 0)
    issue(['result', 'failed'], 'Failed requires at least one failed test.');
  if (result.status === 'not_run' && (result.passed !== 0 || result.failed !== 0 || result.executionScope !== null))
    issue(['result'], 'Not-run requires no executed tests and a null executionScope.');
  if (result.status !== 'not_run' && result.executionScope === null)
    issue(['result', 'executionScope'], 'Executed methods require an executionScope.');
  if (result.status === 'not_run' && Object.values(usage).some(value => value !== null))
    issue(['usage'], 'Not-run methods must have null usage and cost basis.');
  if ((usage.costUsd === null) !== (usage.costBasis === null))
    issue(['usage', 'costBasis'], 'Cost and costBasis must both be reported or both be null.');
  if (usage.inputTokens !== null && usage.outputTokens !== null &&
      !Number.isSafeInteger(usage.inputTokens + usage.outputTokens))
    issue(['usage'], 'Combined token counts must remain a safe integer.');
  if (usage.inputTokens !== null && usage.outputTokens !== null && usage.totalTokens !== null &&
      usage.inputTokens + usage.outputTokens !== usage.totalTokens)
    issue(['usage', 'totalTokens'], 'Total tokens must equal input plus output tokens.');
  for (const field of ['inputTokens', 'outputTokens'] as const) {
    if (usage[field] !== null && usage.totalTokens !== null && usage[field] > usage.totalTokens)
      issue(['usage', field], 'Component tokens cannot exceed total tokens.');
  }
  if (usage.totalTokens !== null && budget.maxTokens !== null && usage.totalTokens > budget.maxTokens)
    issue(['usage', 'totalTokens'], 'Reported tokens exceed the declared total token budget.');
  if (usage.modelCalls !== null && budget.maxCalls !== null && usage.modelCalls > budget.maxCalls)
    issue(['usage', 'modelCalls'], 'Reported calls exceed the declared call budget.');
});

export const benchmarkReportSchema = z.strictObject({
  version: z.literal(1),
  cases: z.array(z.strictObject({
    id: text,
    label: text,
    baseline: benchmarkMethodSchema,
    patchpilot: benchmarkMethodSchema,
  })).min(1).max(1000),
}).superRefine((report, ctx) => {
  const ids = new Set<string>();
  report.cases.forEach((entry, index) => {
    if (ids.has(entry.id))
      ctx.addIssue({ code: 'custom', path: ['cases', index, 'id'], message: 'Case IDs must be unique.' });
    ids.add(entry.id);
  });
});

export type BenchmarkReport = z.infer<typeof benchmarkReportSchema>;
export type BenchmarkMethod = z.infer<typeof benchmarkMethodSchema>;
export type BenchmarkCase = BenchmarkReport['cases'][number];

export function parseBenchmarkReport(source: string): BenchmarkReport {
  if (new TextEncoder().encode(source).byteLength > MAX_BENCHMARK_REPORT_BYTES)
    throw new Error('Report exceeds the 1 MiB (1,048,576 bytes) limit.');
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error('Invalid JSON. Choose a JSON report using the documented v1 format.'); }
  const parsed = benchmarkReportSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 4)
      .map(issue => `${issue.path.join('.') || 'report'}: ${issue.message}`).join(' ');
    throw new Error(`Invalid benchmark report. ${details}`);
  }
  return parsed.data;
}

export async function readBenchmarkReport(file: Pick<File, 'size' | 'text'>): Promise<BenchmarkReport> {
  if (file.size > MAX_BENCHMARK_REPORT_BYTES)
    throw new Error('Report exceeds the 1 MiB (1,048,576 bytes) limit.');
  return parseBenchmarkReport(await file.text());
}

function comparisonReasons(entry: BenchmarkCase): string[] {
  const a = entry.baseline;
  const b = entry.patchpilot;
  const reasons: string[] = [];
  if (a.result.status !== 'passed' || b.result.status !== 'passed')
    reasons.push('Both methods must pass the complete test suite.');
  if (a.model === null || b.model === null || a.model !== b.model)
    reasons.push('Models are missing or different.');
  if (a.budget.maxTokens === null || a.budget.maxCalls === null ||
      b.budget.maxTokens === null || b.budget.maxCalls === null ||
      a.budget.maxTokens !== b.budget.maxTokens || a.budget.maxCalls !== b.budget.maxCalls)
    reasons.push('Budgets are missing or different.');
  if (a.result.executionScope === null || a.result.executionScope !== b.result.executionScope ||
      a.result.passed !== b.result.passed)
    reasons.push('Execution scope or test counts do not match.');
  return reasons;
}

function difference(baseline: number | null, patchpilot: number | null) {
  if (baseline === null || patchpilot === null) return null;
  const saved = baseline - patchpilot;
  if (!Number.isFinite(saved)) return null;
  const percent = baseline > 0 ? saved / baseline * 100 : null;
  return { baseline, patchpilot, saved, percent: percent !== null && Number.isFinite(percent) ? percent : null };
}

export function summarizeBenchmarkReport(report: BenchmarkReport) {
  const cases = report.cases.map(entry => {
    const reasons = comparisonReasons(entry);
    const comparable = reasons.length === 0;
    const tokens = comparable ? difference(entry.baseline.usage.totalTokens, entry.patchpilot.usage.totalTokens) : null;
    const sameCostBasis = entry.baseline.usage.costBasis !== null &&
      entry.baseline.usage.costBasis === entry.patchpilot.usage.costBasis;
    const cost = comparable && sameCostBasis ? difference(entry.baseline.usage.costUsd, entry.patchpilot.usage.costUsd) : null;
    return { entry, reasons, comparable, tokens, cost };
  });
  const countStatuses = (method: 'baseline' | 'patchpilot') => ({
    passed: report.cases.filter(entry => entry[method].result.status === 'passed').length,
    failed: report.cases.filter(entry => entry[method].result.status === 'failed').length,
    notRun: report.cases.filter(entry => entry[method].result.status === 'not_run').length,
  });
  const first = report.cases[0].baseline;
  const homogeneous = report.cases.every(entry =>
    entry.baseline.model === first.model &&
    entry.baseline.budget.maxTokens === first.budget.maxTokens &&
    entry.baseline.budget.maxCalls === first.budget.maxCalls);
  const aggregate = (metric: 'tokens' | 'cost') => {
    if (!homogeneous || cases.some(entry => entry[metric] === null)) return null;
    if (metric === 'cost' && report.cases.some(entry => entry.baseline.usage.costBasis !== first.usage.costBasis)) return null;
    const baseline = cases.reduce((sum, entry) => sum + entry[metric]!.baseline, 0);
    const patchpilot = cases.reduce((sum, entry) => sum + entry[metric]!.patchpilot, 0);
    if (!Number.isFinite(baseline) || !Number.isFinite(patchpilot) ||
        (metric === 'tokens' && (!Number.isSafeInteger(baseline) || !Number.isSafeInteger(patchpilot)))) return null;
    return difference(baseline, patchpilot);
  };
  return {
    cases, baseline: countStatuses('baseline'), patchpilot: countStatuses('patchpilot'),
    comparableCases: cases.filter(entry => entry.comparable).length,
    tokens: aggregate('tokens'), cost: aggregate('cost'),
  };
}
