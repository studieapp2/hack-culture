import { createHash } from 'node:crypto';
import { benchmarkReportSchema, benchmarkMethodSchema, BenchmarkMethod, BenchmarkReport } from '../../src/services/benchmarkReport';
import { sdkCases, sdkVersion, compilerVersion, sdkDeclarationHash, STATIC_CRITERION,
  requestSnippet, staticTypecheck, assessProposal } from './staticSdk';

export interface BenchmarkOptions {
  live: boolean;
  budgetUsd: number;
  model: string | null;
  maxTokens: number;
  maxCalls: number;
}
export const defaultOptions: BenchmarkOptions = {
  live: false, budgetUsd: 0, model: null, maxTokens: 15000, maxCalls: 4,
};

export function parseArguments(args: string[]): BenchmarkOptions {
  const result = { ...defaultOptions };
  const used = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (used.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    used.add(flag);
    if (flag === '--live') { result.live = true; continue; }
    if (flag === '--plan') continue;
    if (!['--budget-usd', '--model', '--max-tokens', '--max-calls'].includes(flag))
      throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--model') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value) ||
          /^(?:https?:|sk-|tvly-|AIza|Bearer)/i.test(value))
        throw new Error('Model must be a short provider/model identifier, not a credential or URL.');
      result.model = value;
    } else {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error(`Invalid number for ${flag}`);
      if (flag === '--budget-usd') result.budgetUsd = numeric;
      if (flag === '--max-tokens') result.maxTokens = numeric;
      if (flag === '--max-calls') result.maxCalls = numeric;
    }
  }
  if (used.has('--plan') && result.live) throw new Error('Choose --plan or --live, not both.');
  validateOptions(result);
  return result;
}

function validateOptions(options: BenchmarkOptions) {
  if (!Number.isFinite(options.budgetUsd) || options.budgetUsd < 0 || options.budgetUsd > 1.93)
    throw new Error('Budget must be between $0 and the remaining live ceiling of $1.93.');
  if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1000 || options.maxTokens > 15000 ||
      !Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 4)
    throw new Error('Use 1000–15000 total tokens and 1–4 model calls per method.');
}

function configuredRate(raw: string | undefined) {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Local configuration is not proof of a gateway route or provider charge ceiling.
 * These checks deliberately do NOT call health/models/search endpoints.
 * No amount of claimed env pricing authorizes dispatch in this implementation.
 */
export function liveBlockers(options: BenchmarkOptions, env: NodeJS.ProcessEnv): string[] {
  validateOptions(options);
  if (!options.live) return [];
  const blockers: string[] = [];
  if (options.budgetUsd <= 0) blockers.push('Explicit positive --budget-usd is required (maximum $1.93).');
  if (!options.model || options.model !== env.BIFROST_MODEL?.trim())
    blockers.push('Explicit model must match the configured BIFROST_MODEL.');
  try {
    const url = new URL(env.BIFROST_BASE_URL ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('unsafe');
  } catch { blockers.push('A credential-free HTTPS BIFROST_BASE_URL is required.'); }
  if (!env.BIFROST_API_KEY?.trim() || !env.TAVILY_API_KEY?.trim())
    blockers.push('Provider authentication must be configured through environment variables.');
  if (env.BIFROST_FALLBACK_MODEL?.trim())
    blockers.push('Configured fallback routes are not permitted for this comparison.');
  if (['BIFROST_INPUT_USD_PER_MILLION', 'BIFROST_OUTPUT_USD_PER_MILLION', 'TAVILY_USD_PER_CREDIT']
    .some(name => configuredRate(env[name]) === null))
    blockers.push('Explicit model and Tavily rates are missing or invalid; generic estimates are prohibited.');
  blockers.push('Live dispatch unavailable: existing service interfaces do not expose locally verifiable exact gateway routing, hidden retry/input overhead bounds, or verified maximum Tavily search/extraction charges. Env assertions and health checks cannot establish those bounds. No paid requests are authorized by this CLI.');
  return blockers;
}

/** Reusable monotone reservation: failed/unknown requests never refund capacity. */
export class SpendReservation {
  private reserved = 0;
  constructor(private readonly ceilingUsd: number) {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0 || ceilingUsd > 1.93)
      throw new Error('Invalid spending ceiling.');
  }
  reserve(worstCaseUsd: number): void {
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd < 0 || this.reserved + worstCaseUsd > this.ceilingUsd)
      throw new Error('Refused: verified worst-case reservation exceeds the remaining budget.');
    // Round upward, never down; no release for failed or incomplete responses.
    const next = Math.ceil((this.reserved + worstCaseUsd) * 1e9) / 1e9;
    if (next > this.ceilingUsd) throw new Error('Refused: reservation exceeds budget after conservative rounding.');
    this.reserved = next;
  }
  get reservedUsd() { return this.reserved; }
}

