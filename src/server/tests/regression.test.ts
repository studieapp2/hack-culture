import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Provider responses below are test fixtures, never live application data.
const testDir = mkdtempSync(path.join(tmpdir(), 'patchpilot-regression-'));
process.env.PATCHPILOT_DATA_DIR = path.join(testDir, 'runs');
process.env.NODE_ENV = 'production';
const { serverConfig, loadConfig } = await import('../config');
const { claimExtractor } = await import('../services/claimExtractor');
const { claimVerifier } = await import('../services/claimVerifier');
const { BifrostService } = await import('../services/bifrostService');
const { TavilyService } = await import('../services/tavilyService');
const { FixCodeService } = await import('../services/fixCodeService');
const { RunService, runService } = await import('../services/runService');
const { createRunBudget } = await import('../services/runBudget');
const { createApp } = await import('../../../server');
const { httpServer } = await createApp();
await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const address = httpServer.address() as { port: number };
const baseUrl = `http://127.0.0.1:${address.port}`;
const actualFetch = globalThis.fetch;
const originalConfig = { ...serverConfig };
const defaults = () => Object.assign(serverConfig, originalConfig, {
  tavilyApiKey: undefined, bifrostBaseUrl: undefined, bifrostApiKey: undefined,
  bifrostFallbackModel: undefined, maxModelCallsPerRun: 4,
  maxTavilySearchesPerRun: 3, maxTokensPerRun: 15000
});
defaults();
afterEach(() => { globalThis.fetch = actualFetch; defaults(); });
after(async () => {
  globalThis.fetch = actualFetch;
  await new Promise<void>((resolve, reject) => httpServer.close((err) => err ? reject(err) : resolve()));
  rmSync(testDir, { recursive: true, force: true });
});
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (data: unknown) => jsonResponse({
  choices: [{ message: { content: JSON.stringify(data) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }, model: 'fixture-model'
});
const post = (endpoint: string, body: unknown) => actualFetch(`${baseUrl}${endpoint}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const claim = (text = 'This API accepts max_tokens.') => ({
  id: 'fixture', originalText: text, startOffset: 0, endOffset: text.length,
  freshnessSensitive: true, status: 'INSUFFICIENT_EVIDENCE' as const, explanation: '', sources: []
});

test('Claim extraction preserves original offsets, versions and final sentences', async () => {
  const text = '  Version 2.0 supports this API. The SDK requires authentication  ';
  const claims = await claimExtractor.extractClaims(text);
  assert.equal(claims.length, 2);
  assert.ok(claims[0].originalText.includes('2.0'));
  for (const item of claims) assert.equal(text.slice(item.startOffset, item.endOffset), item.originalText);
});

test('Unified diffs apply exactly, including duplicate/moved lines and newline changes', () => {
  const cases = [
    ['a\nb\na\n', 'a\na\nb\n'], ['first\nsame\nlast\n', 'first\nchanged\nlast\n'],
    ['hello', 'hello\n'], ['hello\n', 'hello'], ['', 'new\n'], ['old\n', ''],
    ['  code\n\n', '  new code\n\n']
  ];
  for (const [original, proposed] of cases) {
    writeFileSync(path.join(testDir, 'snippet.txt'), original);
    const diff = new FixCodeService().generateUnifiedDiff('snippet.txt', original, proposed);
    const result = spawnSync('git', ['apply', '--unsafe-paths', '-'], { cwd: testDir, input: diff, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + diff);
    assert.equal(readFileSync(path.join(testDir, 'snippet.txt'), 'utf8'), proposed);
  }
});

test('Tavily uses documented endpoints, caches by options, and bounds cache results', async () => {
  serverConfig.tavilyApiKey = 'fixture-only-not-a-real-key';
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return jsonResponse({ results: [{ title: 'Fixture source', url: 'https://example.com/docs', content: 'content', raw_content: 'extract' }] });
  }) as typeof fetch;
  const service = new TavilyService();
  await service.searchSources('API documentation', { maxResults: 5 });
  await service.searchSources('API documentation', { maxResults: 5 });
  await service.searchSources('API documentation', { maxResults: 5, includeDomains: ['example.com'] });
  await service.extractSources(['https://example.com/docs', 'javascript:alert(1)']);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://api.tavily.com/search');
  assert.equal(calls[0].body.max_results, 5);
  assert.equal(calls[2].url, 'https://api.tavily.com/extract');
  assert.deepEqual(calls[2].body.urls, ['https://example.com/docs']);
});

test('Unrelated deprecated evidence never produces a false OUTDATED result', async () => {
  serverConfig.tavilyApiKey = 'fixture-only-key';
  globalThis.fetch = (async () => jsonResponse({ results: [{
    title: 'Unrelated library', url: 'https://example.com/docs', content: 'An unrelated function is deprecated.'
  }] })) as typeof fetch;
  assert.equal((await claimVerifier.verifyClaim(claim())).status, 'INSUFFICIENT_EVIDENCE');
});

test('Bifrost 404/invalid model lists are not reported as verified', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1/chat/completions';
  let endpoint = '';
  globalThis.fetch = (async (url) => { endpoint = String(url); return jsonResponse({}, 404); }) as typeof fetch;
  assert.equal((await new BifrostService().checkHealth()).status, 'provider_error');
  assert.equal(endpoint, 'https://example.com/v1/models');
  globalThis.fetch = (async () => jsonResponse({ wrong: true })) as typeof fetch;
  assert.equal((await new BifrostService().checkHealth()).status, 'provider_error');
});

test('Bifrost does not retry auth errors or expose provider response secrets', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.bifrostFallbackModel = 'fallback-fixture';
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return jsonResponse({ secret: 'fixture-secret' }, 401); }) as typeof fetch;
  await assert.rejects(new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }]),
    (err: Error) => err.message.includes('401') && !err.message.includes('fixture-secret'));
  assert.equal(calls, 1);
});

test('Fallback requests count against the same model-call budget', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.bifrostFallbackModel = 'fallback-fixture';
  serverConfig.maxModelCallsPerRun = 1;
  const budget = createRunBudget();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return jsonResponse({}, 503); }) as typeof fetch;
  await assert.rejects(new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }],
    { runBudget: budget }), /budget exceeded/);
  assert.equal(calls, 1);
  assert.equal(budget.callCount, 1);
});

test('Full verify workflow aggregates measured usage and limits searches/calls', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.tavilyApiKey = 'fixture-only-key';
  let modelCalls = 0;
  let searches = 0;
  const sentences = [1, 2, 3, 4, 5].map((n) => `The API supports feature ${n}.`);
  globalThis.fetch = (async (url) => {
    if (String(url).includes('api.tavily.com')) {
      searches++;
      return jsonResponse({ results: [{ title: 'Fixture', url: 'https://example.com', content: 'Fixture evidence.' }] });
    }
    modelCalls++;
    return completion(modelCalls === 1
      ? { claims: sentences.map((text) => ({ exact_quote: text })) }
      : { status: 'VERIFIED', explanation: 'Fixture evidence evaluation, not a live result.' });
  }) as typeof fetch;
  const response = await post('/api/verify', { text: sentences.join(' ') });
  assert.equal(response.status, 200);
  const run = await response.json();
  assert.equal(run.claims.length, 5);
  assert.equal(searches, 3);
  assert.equal(modelCalls, 4);
  assert.equal(run.usage.totalTokens, 120);
  assert.equal(run.usage.isMeasured, true);
  assert.equal(run.claims[4].status, 'INSUFFICIENT_EVIDENCE');
});

test('Fix workflow preserves whitespace, records approval, and never claims execution', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  globalThis.fetch = (async () => completion({
    diagnosis: 'Fixture diagnosis', technical_claims: [], proposed_code: '  fixed();\n', explanation: 'Fixture patch'
  })) as typeof fetch;
  const response = await post('/api/fix/analyze', { error: 'Fixture error', code: '  broken();\n', fileName: 'test.ts' });
  assert.equal(response.status, 200);
  const run = await response.json();
  assert.equal(run.patch.originalCode, '  broken();\n');
  assert.equal(run.status, 'AWAITING_APPROVAL');
  assert.equal(run.tests[0].status, 'not_run');
  const approval = await post(`/api/runs/${run.id}/approve`, {});
  assert.equal((await approval.json()).status, 'APPROVED');
  assert.equal((await post(`/api/runs/${run.id}/approve`, {})).status, 400);
});

test('Invalid model JSON shapes do not produce made-up diagnoses', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  globalThis.fetch = (async () => completion({ proposed_code: 42 })) as typeof fetch;
  await assert.rejects(new FixCodeService().analyzeAndFix({ error: 'fixture', code: 'a' }), /invalid diagnosis/);
});

test('Input errors, unknown APIs, malformed JSON, and missing run actions return JSON', async () => {
  for (const [endpoint, body] of [
    ['/api/verify', { text: 12 }], ['/api/verify', { text: 'x'.repeat(20001) }],
    ['/api/fix/analyze', { error: ['bad'] }], ['/api/fix/analyze', { error: 'x', code: 1 }],
    ['/api/fix/analyze', { error: 'x', fileName: 'a\nb' }]
  ] as Array<[string, unknown]>) {
    const response = await post(endpoint, body);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const malformed = await actualFetch(`${baseUrl}/api/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken'
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');
  const oversized = await post('/api/verify', { text: 'x'.repeat(2100000) });
  assert.equal(oversized.status, 413);
  assert.equal(typeof (await oversized.json()).error, 'string');
  for (const endpoint of ['/api/missing', '/api/runs/missing']) {
    const response = await actualFetch(`${baseUrl}${endpoint}`);
    assert.equal(response.status, 404);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await post('/api/runs/missing/approve', {})).status, 404);
  assert.equal((await post('/api/runs/missing/reject', {})).status, 404);
  assert.equal((await actualFetch(`${baseUrl}/api/runs?search[]=bad`)).status, 400);
});

