import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BackendUnavailable, InvalidVerificationInput, verifyWithBackend,
  type DiagnoseEngine, type VerifyEngine } from '../backend';
import { createMcpServer, redact } from '../server';

const input = { error: 'Unsupported SDK parameter', code: 'client.call({ oldParameter: true });' };
const data = (response: unknown) =>
  (response as { structuredContent: Record<string, unknown> }).structuredContent;
const localEngineUrl = new URL('../../server/services/diagnoseApiError.ts', import.meta.url);
const testEngineModule = process.env.PATCHPILOT_TEST_ENGINE_MODULE ||
  (existsSync(localEngineUrl) ? fileURLToPath(localEngineUrl) : undefined);
const fixture = () => ({
  contractVersion: '1',
  status: 'insufficient_evidence',
  diagnosis: { summary: 'Automated test double, not a live diagnosis.', evidenceStatus: 'unverified' },
  claims: [],
  sources: [],
  tests: [{ id: 't', name: 'Execution', status: 'not_run' as const, output: '', reason: 'No execution authorized.' }],
  usage: { model: null, modelCalls: 0, searchCalls: 0, extractionCalls: 0,
    searchCredits: null, extractionCredits: null, actualCostUsd: null,
    estimatedCostUsd: null, costBasis: 'not_reported', incompleteModelUsage: true },
  errors: [{ code: 'INSUFFICIENT_EVIDENCE', message: 'Test-double uncertainty.', retryable: false }],
  safety: { codeExecuted: false, codeModified: false, approvalRequiredToApply: true },
});

async function connected(engine: DiagnoseEngine, timeout?: number, verify?: VerifyEngine) {
  const server = createMcpServer(engine, timeout, verify);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'patchpilot-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('Tool discovery exposes the strict input contract', async () => {
  const connection = await connected(async () => fixture());
  try {
    const { tools } = await connection.client.listTools();
    assert.equal(tools.length, 3);
    assert.equal(tools[0].name, 'diagnose_api_error');
    assert.equal(tools[1].name, 'propose_verified_patch');
    assert.deepEqual(tools[1].inputSchema.required, ['error', 'code']);
    assert.equal(tools[1].annotations?.destructiveHint, false);
    assert.equal(tools[2].name, 'verify_technical_claims');
    assert.deepEqual(tools[2].inputSchema.required, ['text']);
    assert.equal(tools[2].annotations?.readOnlyHint, false);
    assert.deepEqual(tools[0].inputSchema.required, ['error', 'code']);
    assert.equal(tools[0].inputSchema.additionalProperties, false);
  } finally { await connection.close(); }
});

test('Valid input reaches engine unchanged; text and structured output agree', async () => {
  let received: unknown;
  const result = fixture();
  const connection = await connected(async value => { received = value; return result; });
  try {
    const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.deepEqual(received, input);
    assert.equal(response.isError, undefined);
    assert.equal(data(response).status, 'insufficient_evidence');
    assert.deepEqual(data(response).usage, result.usage);
    assert.deepEqual(data(response).tests, result.tests);
    assert.deepEqual(JSON.parse((response.content as { text: string }[])[0].text), response.structuredContent);
  } finally { await connection.close(); }
});

test('Malformed, blank, oversized and unknown inputs never invoke backend', async () => {
  let calls = 0;
  const connection = await connected(async () => { calls++; return fixture(); });
  try {
    for (const args of [{ error: 'x' }, { ...input, code: ' ' }, { ...input, error: 42 },
      { ...input, command: 'touch unintended-file' }, { ...input, code: 'x'.repeat(100_001) },
      { ...input, fileName: 'a\nb' }, { ...input, error: 'x'.repeat(20_001) },
      { ...input, fileName: '../private.ts' }, { ...input, fileName: '/private.ts' }]) {
      const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: args });
      assert.equal(response.isError, true);
    }
    assert.equal(calls, 0);
  } finally { await connection.close(); }
});

for (const [error, code] of [
  [new BackendUnavailable('internal path'), 'BACKEND_UNAVAILABLE'],
  [new Error('BIFROST_BASE_URL is not configured on the server'), 'CONFIGURATION_ERROR'],
  [new Error('HTTP 401 secret-private-provider-response'), 'PROVIDER_FAILURE'],
] as const) {
  test(`Failure maps to ${code} with no fake results or internal error leak`, async () => {
    const connection = await connected(async () => { throw error; });
    try {
      const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
      assert.equal(response.isError, true);
      assert.equal((data(response).error as { code: string }).code, code);
      assert.equal(data(response).usage, undefined);
      assert.equal(JSON.stringify(response).includes(error.message), false);
    } finally { await connection.close(); }
  });
}

