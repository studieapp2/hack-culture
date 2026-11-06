import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BackendUnavailable, InvalidVerificationInput, diagnoseWithBackend, verifyWithBackend,
  type DiagnoseEngine, type VerifyEngine } from './backend';
import { diagnosisInput, diagnosisResult, verificationInput, verificationResult } from './schema';
import { codeTools, verificationTool } from './toolManifest';

const messages = {
  BACKEND_UNAVAILABLE: 'The required local PatchPilot backend is unavailable. Check its entrypoint and API configuration.',
  INVALID_INPUT: 'Remove credentials from verification text before submitting it.',
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

export function createMcpServer(engine: DiagnoseEngine = diagnoseWithBackend, timeoutMs = 95_000,
  verifyEngine: VerifyEngine = verifyWithBackend) {
  const server = new McpServer({ name: 'patchpilot', version: '0.1.0' });
  let busy = false;
  const invoke = async (operation: () => Promise<unknown>,
    validate: (value: unknown) => boolean): Promise<CallToolResult> => {
    if (busy) return failure('BUSY');
    busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep the lock until actual backend settlement, even after response timeout.
    const work = Promise.resolve().then(operation)
      .finally(() => { busy = false; });
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP_TIMEOUT')), timeoutMs);
        }),
      ]);
      if (!validate(result)) {
        return failure('INVALID_BACKEND_RESULT');
      }
      // Validate without replacing the original with Zod's stripped output.
      // Keep exact engine status, evidence, errors, null billing and metadata.
      const data = redact(result) as Record<string, unknown>;
      return { ...(['error', 'FAILED'].includes(String(data.status)) ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      if (error instanceof BackendUnavailable) return failure('BACKEND_UNAVAILABLE');
      if (error instanceof InvalidVerificationInput) return failure('INVALID_INPUT');
      const message = error instanceof Error ? error.message : '';
      if (message === 'MCP_TIMEOUT') return failure('TIMEOUT');
      if (/not configured|missing.configuration/i.test(message)) return failure('CONFIGURATION_ERROR');
      return failure('PROVIDER_FAILURE');
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  for (const tool of codeTools) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: diagnosisInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, input => invoke(() => engine(diagnosisInput.parse(input)),
      result => diagnosisResult.safeParse(result).success));
  }
  server.registerTool(verificationTool.name, {
    title: verificationTool.title, description: verificationTool.description,
    inputSchema: verificationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, input => invoke(() => verifyEngine(verificationInput.parse(input)),
    result => verificationResult.safeParse(result).success));
  return server;
}