test('Missing integration failures are visible, persisted, and mark active steps failed', async () => {
  const response = await post('/api/fix/analyze', { error: 'Fixture failure' });
  assert.equal(response.status, 500);
  const error = await response.json();
  assert.ok(error.message.includes('BIFROST_BASE_URL'));
  const run = runService.getRun(error.runId)!;
  assert.equal(run.status, 'FAILED');
  assert.ok(run.steps.some((step) => step.status === 'failed'));
  assert.equal((await actualFetch(`${baseUrl}/api/health`)).status, 200);
});

test('Persistence survives reload, interrupted runs fail honestly, and rejection is saved', () => {
  const dataDir = path.join(testDir, 'persistence');
  const service = new RunService(dataDir);
  const interrupted = service.createRun('code_fix', 'Interrupted fixture', { status: 'ANALYZING' });
  const review = service.createRun('code_fix', 'Review fixture', { status: 'PATCH_READY' });
  service.rejectRun(review.id);
  service.createRun('answer_verification', 'Passage fixture', { answerInput: 'A searchable technical assertion.' });
  const reloaded = new RunService(dataDir);
  assert.equal(reloaded.getRun(interrupted.id)!.status, 'FAILED');
  assert.equal(reloaded.getRun(review.id)!.status, 'REJECTED');
  assert.equal(reloaded.listRuns({ search: 'review' }).length, 1);
  assert.equal(reloaded.listRuns({ status: 'REJECTED' }).length, 1);
  assert.equal(reloaded.listRuns({ search: 'searchable' }).length, 1);
});

