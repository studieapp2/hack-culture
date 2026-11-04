import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serverConfig } from '../config';
import { diagnoseApiError } from '../services/diagnoseApiError';
import type { DiagnoseApiErrorInput } from '../diagnoseApiError.contract';

// All successful provider responses in this file are isolated test fixtures.
const docUrl = 'https://docs.example.org/fixture-sdk-migration';
const input = {
  error: 'Fixture SDK compatibility error: legacyCall is unsupported.',
  code: 'legacyCall();\n', fileName: 'untouched.ts', language: 'typescript'
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (data: unknown, reported = true, truncated = false) => response({
  choices: [{ message: { content: JSON.stringify(data) }, finish_reason: truncated ? 'length' : 'stop' }],
  ...(reported ? { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } } : {}),
  model: 'fixture-model'
});

async function isolated(action: () => Promise<void>) {
  const oldConfig = { ...serverConfig };
  const oldFetch = globalThis.fetch;
  Object.assign(serverConfig, {
    bifrostBaseUrl: 'https://bifrost.example.org/v1', bifrostModel: 'fixture-model',
    bifrostApiKey: 'fixture-bifrost-key', tavilyApiKey: 'fixture-tavily-key',
    bifrostFallbackModel: undefined, maxModelCallsPerRun: 4, maxTokensPerRun: 15000,
    maxTavilySearchesPerRun: 3, requestTimeoutMs: 30000,
    maxCostPerRunUsd: 0.50,
    bifrostInputUsdPerMillion: undefined, bifrostOutputUsdPerMillion: undefined, tavilyUsdPerCredit: undefined
  });
  try { await action(); } finally {
    globalThis.fetch = oldFetch;
    Object.assign(serverConfig, oldConfig);
  }
}

function fixtures(options: {
  missingUsage?: boolean; assessment?: string; assessmentUrls?: string[];
  finalUrls?: string[]; extractionEmpty?: boolean; searchEmpty?: boolean;
  searchStatus?: number; extractStatus?: number; finalCode?: string;
} = {}) {
  const calls: string[] = [];
  let models = 0;
  globalThis.fetch = (async (url) => {
    const endpoint = String(url);
    calls.push(endpoint);
    if (endpoint.includes('api.tavily.com/search')) return response({
      results: options.searchEmpty ? [] : [{ title: 'Fixture SDK documentation', url: docUrl, content: 'Search snippet.' }],
      usage: { credits: 1 }
    }, options.searchStatus || 200);
    if (endpoint.includes('api.tavily.com/extract')) return response({
      results: options.extractionEmpty ? [] : [{
        url: docUrl, raw_content: 'Fixture SDK version 2 removed legacyCall. Use modernCall instead.'
      }], failed_results: options.extractionEmpty ? [{ url: docUrl, error: 'Fixture page failure' }] : [],
      usage: { credits: 1 }
    }, options.extractStatus || 200);
    models++;
    if (models === 1) return completion({
      diagnosis: 'Preliminary fixture hypothesis.',
      technical_claims: ['Fixture SDK version 2 removed legacyCall.']
    }, !options.missingUsage);
    if (models === 2) return completion({
      status: options.assessment || 'VERIFIED',
      explanation: 'Fixture extracted documentation supports the assertion.',
      source_urls: options.assessmentUrls || [docUrl],
      suggested_correction: 'Use modernCall in the fixture SDK.'
    }, !options.missingUsage);
    return completion({
      diagnosis: 'Grounded fixture diagnosis: the API changed in SDK version 2.',
      diagnosis_status: 'supported', source_urls: options.finalUrls || [docUrl],
      proposed_code: options.finalCode || 'modernCall();\n',
      explanation: 'Fixture-only minimal replacement supported by extracted documentation.'
    }, !options.missingUsage);
  }) as typeof fetch;
  return calls;
}