export interface CasePlan {
  id: string;
  code: string;
  diagnostics: string;
  executionScope: string;
}

function unrun(options: BenchmarkOptions): BenchmarkMethod {
  return {
    model: options.model,
    budget: { maxTokens: options.maxTokens, maxCalls: options.maxCalls },
    result: { status: 'not_run', executionScope: null, passed: 0, failed: 0, notRun: 1 },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, modelCalls: null, costUsd: null, costBasis: null },
  };
}

export function buildPlan(options: BenchmarkOptions = defaultOptions) {
  validateOptions(options);
  const cases: CasePlan[] = sdkCases.map(entry => {
    const checked = staticTypecheck(entry.input);
    if (checked.passed) throw new Error(`Installed SDK no longer diagnoses controlled case ${entry.id}; plan aborted.`);
    const code = requestSnippet(entry.input);
    const executionScope = createHash('sha256')
      .update(JSON.stringify({ code, sdkDeclarationHash, compilerVersion, criterion: STATIC_CRITERION })).digest('hex');
    return { id: entry.id, code, diagnostics: checked.diagnostics, executionScope };
  });
  const report: BenchmarkReport = benchmarkReportSchema.parse({
    version: 1,
    cases: sdkCases.map(entry => ({
      id: entry.id, label: `${entry.title} · static SDK typecheck only`,
      baseline: unrun(options), patchpilot: unrun(options),
    })),
  });
  return { report, cases, criterion: STATIC_CRITERION, sdkVersion, compilerVersion, sdkDeclarationHash };
}

