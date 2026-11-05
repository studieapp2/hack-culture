import { writeFileSync } from 'node:fs';
import { tavilyService } from '../services/tavilyService';
import { createRunBudget } from '../services/runBudget';
import { ProviderError } from '../services/providerError';
import { redactProviderSecrets } from '../services/sensitiveData';

// Independent, real Search/Extract validation. No model or submitted-code execution.
// One basic search and at most one basic URL extraction: at most two credits.
// Public pay-as-you-go pricing is $0.008/credit; reserve $0.04 conservatively.
const budget = createRunBudget();
const nativeFetch = globalThis.fetch;
let outboundCalls = 0;
let report: Record<string, unknown>;
try {
  if (!tavilyService.isConfigured()) {
    throw new ProviderError('tavily', 'MISSING_CONFIGURATION', 'TAVILY_API_KEY is not configured.', undefined, false);
  }
  globalThis.fetch = (async (url, options) => {
    const endpoint = String(url);
    const body = JSON.parse(String(options?.body || '{}'));
    if (!['https://api.tavily.com/search', 'https://api.tavily.com/extract'].includes(endpoint) ||
      outboundCalls >= 2 || body.search_depth === 'advanced' ||
      body.extract_depth === 'advanced' || (body.urls && body.urls.length > 1)) {
      throw new ProviderError('tavily', 'BUDGET_EXCEEDED', 'The bounded two-call Tavily validation budget was reached.');
    }
    outboundCalls++;
    return nativeFetch(url, options);
  }) as typeof fetch;
  budget.searchCount++;
  const sources = await tavilyService.searchSources(
    '@google/genai JavaScript models.generateContent SDK documentation',
    { maxResults: 1, searchDepth: 'basic', includeDomains: ['ai.google.dev'], bypassCache: true },
    budget
  );
  const extracted = sources.length ? await tavilyService.extractSources([sources[0].url], {
    strict: true, budget, timeoutMs: budget.deadlineAt - Date.now()
  }) : new Map<string, string>();
  report = {
    status: sources.length && extracted.size ? 'succeeded' : 'insufficient_evidence',
    searchCalls: budget.searchRequests, extractionCalls: budget.extractionRequests,
    sources: sources.map((source) => ({
      title: source.title, url: source.url,
      extracted: extracted.has(source.url),
      excerpt: (extracted.get(source.url) || source.excerpt).slice(0, 1200)
    })),
    searchCredits: budget.searchUsageReports === budget.searchRequests ? budget.searchCredits : null,
    extractionCredits: budget.extractionUsageReports === budget.extractionRequests ? budget.extractionCredits : null,
    maximumReservedUsd: 0.04,
    estimatedUsdAtPublishedPayAsYouGoRate:
      budget.searchUsageReports === budget.searchRequests && budget.extractionUsageReports === budget.extractionRequests
        ? (budget.searchCredits + budget.extractionCredits) * 0.008 : null,
    actualBilledUsd: outboundCalls ? null : 0,
    modelCalls: 0, submittedCodeExecuted: false, submittedCodeModified: false
  };
} catch (error) {
  report = {
    status: 'error', outboundCalls,
    error: error instanceof ProviderError ? { code: error.code, provider: error.provider, message: error.message }
      : { code: 'PROVIDER_ERROR', message: 'Tavily validation could not be completed.' },
    actualBilledUsd: outboundCalls ? null : 0,
    modelCalls: 0, submittedCodeExecuted: false, submittedCodeModified: false
  };
} finally {
  globalThis.fetch = nativeFetch;
}
const text = redactProviderSecrets(JSON.stringify(report, null, 2));
console.log(text);
if (process.argv[2]) writeFileSync(process.argv[2], text, { encoding: 'utf8', mode: 0o600 });
if (report.status !== 'succeeded') process.exitCode = 2;