test('Invalid numeric configuration falls back to safe positive defaults', () => {
  process.env.MAX_MODEL_CALLS_PER_RUN = 'NaN';
  process.env.REQUEST_TIMEOUT_MS = '-1';
  try {
    assert.equal(loadConfig().maxModelCallsPerRun, 4);
    assert.equal(loadConfig().requestTimeoutMs, 30000);
  } finally {
    delete process.env.MAX_MODEL_CALLS_PER_RUN;
    delete process.env.REQUEST_TIMEOUT_MS;
  }
});

test('Provider timeouts reject promptly and clear abort timers', async () => {
  serverConfig.tavilyApiKey = 'fixture-only-key';
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.requestTimeoutMs = 10;
  globalThis.fetch = (async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  })) as typeof fetch;
  await assert.rejects(new TavilyService().searchSources('timeout fixture'), /timed out/);
  await assert.rejects(new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }]), /aborted/);
});

test('Exhausted token budget blocks requests; malformed usage is not measured', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  const budget = createRunBudget();
  budget.totalTokensUsed = serverConfig.maxTokensPerRun;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return jsonResponse({ choices: [{ message: { content: 'fixture' } }],
      usage: { prompt_tokens: '100', completion_tokens: -20 } });
  }) as typeof fetch;
  await assert.rejects(new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }],
    { runBudget: budget }), /budget exhausted/);
  assert.equal(calls, 0);
  const result = await new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }]);
  assert.equal(result.usage.isMeasured, false);
  assert.equal(result.usage.totalTokens, 0);
});