test('Strict configuration errors require both providers without making requests', () => isolated(async () => {
  serverConfig.bifrostBaseUrl = undefined;
  serverConfig.tavilyApiKey = undefined;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.status, 'error');
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => error.code === 'MISSING_CONFIGURATION'));
  assert.equal(result.diagnosis, null);
  assert.deepEqual(result.sources, []);
  assert.equal(result.usage.actualCostUsd, 0);
  assert.equal(calls, 0);
}));

test('Strict invalid inputs, unsafe paths and accessors are rejected before provider calls', () => isolated(async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  let getterRan = false;
  const accessor = Object.defineProperty({}, 'error', { get() { getterRan = true; return 'error'; } });
  for (const value of [
    null, [], 'text', {}, { error: 'x', code: ' ' }, { ...input, error: 1 },
    { ...input, fileName: '../secret.ts' }, { ...input, fileName: '/absolute.ts' },
    { ...input, language: 1 }, { ...input, unexpected: true }, accessor
  ]) {
    const result = await diagnoseApiError(value as unknown as DiagnoseApiErrorInput);
    assert.equal(result.status, 'error');
    assert.equal(result.errors[0].code, 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
  assert.equal(getterRan, false);
}));

test('Strict credential-bearing input is rejected without leaking or transmitting the secret', () => isolated(async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  const secret = 'sk-fixtureSensitiveToken123456';
  const result = await diagnoseApiError({ error: 'API error', code: `api_key = "${secret}"` });
  assert.equal(result.errors[0].code, 'INVALID_INPUT');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(calls, 0);
}));

test('Strict Bifrost auth failure remains a provider error, not a fabricated result', () => isolated(async () => {
  globalThis.fetch = (async () => response({ secret: 'fixture-bifrost-key' }, 401)) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'PROVIDER_ERROR');
  assert.equal(result.errors[0].provider, 'bifrost');
  assert.equal(result.errors[0].retryable, false);
  assert.equal(result.usage.modelCalls, 1);
  assert.equal(result.usage.model, null);
  assert.equal(result.usage.actualCostUsd, null);
  assert.ok(!JSON.stringify(result).includes('fixture-bifrost-key'));
}));

test('Strict Tavily search and extraction failures are not silently downgraded', () => isolated(async () => {
  fixtures({ searchStatus: 401 });
  let result = await diagnoseApiError(input);
  assert.equal(result.errors[0].provider, 'tavily');
  assert.equal(result.errors[0].code, 'PROVIDER_ERROR');
  assert.equal(result.usage.searchCalls, 1);
  fixtures({ extractStatus: 503 });
  result = await diagnoseApiError(input);
  assert.equal(result.errors[0].provider, 'tavily');
  assert.equal(result.errors[0].retryable, true);
  assert.equal(result.usage.extractionCalls, 1);
  assert.equal(result.status, 'error');
}));

test('Strict insufficient search/extraction evidence yields an unverified diagnosis and no patch', () => isolated(async () => {
  fixtures({ searchEmpty: true });
  let result = await diagnoseApiError(input);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.diagnosis!.evidenceStatus, 'unverified');
  assert.deepEqual(result.sources, []);
  assert.equal(result.proposedPatch, undefined);
  fixtures({ extractionEmpty: true });
  result = await diagnoseApiError(input);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.sources[0].url, docUrl);
  assert.equal(result.sources[0].extractionStatus, 'not_extracted');
  assert.equal(result.proposedPatch, undefined);
}));

