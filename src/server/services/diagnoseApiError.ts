import type {
  DiagnoseApiErrorError, DiagnoseApiErrorInput, DiagnoseApiErrorResult
} from '../diagnoseApiError.contract';
import { serverConfig } from '../config';
import { bifrostService } from './bifrostService';
import { tavilyService } from './tavilyService';
import { fixCodeService } from './fixCodeService';
import { createRunBudget, RunBudget } from './runBudget';
import { ProviderError } from './providerError';
import { containsCredentials, redactProviderSecrets } from './sensitiveData';

const tests: DiagnoseApiErrorResult['tests'] = [{
  id: 'not-executed', name: 'Submitted-code execution', status: 'not_run',
  output: 'Submitted-code execution is disabled; no code test was performed.',
  reason: 'No submitted code was executed or modified. Applying a proposal requires explicit approval.'
}];

function usage(budget: RunBudget): DiagnoseApiErrorResult['usage'] {
  const noRequests = budget.callCount + budget.searchRequests + budget.extractionRequests === 0;
  const completeModel = budget.callCount === budget.usageReports &&
    (budget.callCount === 0 || budget.usage.isMeasured);
  const completeSearch = budget.searchRequests === budget.searchUsageReports;
  const completeExtract = budget.extractionRequests === budget.extractionUsageReports;
  const modelPricing = budget.callCount === 0 || budget.usage.costBasis === 'configured_rates';
  const webPricing = budget.searchRequests + budget.extractionRequests === 0 || serverConfig.tavilyUsdPerCredit !== undefined;
  const priced = completeModel && completeSearch && completeExtract && modelPricing && webPricing;
  return {
    model: budget.usageReports > 0 ? {
      ...budget.usage, model: redactProviderSecrets(budget.usage.model),
      provider: budget.usage.provider ? redactProviderSecrets(budget.usage.provider) : undefined,
      requestedModel: budget.usage.requestedModel ? redactProviderSecrets(budget.usage.requestedModel) : undefined,
      fallbackModel: budget.usage.fallbackModel ? redactProviderSecrets(budget.usage.fallbackModel) : undefined
    } : null,
    modelCalls: budget.callCount,
    searchCalls: budget.searchRequests,
    extractionCalls: budget.extractionRequests,
    searchCredits: completeSearch ? budget.searchCredits : null,
    extractionCredits: completeExtract ? budget.extractionCredits : null,
    actualCostUsd: noRequests ? 0 : null,
    estimatedCostUsd: noRequests ? 0 : priced
      ? budget.usage.estimatedCost + (budget.searchCredits + budget.extractionCredits) * (serverConfig.tavilyUsdPerCredit || 0)
      : null,
    costBasis: noRequests ? 'no_requests' : priced ? 'configured_rates' : 'not_reported',
    incompleteModelUsage: !completeModel
  };
}

function empty(budget: RunBudget, errors: DiagnoseApiErrorError[]): DiagnoseApiErrorResult {
  return {
    contractVersion: '1', status: 'error', diagnosis: null,
    claims: [], sources: [], tests: tests.map((test) => ({ ...test })),
    usage: usage(budget), errors,
    safety: { codeExecuted: false, codeModified: false, approvalRequiredToApply: true }
  };
}