test('Unexecuted MCP cannot report passed tests', async () => {
  const connection = await connected(async () => ({
    ...fixture(), tests: [{ ...fixture().tests[0], status: 'passed' }],
  }));
  try {
    const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal((data(response).error as { code: string }).code, 'INVALID_BACKEND_RESULT');
  } finally { await connection.close(); }
});

test('Timeout keeps concurrent calls blocked until actual backend settlement', async () => {
  let settle!: (value: ReturnType<typeof fixture>) => void;
  const connection = await connected(() => new Promise(resolve => { settle = resolve; }), 10);
  try {
    const timed = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal((data(timed).error as { code: string }).code, 'TIMEOUT');
    const busy = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal((data(busy).error as { code: string }).code, 'BUSY');
  } finally { settle(fixture()); await connection.close(); }
});

test('Configured credentials and bearer strings are redacted recursively', () => {
  process.env.PATCHPILOT_TEST_SECRET = 'private-test-credential';
  try {
    assert.deepEqual(redact({ source: ['private-test-credential', 'Bearer opaque-auth-token'] }),
      { source: ['[REDACTED]', 'Bearer [REDACTED]'] });
  } finally { delete process.env.PATCHPILOT_TEST_SECRET; }
});

test('Canonical engine configuration error and unknown billing survive unchanged', async () => {
  const result = { ...fixture(), status: 'error', diagnosis: null,
    errors: [{ code: 'MISSING_CONFIGURATION', message: 'Configure gateway.', retryable: false,
      provider: 'bifrost', configuration: ['BIFROST_BASE_URL'] }] };
  const connection = await connected(async () => result);
  try {
    const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal(response.isError, true);
    assert.deepEqual(data(response), result);
    assert.equal((data(response).usage as { actualCostUsd: unknown }).actualCostUsd, null);
  } finally { await connection.close(); }
});

test('Supported evidence and pending diff are returned exactly, never synthesized', async () => {
  const source = { id: 'test-source', title: 'Test fixture only', url: 'https://example.com/fixture',
    publisher: 'Fixture', retrievedAt: '2026-11-05', excerpt: 'Test reference', extractionStatus: 'extracted' };
  const result = { ...fixture(), status: 'supported', sources: [source], errors: [],
    diagnosis: { summary: 'Supported test fixture only.', evidenceStatus: 'supported' },
    proposedPatch: { id: 'test-patch', filePath: 'snippet.ts', originalCode: input.code,
      proposedCode: 'fixture', unifiedDiff: 'fixture-diff', explanation: 'Test fixture only.',
      approvalStatus: 'pending' } };
  const connection = await connected(async () => result);
  try {
    const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.deepEqual(data(response), result);
  } finally { await connection.close(); }
});

test('Unsupported patches and invalid safety reports are rejected', async () => {
  for (const result of [
    { ...fixture(), proposedPatch: { id: 'p', filePath: 'f', originalCode: '', proposedCode: '',
      unifiedDiff: '', explanation: '', approvalStatus: 'pending' } },
    { ...fixture(), safety: { ...fixture().safety, codeExecuted: true } },
    { ...fixture(), usage: { ...fixture().usage, modelCalls: -1 } },
  ]) {
    const connection = await connected(async () => result);
    try {
      const response = await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
      assert.equal((data(response).error as { code: string }).code, 'INVALID_BACKEND_RESULT');
    } finally { await connection.close(); }
  }
});

