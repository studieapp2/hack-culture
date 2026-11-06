import React, { useRef, useState } from 'react';
import { PageHeader } from '../components/shared/PageHeader';
import {
  BenchmarkMethod, BenchmarkReport, readBenchmarkReport, summarizeBenchmarkReport,
} from '../services/benchmarkReport';

const format = (value: number | null) => value === null ? 'Not reported' : value.toLocaleString('en-US');
const cost = (value: number | null) => value === null ? 'Not reported' : `$${value.toLocaleString('en-US', { maximumSignificantDigits: 8 })} USD`;
const status = { passed: 'Passed', failed: 'Failed', not_run: 'Not run' };

function MethodMeasurements({ method }: { method: BenchmarkMethod }) {
  return (
    <div className="space-y-1">
      <p className="font-semibold">{status[method.result.status]}</p>
      <p>Tests: {method.result.passed} passed / {method.result.failed} failed / {method.result.notRun} not run</p>
      <p>Model: {method.model ?? 'Not reported'}</p>
      <p>Budget: {format(method.budget.maxTokens)} tokens / {format(method.budget.maxCalls)} calls</p>
      <p>Tokens: {format(method.usage.totalTokens)} (input {format(method.usage.inputTokens)}, output {format(method.usage.outputTokens)})</p>
      <p>Calls: {format(method.usage.modelCalls)}</p>
      <p>Cost: {cost(method.usage.costUsd)}{method.usage.costBasis ? ` (${method.usage.costBasis})` : ''}</p>
      <p>Execution scope: {method.result.executionScope ?? 'Not reported'}</p>
    </div>
  );
}