function validate(input: DiagnoseApiErrorInput): string | undefined {
  if (input && typeof input === 'object') {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return 'Input must contain plain JSON values.';
    for (const name of Object.getOwnPropertyNames(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (!['error', 'code', 'fileName', 'language'].includes(name) || descriptor?.get || descriptor?.set) {
        return 'Input must contain only the documented plain JSON fields.';
      }
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    typeof input.error !== 'string' || !input.error.trim() || input.error.length > 20000 ||
    typeof input.code !== 'string' || !input.code.trim() || input.code.length > 100000) {
    return 'error and code must be non-empty strings (maximum 20,000 and 100,000 characters respectively).';
  }
  if (input.fileName !== undefined &&
    (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 300 ||
      /[\x00-\x1f]/.test(input.fileName) || /^(?:[/\\]|[A-Za-z]:)/.test(input.fileName) ||
      input.fileName.split(/[/\\]/).includes('..'))) {
    return 'fileName must be a project-relative path without traversal or control characters.';
  }
  if (input.language !== undefined &&
    (typeof input.language !== 'string' || !input.language.trim() || input.language.length > 100)) {
    return 'language must be a non-empty string of at most 100 characters.';
  }
  if (containsCredentials(input.error) || containsCredentials(input.code)) {
    return 'Remove credential literals from the input and use environment references before submitting code.';
  }
  return undefined;
}

/** Strict, typed, recommendation-only entry point. It never throws raw provider errors. */
export async function diagnoseApiError(input: DiagnoseApiErrorInput): Promise<DiagnoseApiErrorResult> {
  const budget = createRunBudget();
  budget.requireReportedUsage = true;
  const invalid = validate(input);
  if (invalid) return empty(budget, [{ code: 'INVALID_INPUT', message: invalid, retryable: false }]);
  const configuration: DiagnoseApiErrorError[] = [];
  if (!bifrostService.isConfigured()) configuration.push({
    code: 'MISSING_CONFIGURATION', provider: 'bifrost', retryable: false,
    configuration: ['BIFROST_BASE_URL', 'BIFROST_MODEL'],
    message: 'Configure a reachable Bifrost gateway and a working model/provider. Set BIFROST_API_KEY if gateway authentication is required.'
  });
  if (!serverConfig.bifrostModel?.trim() || containsCredentials(serverConfig.bifrostModel)) configuration.push({
    code: 'MISSING_CONFIGURATION', provider: 'bifrost', retryable: false,
    configuration: ['BIFROST_MODEL'], message: 'BIFROST_MODEL must identify a configured model, not a credential.'
  });
  if (!tavilyService.isConfigured()) configuration.push({
    code: 'MISSING_CONFIGURATION', provider: 'tavily', retryable: false,
    configuration: ['TAVILY_API_KEY'], message: 'Configure TAVILY_API_KEY for real documentation search and extraction.'
  });
  if (configuration.length) return empty(budget, configuration);
  try {
    const suffix = input.language?.toLowerCase() === 'python' ? 'py'
      : input.language?.toLowerCase() === 'typescript' ? 'ts'
      : input.language?.toLowerCase() === 'javascript' ? 'js' : 'txt';
    const result = await fixCodeService.analyzeAndFix({
      ...input, fileName: input.fileName?.replace(/\\/g, '/') || `snippet.${suffix}`
    }, budget, { requireEvidence: true });
    if (result.patch && containsCredentials(result.patch.proposedCode)) {
      return empty(budget, [{
        code: 'INVALID_PROVIDER_RESPONSE', provider: 'bifrost',
        message: 'The model proposal contained credential literals and was rejected.', retryable: false
      }]);
    }
    const sources = Array.from(new Map(result.claims.flatMap((claim) => claim.sources)
      .filter((source) => !containsCredentials(source.url))
      .map((source) => [source.url, { ...source,
        title: redactProviderSecrets(source.title), excerpt: redactProviderSecrets(source.excerpt) }])).values());
    const extracted = new Set(sources.filter((source) => source.extractionStatus === 'extracted').map((source) => source.url));
    const supported = result.evidenceSupported === true &&
      Boolean(result.supportingSourceUrls?.some((url) => extracted.has(url)));
    return {
      contractVersion: '1', status: supported ? 'supported' : 'insufficient_evidence',
      diagnosis: { summary: redactProviderSecrets(result.diagnosis), evidenceStatus: supported ? 'supported' : 'unverified' },
      claims: result.claims.map((claim) => ({
        ...claim, originalText: redactProviderSecrets(claim.originalText),
        explanation: redactProviderSecrets(claim.explanation),
        suggestedCorrection: claim.suggestedCorrection ? redactProviderSecrets(claim.suggestedCorrection) : undefined,
        sources: sources.filter((source) => claim.sources.some((candidate) => candidate.url === source.url))
      })),
      sources,
      proposedPatch: supported && result.patch ? {
        ...result.patch, proposedCode: redactProviderSecrets(result.patch.proposedCode),
        unifiedDiff: redactProviderSecrets(result.patch.unifiedDiff),
        explanation: redactProviderSecrets(result.patch.explanation)
      } : undefined,
      tests: tests.map((test) => ({ ...test })),
      usage: usage(budget),
      errors: supported ? [] : [{
        code: 'INSUFFICIENT_EVIDENCE',
        message: 'Retrieved sources and assessments did not establish an evidence-supported diagnosis and fix. No verified patch is offered.',
        retryable: false
      }],
      safety: { codeExecuted: false, codeModified: false, approvalRequiredToApply: true }
    };
  } catch (error) {
    if (error instanceof ProviderError) return empty(budget, [{
      code: error.code, provider: error.provider,
      message: redactProviderSecrets(error.message), retryable: error.retryable
    }]);
    // Preserve useful budget errors from legacy guards, without returning arbitrary exception text.
    if (error instanceof Error && /budget|deadline/i.test(error.message)) return empty(budget, [{
      code: /deadline/i.test(error.message) ? 'TIMEOUT' : 'BUDGET_EXCEEDED',
      message: 'The configured run budget or deadline was reached. Reduce the input or adjust the approved limits.',
      retryable: false
    }]);
    return empty(budget, [{ code: 'INTERNAL_ERROR', message: 'The diagnosis could not be completed safely.', retryable: false }]);
  }
}
