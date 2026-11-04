import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BackendUnavailable, diagnoseWithBackend, type DiagnoseEngine } from './backend';
import { diagnosisInput } from './schema';

const messages = {
  BACKEND_UNAVAILABLE: 'Backend diagnoseApiError is unavailable. Complete and approve the backend entrypoint contract.',
  CONFIGURATION_ERROR: 'Backend configuration is missing. Configure the Bifrost gateway and Tavily credentials server-side.',
  PROVIDER_FAILURE: 'The backend/provider failed. Check provider connectivity, credentials, quota and backend logs.',
  TIMEOUT: 'Diagnosis timed out. Work may still be running; do not retry until the backend run has settled.',
  BUSY: 'A diagnosis is already running. Wait for it to settle before retrying.',
  INVALID_BACKEND_RESULT: 'The backend returned an incompatible result. No diagnosis was reported as successful.',
};

type ErrorCode = keyof typeof messages;
function failure(code: ErrorCode): CallToolResult {
  const data = { status: 'error', error: { code, message: messages[code] } };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** Redact configured credentials on the output boundary, never log user data. */
export function redact(value: unknown): unknown {
  const secrets = Object.entries(process.env)
    .filter(([key, item]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && item && item.length >= 4)
    .map(([, item]) => item!);
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      let safe = item;
      for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]');
      return safe.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk-|tvly-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object')
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value);
}

export function createMcpServer(engine: DiagnoseEngine = diagnoseWithBackend, timeoutMs = 95_000) {
  const server = new McpServer({ name: 'patchpilot', version: '0.1.0' });
  let busy = false;
  server.registerTool('diagnose_api_error', {
    title: 'Diagnose an API/SDK error',
    description: 'Analyze actual error and relevant code using PatchPilot. Returns backend evidence and an optional unexecuted patch. Never edits files. Host agent must request human review before consequential changes. Supplied code is sent to configured backend providers; do not submit secrets.',
    inputSchema: diagnosisInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async input => {
    if (busy) return failure('BUSY');
    busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep the lock until actual backend settlement, even after response timeout.
    const work = Promise.resolve().then(() => engine(diagnosisInput.parse(input)))
      .finally(() => { busy = false; });
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP_TIMEOUT')), timeoutMs);
        }),
      ]);
      if (!result || typeof result.diagnosis !== 'string' ||
        !Array.isArray(result.claims) || !Array.isArray(result.tests) || !result.usage ||
        result.tests.some(test => test.status !== 'not_run')) {
        return failure('INVALID_BACKEND_RESULT');
      }
      // Do not relabel model recommendations as verified. Claims retain backend statuses.
      const data = redact({
        status: result.claims.length && result.claims.every(claim => claim.status === 'VERIFIED')
          ? 'evidence_available' : 'insufficient_evidence',
        ...result,
        sources: Array.from(new Map(result.claims.flatMap(claim => claim.sources)
          .map(source => [source.url, source])).values()),
      }) as Record<string, unknown>;
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      if (error instanceof BackendUnavailable) return failure('BACKEND_UNAVAILABLE');
      const message = error instanceof Error ? error.message : '';
      if (message === 'MCP_TIMEOUT') return failure('TIMEOUT');
      if (/not configured|missing.configuration/i.test(message)) return failure('CONFIGURATION_ERROR');
      return failure('PROVIDER_FAILURE');
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  return server;
}