test('Concurrent workflow limit returns retryable JSON and releases capacity', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  const releases: Array<() => void> = [];
  globalThis.fetch = (async () => new Promise<Response>((resolve) => {
    releases.push(() => resolve(completion({ diagnosis: 'Concurrent fixture', technical_claims: [] })));
  })) as typeof fetch;
  const first = post('/api/fix/analyze', { error: 'first fixture' });
  const second = post('/api/fix/analyze', { error: 'second fixture' });
  const deadline = Date.now() + 1000;
  while (releases.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(releases.length, 2);
  const third = await post('/api/fix/analyze', { error: 'third fixture' });
  assert.equal(third.status, 429);
  assert.equal(third.headers.get('Retry-After'), '5');
  releases.forEach((release) => release());
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  globalThis.fetch = (async () => completion({ diagnosis: 'Released capacity', technical_claims: [] })) as typeof fetch;
  assert.equal((await post('/api/fix/analyze', { error: 'fourth fixture' })).status, 200);
});

test('Failed persistent writes do not leave ghost runs in memory', () => {
  const blockedPath = path.join(testDir, 'not-a-directory');
  writeFileSync(blockedPath, 'fixture');
  const service = new RunService(blockedPath);
  assert.throws(() => service.createRun('code_fix', 'Unsaved fixture'), /could not be saved/);
  assert.equal(service.listRuns().length, 0);
});