test('Actual built stdio runtime discovers tool and honestly reports missing entrypoint', async () => {
  const client = new Client({ name: 'real-stdio-test', version: '1' });
  const config = JSON.parse(await readFile(new URL('../cursor.mcp.json', import.meta.url), 'utf8'));
  assert.equal(config.mcpServers.patchpilot.type, 'stdio');
  const transport = new StdioClientTransport({
    command: config.mcpServers.patchpilot.command,
    args: config.mcpServers.patchpilot.args, stderr: 'pipe',
    env: { PATCHPILOT_ENGINE_MODULE: '/workspace/patchpilot-nonexistent-test-engine.ts',
      DOTENV_CONFIG_PATH: '/dev/null', BIFROST_BASE_URL: '', BIFROST_API_KEY: '',
      TAVILY_API_KEY: '', BIFROST_MODEL: '' },
  });
  let logs = '';
  transport.stderr?.on('data', chunk => { logs += String(chunk); });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0].name, 'diagnose_api_error');
    const response = await client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal(response.isError, true);
    assert.equal((data(response).error as { code: string }).code, 'BACKEND_UNAVAILABLE');
    assert.equal(logs.includes(input.code), false);
    assert.equal(logs.includes(input.error), false);
    assert.equal(data(response).diagnosis, undefined);
  } finally { await client.close(); }
});

test('Actual stdio process exits cleanly when host closes stdin', async () => {
  const child = spawn(process.execPath, ['build/mcp/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const guard = setTimeout(() => child.kill('SIGKILL'), 3000);
  try {
    child.stdin.end();
    assert.equal(await exited, 0);
    assert.equal(stdout, '');
  } finally { clearTimeout(guard); }
});

test('Patch tool delegates once to the same engine and preserves insufficient evidence', async () => {
  let calls = 0;
  let received: unknown;
  const result = fixture();
  const connection = await connected(async value => { calls++; received = value; return result; });
  try {
    const response = await connection.client.callTool({ name: 'propose_verified_patch', arguments: input });
    assert.equal(calls, 1);
    assert.deepEqual(received, input);
    assert.deepEqual(data(response), result);
    assert.equal(data(response).proposedPatch, undefined);
    const invalid = await connection.client.callTool({
      name: 'propose_verified_patch', arguments: { ...input, code: ' ' },
    });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 1);
  } finally { await connection.close(); }
});

test('Diagnosis and patch tools share the in-flight budget-protection lock', async () => {
  let settle!: (value: ReturnType<typeof fixture>) => void;
  const connection = await connected(() => new Promise(resolve => { settle = resolve; }), 10);
  try {
    await connection.client.callTool({ name: 'diagnose_api_error', arguments: input });
    const response = await connection.client.callTool({ name: 'propose_verified_patch', arguments: input });
    assert.equal((data(response).error as { code: string }).code, 'BUSY');
  } finally { settle(fixture()); await connection.close(); }
});

test('Actual published strict engine is called through stdio without provider fixtures', {
  skip: !testEngineModule,
}, async () => {
  const client = new Client({ name: 'strict-engine-integration', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['build/mcp/index.js'], cwd: process.cwd(), stderr: 'pipe',
    env: { PATCHPILOT_ENGINE_MODULE: testEngineModule!,
      DOTENV_CONFIG_PATH: '/dev/null', BIFROST_BASE_URL: '', BIFROST_API_KEY: '',
      TAVILY_API_KEY: '', BIFROST_MODEL: '' },
  });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'diagnose_api_error', arguments: input });
    assert.equal(response.isError, true);
    assert.equal(data(response).contractVersion, '1');
    const errors = data(response).errors as { code: string; provider: string }[];
    assert.ok(errors.some(error => error.code === 'MISSING_CONFIGURATION' && error.provider === 'bifrost'));
    assert.ok(errors.some(error => error.code === 'MISSING_CONFIGURATION' && error.provider === 'tavily'));
    assert.deepEqual(data(response).sources, []);
    assert.equal((data(response).usage as { modelCalls: number }).modelCalls, 0);
    assert.equal((data(response).safety as { codeExecuted: boolean }).codeExecuted, false);
  } finally { await client.close(); }
});

test('Verification tool preserves original backend run and measured-usage flag', async () => {
  const result = { id: 'verification-fixture', title: 'Test fixture', type: 'answer_verification',
    status: 'COMPLETED', claims: [], tests: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0,
      estimatedCost: 0, currency: 'USD', isMeasured: false } };
  let received: unknown;
  const connection = await connected(async () => fixture(), undefined,
    async input => { received = input; return result; });
  try {
    const input = { text: 'The SDK supports this version-dependent parameter.' };
    const response = await connection.client.callTool({ name: 'verify_technical_claims', arguments: input });
    assert.deepEqual(received, input);
    assert.deepEqual(data(response), result);
    assert.equal((data(response).usage as { isMeasured: boolean }).isMeasured, false);
    result.status = 'FAILED';
    const failed = await connection.client.callTool({ name: 'verify_technical_claims', arguments: input });
    assert.equal(failed.isError, true);
    assert.equal(data(failed).status, 'FAILED');
    const invalid = await connection.client.callTool({
      name: 'verify_technical_claims', arguments: { text: ' ', command: 'execute' },
    });
    assert.equal(invalid.isError, true);
  } finally { await connection.close(); }
});