test('Strict full fixture workflow returns revised diagnosis, real-to-fixture sources, diff and honest accounting', () => isolated(async () => {
  Object.assign(serverConfig, {
    bifrostInputUsdPerMillion: 1, bifrostOutputUsdPerMillion: 2, tavilyUsdPerCredit: 0.01
  });
  const directory = mkdtempSync(path.join(tmpdir(), 'patchpilot-readonly-'));
  const file = path.join(directory, input.fileName);
  writeFileSync(file, input.code);
  try {
    const calls = fixtures();
    const result = await diagnoseApiError(input);
    assert.equal(result.contractVersion, '1');
    assert.equal(result.status, 'supported');
    assert.ok(result.diagnosis!.summary.startsWith('Grounded fixture'));
    assert.equal(result.claims[0].status, 'VERIFIED');
    assert.deepEqual(result.sources.map((source) => source.url), [docUrl]);
    assert.equal(result.sources[0].extractionStatus, 'extracted');
    assert.ok(result.proposedPatch!.unifiedDiff.includes('-legacyCall();'));
    assert.ok(result.proposedPatch!.unifiedDiff.includes('+modernCall();'));
    assert.equal(result.proposedPatch!.approvalStatus, 'pending');
    assert.equal(result.tests[0].status, 'not_run');
    assert.deepEqual(result.safety, { codeExecuted: false, codeModified: false, approvalRequiredToApply: true });
    assert.equal(readFileSync(file, 'utf8'), input.code);
    assert.equal(result.usage.modelCalls, 3);
    assert.equal(result.usage.searchCalls, 1);
    assert.equal(result.usage.extractionCalls, 1);
    assert.equal(result.usage.model!.totalTokens, 90);
    assert.equal(result.usage.model!.provider, 'bifrost-gateway');
    assert.equal(result.usage.searchCredits, 1);
    assert.equal(result.usage.extractionCredits, 1);
    assert.equal(result.usage.actualCostUsd, null);
    assert.ok(Math.abs(result.usage.estimatedCostUsd! - 0.02015) < 0.0000001);
    assert.equal(result.usage.costBasis, 'configured_rates');
    assert.equal(calls.length, 5);
    assert.equal(JSON.parse(JSON.stringify(result)).status, 'supported');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}));

test('Strict model-only support or missing supporting citations cannot become verified output', () => isolated(async () => {
  fixtures({ assessment: 'INSUFFICIENT_EVIDENCE', assessmentUrls: [] });
  let result = await diagnoseApiError(input);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.proposedPatch, undefined);
  fixtures({ assessmentUrls: [] });
  result = await diagnoseApiError(input);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.claims[0].status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.proposedPatch, undefined);
}));

test('Strict invented claim/final citations are rejected and never returned as retrieved sources', () => isolated(async () => {
  const invented = 'https://invented.example.org/never-retrieved';
  for (const options of [{ assessmentUrls: [invented] }, { finalUrls: [invented] }]) {
    fixtures(options);
    const result = await diagnoseApiError(input);
    assert.equal(result.status, 'error');
    assert.equal(result.errors[0].code, 'INVALID_PROVIDER_RESPONSE');
    assert.ok(!JSON.stringify(result).includes(invented));
    assert.equal(result.proposedPatch, undefined);
  }
}));

test('Strict missing usage stops further spending and unknown billing stays unknown', () => isolated(async () => {
  fixtures({ missingUsage: true });
  const result = await diagnoseApiError(input);
  assert.equal(result.status, 'error');
  assert.equal(result.errors[0].code, 'BUDGET_EXCEEDED');
  assert.equal(result.usage.modelCalls, 1);
  assert.equal(result.usage.model, null);
  assert.equal(result.usage.incompleteModelUsage, true);
  assert.equal(result.usage.actualCostUsd, null);
  assert.equal(result.usage.estimatedCostUsd, null);
}));

test('Strict malformed/truncated completion retains already reported usage but no result', () => isolated(async () => {
  globalThis.fetch = (async () => completion({ diagnosis: 'Incomplete' }, true, true)) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'INVALID_PROVIDER_RESPONSE');
  assert.equal(result.usage.model!.totalTokens, 30);
  assert.equal(result.diagnosis, null);
}));