test('Hosting readiness checks never call paid integrations', async () => {
  serverConfig.tavilyApiKey = 'fixture-only-key';
  globalThis.fetch = (async () => { throw new Error('No provider probe should run'); }) as typeof fetch;
  const response = await actualFetch(`${baseUrl}/api/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
});

test('API patches are revised against documentation rather than retaining a stale initial proposal', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.tavilyApiKey = 'fixture-only-key';
  serverConfig.maxModelCallsPerRun = 2;
  const original = 'await fetch(url, { method: "GET" });\n';
  const correct = 'await fetch(url, { method: "POST" });\n';
  let calls = 0;
  let groundingPrompt = '';
  globalThis.fetch = (async (url, options) => {
    if (String(url).includes('api.tavily.com')) return jsonResponse({ results: [{
      title: 'Fixture API reference', url: 'https://example.com/search-docs',
      content: 'The search endpoint requires a POST request.'
    }] });
    calls++;
    if (calls === 1) return completion({ diagnosis: 'Initial fixture diagnosis',
      technical_claims: ['The search endpoint uses GET requests.'],
      proposed_code: 'await fetch(url, { method: "DELETE" });\n', explanation: 'Stale fixture proposal' });
    groundingPrompt = JSON.parse(String(options?.body)).messages[1].content;
    return completion({ proposed_code: correct, explanation: 'Use POST per https://example.com/search-docs (test fixture).' });
  }) as typeof fetch;
  const budget = createRunBudget();
  const result = await new FixCodeService().analyzeAndFix({ error: 'Request method rejected', code: original }, budget);
  assert.equal(result.patch!.proposedCode, correct);
  assert.ok(groundingPrompt.includes('The search endpoint requires a POST request.'));
  assert.ok(groundingPrompt.includes(original));
  assert.equal(calls, 2);
  assert.equal(result.usage.totalTokens, 60);
  assert.equal(result.tests[0].status, 'not_run');
});

test('No documentation means no purported evidence-grounded API patch', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.tavilyApiKey = 'fixture-only-key';
  globalThis.fetch = (async (url) => String(url).includes('api.tavily.com')
    ? jsonResponse({ results: [] })
    : completion({ diagnosis: 'Fixture diagnosis', technical_claims: ['This undocumented fixture API requires a parameter.'],
      proposed_code: 'rewritten()', explanation: 'Unsupported fixture proposal' })) as typeof fetch;
  const result = await new FixCodeService().analyzeAndFix({ error: 'Unknown API parameter', code: 'original()' });
  assert.equal(result.patch, undefined);
  assert.ok(result.diagnosis.includes('No documentation was retrieved'));
});

test('Missing credentials leave retrieval/evaluation skipped rather than completed', async () => {
  const response = await post('/api/verify', { text: 'This SDK requires a current API credential.' });
  const run = await response.json();
  assert.equal(run.steps[2].status, 'skipped');
  assert.equal(run.steps[3].status, 'skipped');
  assert.ok(run.errorMessage.includes('have not been verified'));
  assert.ok(run.claims.every((item: any) => item.status === 'INSUFFICIENT_EVIDENCE'));
});

test('Failed Tavily authentication produces a failed dossier with an actionable notice', async () => {
  serverConfig.tavilyApiKey = 'fixture-only-key';
  globalThis.fetch = (async () => jsonResponse({}, 401)) as typeof fetch;
  const response = await post('/api/verify', { text: 'This endpoint requires current authentication credentials.' });
  const run = await response.json();
  assert.equal(run.status, 'FAILED');
  assert.equal(run.steps[2].status, 'failed');
  assert.equal(run.steps[3].status, 'skipped');
  assert.ok(run.errorMessage.includes('Tavily credentials'));
});

test('Expired run deadlines block all additional provider requests', async () => {
  serverConfig.bifrostBaseUrl = 'https://example.com/v1';
  serverConfig.tavilyApiKey = 'fixture-only-key';
  const budget = createRunBudget();
  budget.deadlineAt = Date.now() - 1;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return completion({}); }) as typeof fetch;
  await assert.rejects(new BifrostService().generateCompletion([{ role: 'user', content: 'fixture' }],
    { runBudget: budget }), /deadline/);
  const result = await claimVerifier.verifyClaim(claim(), budget);
  assert.equal(result.status, 'ERROR');
  assert.ok(result.explanation.includes('deadline'));
  assert.equal(requests, 0);
});

test('Browser client surfaces network and unreadable response errors', async () => {
  const { apiClient } = await import('../../services/apiClient');
  globalThis.fetch = (async () => { throw new Error('fixture network failure'); }) as typeof fetch;
  await assert.rejects(apiClient.getHealth(), /Unable to reach the server/);
  globalThis.fetch = (async () => new Response('not JSON')) as typeof fetch;
  await assert.rejects(apiClient.getHealth(), /unreadable response/);
});

test('Browser client timeout restores control instead of waiting indefinitely', async () => {
  const { apiClient } = await import('../../services/apiClient');
  const nativeSetTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = ((callback: (...args: any[]) => void, _delay?: number) =>
      nativeSetTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('fixture abort')), { once: true });
    })) as typeof fetch;
    await assert.rejects(apiClient.getHealth(), /too long to respond/);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
});