test('Verification adapter uses the existing local REST endpoint and rejects secrets before forwarding', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.PATCHPILOT_API_BASE_URL;
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BIFROST_BASE_URL = '';
  process.env.BIFROST_API_KEY = '';
  process.env.TAVILY_API_KEY = '';
  process.env.PATCHPILOT_API_BASE_URL = 'http://127.0.0.1:3130/api';
  let calls = 0;
  let received: unknown;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:3130/api/verify');
    assert.equal(options?.method, 'POST');
    received = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ status: 'COMPLETED', fixtureOnly: true }));
  };
  try {
    const input = { text: '  OpenAI API supports streaming responses.  ' };
    const result = await verifyWithBackend(input);
    assert.deepEqual(received, input);
    assert.deepEqual(result, { status: 'COMPLETED', fixtureOnly: true });
    await assert.rejects(verifyWithBackend({ text: 'Authorization: Bearer ' + 'x'.repeat(40) }),
      InvalidVerificationInput);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.PATCHPILOT_API_BASE_URL;
    else process.env.PATCHPILOT_API_BASE_URL = originalBase;
  }
});

test('Verification adapter forbids remote/untrusted API targets and hides HTTP error bodies', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.PATCHPILOT_API_BASE_URL;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('private-error-marker', { status: 500 });
  };
  try {
    process.env.PATCHPILOT_API_BASE_URL = 'https://example.com/api';
    await assert.rejects(verifyWithBackend({ text: 'OpenAI API supports streaming responses.' }),
      BackendUnavailable);
    assert.equal(calls, 0);
    process.env.PATCHPILOT_API_BASE_URL = 'http://127.0.0.1:3130/api';
    await assert.rejects(verifyWithBackend({ text: 'OpenAI API supports streaming responses.' }),
      error => error instanceof Error && !error.message.includes('private-error-marker'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.PATCHPILOT_API_BASE_URL;
    else process.env.PATCHPILOT_API_BASE_URL = originalBase;
  }
});

test('Verification tool exercises the actual backend pipeline with missing providers, not fake success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'patchpilot-mcp-verify-'));
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.BIFROST_BASE_URL = '';
  process.env.BIFROST_API_KEY = '';
  process.env.TAVILY_API_KEY = '';
  process.env.PATCHPILOT_DATA_DIR = directory;
  process.env.NODE_ENV = 'production';
  const originalBase = process.env.PATCHPILOT_API_BASE_URL;
  const { createApp } = await import('../../../server');
  const { httpServer } = await createApp();
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as { port: number };
  process.env.PATCHPILOT_API_BASE_URL = `http://127.0.0.1:${address.port}/api`;
  const connection = await connected(async () => fixture());
  try {
    const response = await connection.client.callTool({
      name: 'verify_technical_claims', arguments: { text: 'OpenAI API supports streaming responses.' },
    });
    assert.equal(data(response).type, 'answer_verification');
    // Processing completes, but the backend explicitly reports no verification.
    assert.equal(data(response).status, 'COMPLETED');
    assert.match(String(data(response).errorMessage), /not been verified/);
    const claims = data(response).claims as { originalText: string; sources: unknown[]; status: string }[];
    assert.ok(claims.length > 0);
    assert.equal(claims[0].originalText, 'OpenAI API supports streaming responses.');
    assert.equal(claims[0].sources.length, 0);
    assert.ok(claims.every(claim => !['VERIFIED', 'OUTDATED'].includes(claim.status)));
    assert.equal((data(response).usage as { isMeasured: boolean }).isMeasured, false);
  } finally {
    await connection.close();
    await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
    if (originalBase === undefined) delete process.env.PATCHPILOT_API_BASE_URL;
    else process.env.PATCHPILOT_API_BASE_URL = originalBase;
  }
});