test('Strict prompt reservation blocks oversized input before spending a model request', () => isolated(async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  const result = await diagnoseApiError({ ...input, code: 'a'.repeat(16000) });
  assert.equal(result.errors[0].code, 'BUDGET_EXCEEDED');
  assert.equal(result.usage.modelCalls, 0);
  assert.equal(result.usage.actualCostUsd, 0);
  assert.equal(calls, 0);
}));

test('Strict response-body timeout is enforced after headers arrive', () => isolated(async () => {
  serverConfig.requestTimeoutMs = 5;
  globalThis.fetch = (async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options?.signal?.addEventListener('abort', () => controller.error(new Error('fixture body aborted')), { once: true });
    }
  }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'TIMEOUT');
  assert.equal(result.errors[0].provider, 'bifrost');
}));

test('Strict proposals containing invented credential literals are rejected', () => isolated(async () => {
  const secret = 'sk-fixtureInventedCredential123';
  fixtures({ finalCode: `api_key = "${secret}";\nmodernCall();\n` });
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'INVALID_PROVIDER_RESPONSE');
  assert.equal(result.proposedPatch, undefined);
  assert.ok(!JSON.stringify(result).includes(secret));
}));

test('Strict configured price bounds reserve the next request before dispatch', () => isolated(async () => {
  Object.assign(serverConfig, {
    bifrostInputUsdPerMillion: 1, bifrostOutputUsdPerMillion: 2, maxCostPerRunUsd: 0.000001
  });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'BUDGET_EXCEEDED');
  assert.equal(result.usage.modelCalls, 0);
  assert.equal(calls, 0);
}));

test('Strict Tavily body timeout propagates instead of completing retrieval after deadline', () => isolated(async () => {
  serverConfig.requestTimeoutMs = 5;
  globalThis.fetch = (async (url, options) => {
    if (!String(url).includes('api.tavily.com')) return completion({
      diagnosis: 'Fixture hypothesis', technical_claims: ['Fixture SDK version 2 changed the API.']
    });
    return new Response(new ReadableStream({
      start(controller) {
        options?.signal?.addEventListener('abort', () => controller.error(new Error('fixture body aborted')), { once: true });
      }
    }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'TIMEOUT');
  assert.equal(result.errors[0].provider, 'tavily');
}));

test('Strict requests bypass cached sources and perform actual-to-fixture retrieval each run', () => isolated(async () => {
  const first = fixtures();
  await diagnoseApiError(input);
  const second = fixtures();
  await diagnoseApiError(input);
  assert.equal(first.filter((url) => url.includes('api.tavily.com/search')).length, 1);
  assert.equal(second.filter((url) => url.includes('api.tavily.com/search')).length, 1);
}));

test('Strict raw bearer credentials and signed URLs are rejected before external dispatch', () => isolated(async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('Unexpected request'); }) as typeof fetch;
  for (const code of [
    'Authorization: Bearer fixtureCredentialToken123456',
    'const url = "https://storage.example.org/file?X-Amz-Signature=fixtureSignature123456";'
  ]) {
    const result = await diagnoseApiError({ error: 'API request failed', code });
    assert.equal(result.errors[0].code, 'INVALID_INPUT');
    assert.ok(!JSON.stringify(result).includes('fixtureCredential'));
    assert.ok(!JSON.stringify(result).includes('fixtureSignature'));
  }
  assert.equal(calls, 0);
}));

test('Strict provider failures do not retry an unpriced fallback with unknown failed-call usage', () => isolated(async () => {
  serverConfig.bifrostFallbackModel = 'unpriced-fixture-fallback';
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return response({}, 503); }) as typeof fetch;
  const result = await diagnoseApiError(input);
  assert.equal(result.errors[0].code, 'PROVIDER_ERROR');
  assert.equal(result.errors[0].provider, 'bifrost');
  assert.equal(result.usage.modelCalls, 1);
  assert.equal(result.usage.actualCostUsd, null);
  assert.equal(calls, 1);
}));