export interface MethodTrial {
  assessment: { passed: boolean; diagnostics?: string };
  usage?: unknown;
}
export interface TrustedMethod {
  /** Caller-verified maximum for ALL model/search/extraction attempts, including failures. */
  verifiedWorstCaseUsd: number;
  run: (entry: Readonly<CasePlan>, options: Readonly<BenchmarkOptions>,
    reservation: Readonly<{ reservedUsd: number }>) => Promise<MethodTrial>;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const reportedCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const reportedMoney = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Legacy measured model usage or diagnosis v1 usage; no inferred tokens or invoices. */
export function convertReportedUsage(value: unknown) {
  const raw = object(value);
  const wrapped = typeof raw.model === 'object' || 'incompleteModelUsage' in raw;
  const model = wrapped ? object(raw.model) : raw;
  const complete = model.isMeasured === true && raw.incompleteModelUsage !== true;
  let inputTokens = complete ? reportedCount(model.inputTokens) : null;
  let outputTokens = complete ? reportedCount(model.outputTokens) : null;
  let totalTokens = complete ? reportedCount(model.totalTokens) : null;
  if ((inputTokens !== null && outputTokens !== null &&
       (!Number.isSafeInteger(inputTokens + outputTokens) ||
        (totalTokens !== null && totalTokens !== inputTokens + outputTokens))) ||
      (totalTokens !== null && ((inputTokens !== null && inputTokens > totalTokens) ||
        (outputTokens !== null && outputTokens > totalTokens))))
    inputTokens = outputTokens = totalTokens = null;
  const actual = reportedMoney(raw.actualCostUsd);
  const estimated = wrapped ? reportedMoney(raw.estimatedCostUsd) : reportedMoney(raw.estimatedCost);
  const pricedEstimate = complete && inputTokens !== null && outputTokens !== null && totalTokens !== null &&
    raw.costBasis === 'configured_rates' &&
    (wrapped || raw.currency === 'USD') && model.fallbackUsed !== true;
  const costUsd = actual ?? (pricedEstimate ? estimated : null);
  const costBasis = actual !== null ? 'actual' as const : costUsd !== null ? 'estimated' as const : null;
  const name = model.model;
  const safeModel = typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(name) &&
    !/^(?:https?:|sk-|tvly-|AIza|Bearer)/i.test(name) &&
    ![process.env.BIFROST_API_KEY, process.env.TAVILY_API_KEY].some(secret => secret && name.includes(secret))
    ? name : null;
  return { model: safeModel, usage: {
    inputTokens, outputTokens, totalTokens, modelCalls: reportedCount(raw.modelCalls),
    costUsd, costBasis,
  } };
}

/**
 * Reusable orchestration, NOT production verification or a live CLI capability.
 * Explicit trusted callbacks must enforce the exact options and attest all-provider
 * worst-case costs. No default callbacks, mocks, service loading or fallbacks.
 * Diagnostics are fixed classifications; raw errors/proposals never enter reports.
 */
export async function executeBenchmarkPlan(
  plan: { report: BenchmarkReport; cases: CasePlan[] },
  options: BenchmarkOptions,
  methods: { baseline: TrustedMethod; patchpilot: TrustedMethod },
) {
  validateOptions(options);
  const report = benchmarkReportSchema.parse(plan.report);
  if (plan.cases.length !== report.cases.length || plan.cases.some((entry, index) => {
    const controlled = sdkCases.find(candidate => candidate.id === entry.id);
    if (!controlled || entry.id !== report.cases[index].id) return true;
    const code = requestSnippet(controlled.input);
    const scope = createHash('sha256')
      .update(JSON.stringify({ code, sdkDeclarationHash, compilerVersion, criterion: STATIC_CRITERION })).digest('hex');
    return entry.code !== code || entry.executionScope !== scope ||
      entry.diagnostics !== staticTypecheck(controlled.input).diagnostics;
  }))
    throw new Error('Invalid controlled case plan.');
  for (const method of [methods?.baseline, methods?.patchpilot]) {
    if (!method || typeof method.run !== 'function' || !Number.isFinite(method.verifiedWorstCaseUsd) ||
        method.verifiedWorstCaseUsd < 0) throw new Error('Explicit trusted callbacks and verified worst-case costs are required.');
  }
  const ledger = new SpendReservation(options.budgetUsd);
  const sharedOptions = Object.freeze({ ...options });
  const diagnostics: { caseId: string; method: 'baseline' | 'patchpilot'; message: string }[] = [];
  let stopped = !options.live || options.budgetUsd === 0;
  // Reset results rather than reusing any imported or stale method measurements.
  report.cases.forEach(entry => {
    entry.label = `${sdkCases.find(controlled => controlled.id === entry.id)!.title} · static SDK typecheck only`;
    entry.baseline = unrun(options);
    entry.patchpilot = unrun(options);
  });
  for (let index = 0; index < plan.cases.length; index++) {
    const entry = Object.freeze({ ...plan.cases[index] });
    for (const method of ['baseline', 'patchpilot'] as const) {
      if (stopped) continue;
      try { ledger.reserve(methods[method].verifiedWorstCaseUsd); }
      catch {
        stopped = true;
        diagnostics.push({ caseId: entry.id, method, message: 'Budget exhausted before dispatch; remaining trials not run.' });
        continue;
      }
      let trial: MethodTrial;
      try { trial = await methods[method].run(entry, sharedOptions, Object.freeze({ reservedUsd: ledger.reservedUsd })); }
      catch (error) {
        // Trusted callbacks may attach only reported accounting to failed attempts.
        trial = { assessment: { passed: false }, usage: object(error).usage };
      }
      const converted = convertReportedUsage(trial?.usage);
      const passed = trial?.assessment?.passed === true;
      const result: BenchmarkMethod = {
        model: converted.model, budget: { maxTokens: options.maxTokens, maxCalls: options.maxCalls },
        result: { status: passed ? 'passed' : 'failed', executionScope: entry.executionScope,
          passed: passed ? 1 : 0, failed: passed ? 0 : 1, notRun: 0 },
        usage: converted.usage,
      };
      const exceeded = (result.usage.totalTokens !== null && result.usage.totalTokens > options.maxTokens) ||
        (result.usage.modelCalls !== null && result.usage.modelCalls > options.maxCalls) ||
        (result.usage.costUsd !== null && result.usage.costUsd > methods[method].verifiedWorstCaseUsd);
      if (exceeded) {
        stopped = true;
        result.result = { ...result.result, status: 'failed', passed: 0, failed: 1 };
        // Schema cannot encode over-budget counts: retain outcome/cost, withhold
        // invalid bounded counts and explicitly flag the accounting violation.
        if (result.usage.totalTokens !== null && result.usage.totalTokens > options.maxTokens)
          result.usage.inputTokens = result.usage.outputTokens = result.usage.totalTokens = null;
        if (result.usage.modelCalls !== null && result.usage.modelCalls > options.maxCalls) result.usage.modelCalls = null;
      }
      report.cases[index][method] = benchmarkMethodSchema.parse(result);
      diagnostics.push({ caseId: entry.id, method, message: exceeded
        ? 'Reported accounting exceeded verified bounds; remaining trials stopped.'
        : passed ? 'Static SDK assessment passed; not runtime correctness.'
          : 'Trial or static SDK assessment failed; raw diagnostic omitted.' });
    }
  }
  return { report: benchmarkReportSchema.parse(report), reservedUsd: ledger.reservedUsd, diagnostics };
}

/**
 * Existing recommendation interfaces, not a new model client. Imports are lazy
 * so the default plan never loads dotenv/server config or touches providers.
 * A production dispatcher is intentionally NOT exported: the CLI has no verified
 * route/pricing capability with which it could safely authorize these adapters.
 * Tests may inspect this factory with labelled local doubles, never paid calls.
 */
export async function existingMethodAdapters(options: BenchmarkOptions, env: NodeJS.ProcessEnv) {
  // Factory access must not bypass CLI authorization. This always refuses under
  // current interfaces, including apparently complete or test-claimed env config.
  if (!options.live || liveBlockers(options, env).length)
    throw new Error('Live adapter access refused: verified routing and spending bounds are unavailable.');
  const [{ bifrostService }, { diagnoseApiError }, { createRunBudget }] = await Promise.all([
    import('../../src/server/services/bifrostService'),
    import('../../src/server/services/diagnoseApiError'),
    import('../../src/server/services/runBudget'),
  ]);
  return {
    baseline: async (entry: CasePlan) => {
      const budget = createRunBudget();
      budget.requireReportedUsage = true; // No unpriced fallback.
      const capturedUsage = () => ({
        model: budget.usageReports > 0 ? budget.usage : null,
        modelCalls: budget.callCount, incompleteModelUsage: budget.callCount !== budget.usageReports,
        actualCostUsd: null,
        estimatedCostUsd: budget.callCount === budget.usageReports && budget.usage.isMeasured &&
          budget.usage.costBasis === 'configured_rates' ? budget.usage.estimatedCost : null,
        costBasis: budget.usage.costBasis,
      });
      try {
        const result = await bifrostService.generateCompletion([
          { role: 'system', content: 'Fix the supplied SDK type error. Return JSON {"proposed_code":"full snippet"}. Preserve exactly the type-only import and request declaration; initializer must be JSON. Do not execute code or use tools.' },
          { role: 'user', content: `ERROR:\n${entry.diagnostics}\nLANGUAGE: typescript\nCODE (benchmark.ts):\n${entry.code}` },
        ], { model: options.model ?? undefined, maxTokens: 600, responseFormat: 'json_object', runBudget: budget });
        const proposal = result.rawJson?.proposed_code;
        return { assessment: typeof proposal === 'string' ? assessProposal(proposal)
          : { passed: false, diagnostics: 'No admissible proposal.' }, usage: capturedUsage() };
      } catch {
        return { assessment: { passed: false, diagnostics: 'Baseline attempt failed; raw diagnostic omitted.' },
          usage: capturedUsage() };
      }
    },
    patchpilot: async (entry: CasePlan) => {
      const result = await diagnoseApiError({
        error: entry.diagnostics, code: entry.code, language: 'typescript', fileName: 'benchmark.ts',
      });
      const proposal = result.proposedPatch?.proposedCode;
      return { assessment: typeof proposal === 'string' ? assessProposal(proposal)
        : { passed: false, diagnostics: 'No admissible evidence-supported proposal.' }, usage: result.usage };
    },
  };
}
