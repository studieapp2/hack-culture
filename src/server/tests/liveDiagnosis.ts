import { readFileSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { serverConfig } from '../config';
import { diagnoseApiError } from '../services/diagnoseApiError';
import { bifrostService } from '../services/bifrostService';
import { tavilyService } from '../services/tavilyService';
import { ProviderError } from '../services/providerError';
import { redactProviderSecrets } from '../services/sensitiveData';

// This is our controlled SDK probe, not execution of a submitted user snippet.
// A placeholder key is sufficient: calling a nonexistent method fails locally.
const client = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });
const legacy = client.models as unknown as { generateText?: (value: unknown) => unknown };
if (typeof legacy.generateText === 'function') {
  throw new Error('The controlled compatibility case changed; no API call was attempted.');
}
let actualError = '';
try {
  legacy.generateText!({ model: 'gemini-2.5-flash', contents: 'Controlled compatibility probe' });
} catch (error) {
  actualError = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown local SDK error';
}
const sdk = JSON.parse(readFileSync(new URL('../../../node_modules/@google/genai/package.json', import.meta.url), 'utf8'));
const input = {
  error: `@google/genai ${sdk.version}: ${actualError}`,
  code: `import { GoogleGenAI } from '@google/genai';
const client = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });
const legacy = client.models;
await legacy.generateText({ model: 'gemini-2.5-flash', contents: 'Controlled compatibility probe' });`,
  fileName: 'controlled-sdk-example.js',
  language: 'javascript'
};
const ceilingUsd = 2;
let reservedUsd = 0;
const requests: Array<{ provider: string; maximumEstimatedUsd: number }> = [];
const originalFetch = globalThis.fetch;
const originalFallback = serverConfig.bifrostFallbackModel;
const hasProviders = bifrostService.isConfigured() && tavilyService.isConfigured();
const hasPrices = serverConfig.bifrostInputUsdPerMillion !== undefined &&
  serverConfig.bifrostOutputUsdPerMillion !== undefined && serverConfig.tavilyUsdPerCredit !== undefined;
let result: Awaited<ReturnType<typeof diagnoseApiError>> | null = null;
let blockedReason: string | null = null;

try {
  if (!hasProviders) {
    // The genuine engine configuration response is safe and makes no requests.
    result = await diagnoseApiError(input);
    blockedReason = 'Real provider configuration is missing; no live AI/search/extraction was performed.';
  } else if (!hasPrices) {
    blockedReason = 'Live calls blocked: configure verified conservative model-token and Tavily-credit price bounds before using the $2 budget.';
  } else {
    // Do not route the budgeted test through an unpriced application fallback.
    serverConfig.bifrostFallbackModel = undefined;
    globalThis.fetch = (async (url, options) => {
      const endpoint = String(url);
      const body = JSON.parse(String(options?.body || '{}'));
      let provider: 'bifrost' | 'tavily';
      let upperBound: number;
      if (endpoint.startsWith(serverConfig.bifrostBaseUrl!)) {
        provider = 'bifrost';
        if (body.model !== serverConfig.bifrostModel) {
          throw new ProviderError(provider, 'BUDGET_EXCEEDED', 'An unpriced model request was blocked.');
        }
        const promptUpperBound = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1536;
        upperBound = (promptUpperBound * serverConfig.bifrostInputUsdPerMillion! +
          Number(body.max_tokens || 0) * serverConfig.bifrostOutputUsdPerMillion!) / 1000000;
      } else if (endpoint === 'https://api.tavily.com/search' || endpoint === 'https://api.tavily.com/extract') {
        provider = 'tavily';
        // Basic search: one credit. Extraction: conservatively reserve one per URL.
        const credits = endpoint.endsWith('/search') ? 1 : Math.max(1, body.urls?.length || 0);
        upperBound = credits * serverConfig.tavilyUsdPerCredit!;
      } else {
        throw new ProviderError('bifrost', 'BUDGET_EXCEEDED', 'Unexpected outbound endpoint blocked during the controlled live test.');
      }
      if (!Number.isFinite(upperBound) || reservedUsd + upperBound > ceilingUsd) {
        throw new ProviderError(provider, 'BUDGET_EXCEEDED', 'The $2 conservative live-test budget would be exceeded; approval is required.');
      }
      reservedUsd += upperBound;
      requests.push({ provider, maximumEstimatedUsd: upperBound });
      return originalFetch(url, options);
    }) as typeof fetch;
    result = await diagnoseApiError(input);
  }
} finally {
  globalThis.fetch = originalFetch;
  serverConfig.bifrostFallbackModel = originalFallback;
}

const report = {
  controlledCase: {
    sdk: sdk.name, version: sdk.version, actualError,
    ownLocalSdkProbeExecuted: true, submittedCodeExecuted: false, submittedCodeModified: false
  },
  liveProviderRequests: requests.length,
  blockedReason,
  budget: {
    ceilingUsd, reservedMaximumEstimatedUsd: reservedUsd,
    actualBilledUsd: requests.length === 0 ? 0 : null,
    note: 'Configured rates must bound the actual model/plan and gateway routing. Estimates are not invoices; verify provider-side spend limits.'
  },
  requests, result
};
const text = redactProviderSecrets(JSON.stringify(report, null, 2));
console.log(text);
if (process.argv[2]) writeFileSync(process.argv[2], text, { encoding: 'utf8', mode: 0o600 });
if (blockedReason || result?.status !== 'supported') process.exitCode = 2;