/** Presentational report view is also the SSR boundary; no context or network access. */
export function BenchmarkReportView({ report }: { report: BenchmarkReport }) {
  const summary = summarizeBenchmarkReport(report);
  const savings = (value: typeof summary.tokens, money = false) => value === null
    ? 'Unavailable'
    : `${money ? cost(value.saved) : format(value.saved)}${value.percent === null ? ' (percentage unavailable)' : ` (${value.percent.toFixed(1)}%)`}`;
  return (
    <section aria-label="Imported benchmark measurements" className="space-y-4">
      <p className="text-sm text-[#66736F]">Imported measurements — not independently reverified. Results and execution scope are assertions from the report, not live measurements.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {(['baseline', 'patchpilot'] as const).map(method => (
          <div key={method} className="p-4 bg-white border border-[#E3EAE6] rounded-xl">
            <h2 className="font-semibold">{method === 'baseline' ? 'Baseline' : 'PatchPilot'}</h2>
            <p className="text-sm">{summary[method].passed} passed · {summary[method].failed} failed · {summary[method].notRun} not run cases</p>
          </div>
        ))}
      </div>
      <div className="p-4 bg-white border border-[#E3EAE6] rounded-xl text-sm space-y-2">
        <p>{summary.comparableCases} of {report.cases.length} cases have matched successful execution, models and budgets.</p>
        <p>Whole-report token savings: {savings(summary.tokens)}</p>
        <p>Whole-report cost savings: {savings(summary.cost, true)}{summary.cost ? ` (${report.cases[0].baseline.usage.costBasis} cost)` : ''}</p>
        <p className="text-[#66736F]">Positive differences mean lower PatchPilot usage; negative differences mean higher usage. Whole-report savings require every case to be comparable with complete measurements and a single model/budget configuration. Costs also require the same basis. Unknowns are never counted as zero.</p>
      </div>
      <div className="overflow-x-auto bg-white border border-[#E3EAE6] rounded-xl">
        <table className="w-full min-w-[880px] text-left text-xs">
          <caption className="text-left p-4 text-sm font-semibold">Reported baseline vs PatchPilot, including failed and not-run cases</caption>
          <thead className="bg-[#F8FAF9] text-[#66736F]">
            <tr>{['Case', 'Baseline', 'PatchPilot', 'Comparison'].map(label => <th key={label} scope="col" className="p-4">{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#E3EAE6]">
            {summary.cases.map(({ entry, reasons, tokens, cost: costDifference }) => (
              <tr key={entry.id} className="align-top">
                <th scope="row" className="p-4 font-medium break-words max-w-64">{entry.label}<span className="block text-[#66736F]">{entry.id}</span></th>
                <td className="p-4 break-words max-w-80"><MethodMeasurements method={entry.baseline} /></td>
                <td className="p-4 break-words max-w-80"><MethodMeasurements method={entry.patchpilot} /></td>
                <td className="p-4 max-w-72">
                  {reasons.length > 0 ? <p>Savings unavailable: {reasons.join(' ')}</p> : <>
                    <p>Token savings: {savings(tokens)}</p>
                    <p>Cost savings: {savings(costDifference, true)}</p>
                    {tokens === null && <p>Total token measurements missing.</p>}
                    {costDifference === null && <p>Cost measurements missing or cost bases differ.</p>}
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Benchmarks() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const attempt = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  async function importFile(file: File) {
    const current = ++attempt.current;
    setReport(null);
    setError(null);
    setLoading(true);
    try {
      const parsed = await readBenchmarkReport(file);
      if (current === attempt.current) setReport(parsed);
    } catch (cause) {
      if (current === attempt.current)
        setError(cause instanceof Error ? cause.message : 'Could not read the local report. Try selecting the file again.');
    } finally {
      if (current === attempt.current) setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto text-[#17201D]">
      <PageHeader title="Benchmarks" breadcrumb="Report comparison" subtitle="Compare locally imported baseline and PatchPilot results. This page does not run benchmarks or contact providers." />
      <section className="p-5 bg-white border border-[#E3EAE6] rounded-xl space-y-3" aria-label="Import report">
        <label htmlFor="benchmark-report" className="block text-sm font-semibold">Import a local JSON report</label>
        <input ref={input} id="benchmark-report" type="file" accept=".json,application/json"
          aria-describedby="benchmark-import-help" className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[#E3EAE6] file:bg-[#F8FAF9] file:px-3 file:py-2 focus-visible:outline-2 focus-visible:outline-[#08775E]"
          onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ''; }} />
        <p id="benchmark-import-help" className="text-xs text-[#66736F]">Maximum 1 MiB (1,048,576 bytes). Read locally in this page only; no automatic uploads, code execution or provider calls.</p>
        {(report || loading || error) && <button type="button" className="text-sm underline"
          onClick={() => { attempt.current++; setReport(null); setError(null); setLoading(false); if (input.current) input.current.value = ''; }}>Clear report</button>}
        <details className="text-xs text-[#66736F] space-y-2">
          <summary className="cursor-pointer font-semibold">Required JSON schema (version 1)</summary>
          <p className="mt-2">Strict objects: no extra keys. Root: version (1), cases (1–1000 unique cases). Each case: id, label, baseline, patchpilot. Both methods require all fields below. Strings are nonempty, at most 200 characters. Unknown model, budget or usage values must be null, not omitted.</p>
          <pre className="overflow-x-auto bg-[#F8FAF9] p-3 rounded-lg">{`method = {
  model: string | null,
  budget: { maxTokens: positiveInteger | null, maxCalls: positiveInteger | null },
  result: {
    status: "passed" | "failed" | "not_run",
    executionScope: string | null,
    passed: nonnegativeInteger, failed: nonnegativeInteger, notRun: nonnegativeInteger
  },
  usage: {
    inputTokens: nonnegativeInteger | null, outputTokens: nonnegativeInteger | null,
    totalTokens: nonnegativeInteger | null, modelCalls: nonnegativeInteger | null,
    costUsd: nonnegativeNumber | null, costBasis: "actual" | "estimated" | null
  }
}`}</pre>
          <p>Execution scope identifies the same input, test suite and environment, not a run ID. Counts must total at least one test. Passed means no failures or omitted tests; failed requires a failed test. Not-run means no execution: zero passed/failed, null execution scope and all usage fields null. Executed methods require an execution scope. Known token totals must agree with components; usage cannot exceed the declared total budgets. Cost and basis must both be present or both null. Actual and estimated costs are not interchangeable.</p>
        </details>
      </section>
      {error && <p role="alert" className="p-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">{error}</p>}
      {loading && <p role="status" className="text-sm">Reading local report…</p>}
      {!report && !loading && <section className="p-8 text-center bg-white border border-[#E3EAE6] rounded-xl">
        <h2 className="font-semibold">No report imported</h2>
        <p className="mt-2 text-sm text-[#66736F]">Import your measured report to compare results. No benchmark measurements are available until then.</p>
      </section>}
      {report && <BenchmarkReportView report={report} />}
    </div>
  );
}
